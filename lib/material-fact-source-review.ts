import type { FactCandidate, FactSource, FactState } from './material-fact-types';
import type { CandidateNormalization, FactReviewIssue, RateUnit, RawCandidateV3 } from './material-fact-types-v3';
import { getCandidateRepresentation, isV2Candidate, isV3Candidate } from './material-facts-v3.ts';
import { isPostposedMoneyPaymentSchedule, hasPostposedMoneyUncertainty, hasUnfinishedMoneyRangeAfter, hasUnsafeWholeMoneyContinuation, normalizeCandidateValueV4 as normalizeCandidateValue } from './material-money-v4.ts';
import { hasSupportedCandidateAttribution, hasSupportedTotalRelationship } from './material-fact-event-review.ts';
import { sourceMoneyHasNonCurrencySubunit, sourceMoneyHasNonCurrencyYuan, sourceMoneyHasExplicitRmbCurrency, sourceMoneyHasUnsupportedCurrency } from './material-fact-currency-review.ts';
import { hasAttachedMoneyArithmetic } from './material-fact-arithmetic-review.ts';
import { attachedMoneyQualifierStatus, isMoneyRangeEndpoint } from './material-fact-range-review.ts';
import { reviewMaterialCoverage } from './material-fact-coverage-review.ts';

/** Runtime source review is deliberately separate from the frozen extraction/evaluation contract. */
export type SourceFactReviewIssue = FactReviewIssue | {
  code: 'source_amount_context_mismatch' | 'source_evidence_unresolved' | 'source_relation_unresolved';
  message: string;
};
type ReviewedCandidate = FactCandidate & { reviewIssues: SourceFactReviewIssue[]; normalization?: CandidateNormalization };
type AnchoredSourceEvent = { text: string; qualifiers: string; blockText: string; valueStart: number };
type SourceEvent = AnchoredSourceEvent | { error: string; ambiguous?: boolean };
const codePointOffset = (text: string, offset: number) => Array.from(text.slice(0, offset)).length;

function sourceEvent(candidate: FactCandidate, source: FactSource | undefined): SourceEvent {
  if (!source || !source.ready || source.id !== candidate.evidenceId || source.sha256 !== candidate.sourceSha256) return { error: '候选无法绑定当前已就绪的同一原始材料，未按猜测位置提供金额提示。' };
  const block = source.blocks.find(item => item.id === candidate.blockId);
  if (!block) return { error: '候选对应的原始文本块不存在，未提供金额提示。' };
  const quoteStart = block.text.indexOf(candidate.quote);
  if (quoteStart < 0) return { error: '候选引文在原始文本块中不存在，未提供金额提示。' };
  if (block.text.indexOf(candidate.quote, quoteStart + 1) >= 0) return { error: '候选引文在原始文本块中无法唯一定位，未选择首个位置提供金额提示。', ambiguous: true };
  const valueInQuote = candidate.quote.indexOf(candidate.value);
  if (valueInQuote < 0 || candidate.quote.indexOf(candidate.value, valueInQuote + 1) >= 0) return { error: '同一候选值在引文中无法唯一定位，未选择首个位置提供金额提示。', ambiguous: true };
  if (candidate.start !== codePointOffset(block.text, quoteStart) || candidate.end !== codePointOffset(block.text, quoteStart + candidate.quote.length)) return { error: '候选原文位置与当前文本块不一致，未提供金额提示。' };
  // The model may crop the quote immediately before a group, approximation or sign cue.
  // Expand only the anchored value's local clause; another sentence/event is not evidence.
  const valueStart = quoteStart + valueInQuote;
  let start = valueStart, end = start + candidate.value.length;
  while (start > 0 && !/[，,。！？!?；;\n\r]/u.test(block.text[start - 1])) start--;
  while (end < block.text.length && !/[，,。！？!?；;\n\r]/u.test(block.text[end])) end++;
  const text = block.text.slice(start, end), offset = text.indexOf(candidate.value);
  if (offset < 0 || text.indexOf(candidate.value, offset + 1) >= 0) return { error: '相同候选值在源文局部事件中多次出现，无法唯一核对其修饰词，未提供金额提示。', ambiguous: true };
  // Adjacent clauses can govern or qualify this amount even across a full stop or an
  // OCR newline. Only a clearly different owner/event is excluded. Unknown prose,
  // headers and repeated same-worker statements require review, not cue-word guessing.
  const subject = getCandidateRepresentation(candidate)?.subject;
  const separateEvent = (clause: string) => {
    if (!subject || clause.includes(subject)) return false;
    const trimmed = clause.trim();
    // "Another worker" can still qualify this total (e.g. included above). Only
    // explicitly bounded independent events may be skipped, never an arbitrary tail.
    if (/^另一(?:班组|工人|劳动者|员工)(?:[0-9一二三四五六七八九十百千万零两]+(?:名|位|人)(?:工人|员工|劳动者)?)?另案处理$/u.test(trimmed)) return true;
    if (/^另一(?:工人|劳动者|员工)(?:(?:工资|本次|此次|部分|完整|应付|已付|支付|约|合计|共计)|\s)*[0-9一二三四五六七八九十百千万亿零两壹贰叁肆伍陆柒捌玖拾佰仟.]+[元圆圓](?:整|正)?$/u.test(trimmed)) return true;
    const ownerAndPeriod = trimmed.match(/^([\p{Script=Han}]{2,4})(?:在[\p{L}\p{N}（）()·]{1,60}(?:公司|单位|厂|店))?\s*(\d{4}年\d{1,2}月(?:\d{1,2}日)?)/u);
    const worker = ownerAndPeriod?.[1], value = trimmed.match(/[0-9零〇一二三四五六七八九十百千万亿两壹贰叁肆伍陆柒捌玖拾佰仟.]+\s*[元圆圓](?:整|正)?$/u)?.[0];
    if (!worker || !value || hasGroupText(clause)
      || /全|组|工资|金额|总额|合计|汇总|部分|仅|记录|单位|公司|个人|本人|统计|币种|名单|备注|说明|以下|上述/u.test(worker)) return false;
    const other: RawCandidateV3 = { kind: 'money', value, quote: trimmed, blockId: block.id, subject: worker,
      scope: 'unknown', meaning: 'other_money', completeness: 'not_applicable', period: ownerAndPeriod![2], rateUnit: null, assertion: 'unknown' };
    return hasSupportedCandidateAttribution(other, trimmed, normalizeCandidateValue(other).normalization);
  };
  const splitClauses = (text: string) => text.split(/[，,。！？!?；;\n\r\u2028\u2029]+/u).map(clause => clause.trim()).filter(Boolean);
  const qualifiers: string[] = [];
  // OCR block boundaries are layout, not semantic boundaries: a table header or
  // footnote can qualify the amount in the next/previous block (even on a new page).
  const blockIndex = source.blocks.indexOf(block);
  const preceding = [...source.blocks.slice(0, blockIndex).map(item => item.text), block.text.slice(0, start)].join('\n');
  const following = [block.text.slice(end), ...source.blocks.slice(blockIndex + 1).map(item => item.text)].join('\n');
  for (const neighboring of [splitClauses(preceding).reverse(), splitClauses(following)]) {
    for (const clause of neighboring) {
      // Do not stop scanning at a different row: an earlier table header may still
      // govern this row. Extra unresolved context can only reduce availability.
      if (separateEvent(clause)) continue;
      qualifiers.push(clause);
    }
  }
  return { text, qualifiers: qualifiers.join('，'), blockText: block.text, valueStart };
}

function hasGroupText(text: string): boolean {
  // Detection-only spellings: a traditional group header must keep the same
  // individual-scope warning when traditional amount roles are recognized.
  text = text.replace(/[組體員勞動農兩萬]/gu, glyph => ({ 組: '组', 體: '体', 員: '员', 勞: '劳', 動: '动', 農: '农', 兩: '两', 萬: '万' })[glyph]!);
  if (/(?:班组|全组|全体(?:工人|员工|劳动者|农民工)?|多人|多名(?:工人|员工|劳动者|农民工))/u.test(text)) return true;
  return [...text.matchAll(/(?<![第0-9一二三四五六七八九十百千万零两])([0-9一二三四五六七八九十百千万零两]+)\s*(?:名|位|人)(?!民[币幣])(?:工人|员工|劳动者|农民工)?/gu)]
    .some(match => /^\d+$/u.test(match[1]) ? BigInt(match[1]) > 1n : !['一', '零'].includes(match[1]));
}
function appendIssue(candidate: ReviewedCandidate, issue: SourceFactReviewIssue) {
  if (!candidate.reviewIssues.some(existing => existing.code === issue.code)) candidate.reviewIssues.push(issue);
}
function unavailableNormalization(candidate: FactCandidate, reason: string, status: CandidateNormalization['status'] = 'uncertain'): CandidateNormalization {
  return { rawValue: candidate.value, status, amount: null, matchedText: null, span: null, reason };
}

function monetaryEdges(context: AnchoredSourceEvent, normalized: CandidateNormalization, preserveWhitespace = false) {
  if (!normalized.span) return null;
  const characters = Array.from(normalized.rawValue);
  const start = context.valueStart + characters.slice(0, normalized.span.start).join('').length;
  const end = context.valueStart + characters.slice(0, normalized.span.end).join('').length;
  const before = context.blockText.slice(0, start), after = context.blockText.slice(end);
  return { before: preserveWhitespace ? before : before.replace(/[^\S\r\n]+$/u, ''), after: preserveWhitespace ? after : after.replace(/^[^\S\r\n]+/u, ''), matched: context.blockText.slice(start, end) };
}

/** Layout may split an explicit formula across OCR/TXT blocks. Only the shared
 * arithmetic grammar sees adjacent blocks; positions and other guards stay bound
 * to the original block. Intervening prose/punctuation cannot bridge an event. */
function sourceMoneyHasAttachedArithmetic(context: AnchoredSourceEvent, normalized: CandidateNormalization, source: FactSource, blockId: string): boolean {
  const edges = monetaryEdges(context, normalized, true);
  if (!edges) return false;
  const blockIndex = source.blocks.findIndex(block => block.id === blockId);
  const before = [...source.blocks.slice(0, blockIndex).map(block => block.text), edges.before].join('\n');
  const after = [edges.after, ...source.blocks.slice(blockIndex + 1).map(block => block.text)].join('\n');
  return hasAttachedMoneyArithmetic(before, after);
}

function sourceMoneyLayoutEdges(context: AnchoredSourceEvent, normalized: CandidateNormalization, source: FactSource, blockId: string) {
  const edges = monetaryEdges(context, normalized, true);
  if (!edges) return null;
  const blockIndex = source.blocks.findIndex(block => block.id === blockId);
  const before = [...source.blocks.slice(0, blockIndex).map(block => block.text), edges.before].join('\n');
  const after = [edges.after, ...source.blocks.slice(blockIndex + 1).map(block => block.text)].join('\n');
  return { before, after, matched: edges.matched };
}

/** Inspect the original block: a grouping comma may already be outside the local clause. */
function truncatedMoneyToken(context: AnchoredSourceEvent, normalized: CandidateNormalization, layoutAfter?: string, layoutBefore?: string): boolean {
  const edges = monetaryEdges(context, normalized);
  if (!edges) return false;
  const numerals = '0-9０-９零〇一二三四五六七八九十百千万萬亿億两兩壹贰貳叁參肆伍陆陸柒捌玖拾佰仟';
  // A newly supported RMB cents fragment can be the tail of the preceding
  // layout block's amount (5角 / 2分RMB). Do not expose that tail as 0.02.
  // Only directly attached numeric monetary units bridge whitespace/Cf;
  // punctuation, ordinary unit words and another owner break this guard.
  const leading = (layoutBefore ?? edges.before).normalize('NFKC').replace(/\p{Cf}/gu, '');
  if (new RegExp(`[${numerals}]+\\s*[元圆圓角分]\\s*$`, 'u').test(leading)) return true;
  if (new RegExp(`[${numerals}.．]$`, 'u').test(edges.before)
    || new RegExp(`[${numerals}][^\\S\\r\\n]*[,，]$`, 'u').test(edges.before)) return true;
  if (!/[元圆圓角分](?:整|正)?$/u.test(edges.matched)) {
    if (new RegExp(`^[${numerals}.．]`, 'u').test(edges.after)
      || new RegExp(`^[,，][^\\S\\r\\n]*[${numerals}]`, 'u').test(edges.after)) return true;
  }
  // A bare historical number followed only by 元/圆 keeps its old numeric meaning.
  // Extra 角/分, including after an omitted 元, changes that same amount.
  // An adjacent layout block may continue the same amount with cents.
  // Whitespace/Cf may bridge it; punctuation and another subject may not.
  const continuation = (layoutAfter ?? edges.after).normalize('NFKC').replace(/\p{Cf}/gu, '');
  return new RegExp(`^\\s*(?:[元圆圓]\\s*)?[${numerals}]+\\s*[角分]`, 'u').test(continuation);
}

function sourceRateDetectionText(text: string): string {
  // Fold only the detection view. In particular LS/PS remain line boundaries;
  // horizontal OCR spacing cannot hide a directly attached wage standard.
  const traditional: Record<string, string> = { 資: '资', 標: '标', 準: '准', 時: '时', 約: '约', 為: '为', 計: '计', 額: '额', 幣: '币', 單: '单', 價: '价', 後: '后', 當: '当', 該: '该', 這: '这', 個: '个' };
  return text.normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/[^\S\r\n\u2028\u2029]/gu, '')
    .replace(/[資標準時約為計額幣單價後當該這個]/gu, character => traditional[character]);
}

/** An explicit unsupported denominator cannot become a total or an enum rate.
 * Only this finite prefix may span OCR layout; punctuation and other prose stop
 * the match. An unstructured model-supplied subject cannot exempt this guard. */
function sourceHasUnsupportedRate(beforeEdge: string): boolean {
  const before = sourceRateDetectionText(beforeEdge).split(/[，,。！？!?；;]/u).at(-1)!;
  return /(?:每|按)\s*(?:年(?:度)?|周|週|星期|季度|季|次|分钟|分鐘|秒|公里|人|班)\s*(?:(?:标准|约定|为|是|计|共|合计|基本工资|工资|薪酬|薪资|金额|人民币|RMB|CNY|[¥￥:=])\s*)*$/u.test(before);
}

function sourcePostposedRate(afterEdge: string): { unit: RateUnit | null; uncertain: boolean } | null {
  // Only this explicit 按+unit branch may continue through OCR layout. Its
  // finite tail excludes payment dates (按月15日) and prose (按时支付/计数).
  const after = sourceRateDetectionText(afterEdge);
  const supported = after.match(/^\s*(?:[元圆圓]\s*)?(?:[整正]\s*)?按\s*(?:(小时|月|日|天|件)(?:\s*(?:计算|计酬|计价|计薪|计))?|(时)\s*(?:计算|计酬|计价|计薪|计))/u);
  // Known unsupported units may be bare. Unknown bounded unit names need an
  // explicit pricing verb, so 按时支付/按月15日/按季度汇总 stay ordinary prose.
  const knownUnsupported = after.match(/^\s*(?:[元圆圓]\s*)?(?:[整正]\s*)?按\s*(?:年(?:度)?|周|週|星期|季度|季|次|分钟|分鐘|秒|公里|人|班)(?:\s*(?:计算|计酬|计价|计薪|计))?/u);
  const namedUnsupported = after.match(/^\s*(?:[元圆圓]\s*)?(?:[整正]\s*)?按\s*(?:\p{Script=Han}{1,12}|[A-Za-z]{1,16})\s*(?:计算|计酬|计价|计薪|计)/u);
  const units: Record<string, RateUnit> = { 月: 'month', 日: 'day', 天: 'day', 小时: 'hour', 时: 'hour', 件: 'piece' };
  // A supported unit's partial prefix (月 in 月度) must not hide a complete
  // unsupported pricing unit. Test each candidate's own right boundary.
  for (const match of [supported, knownUnsupported, namedUnsupported]) {
    if (!match) continue;
    const tail = after.slice(match[0].length), uncertain = hasPostposedMoneyUncertainty(tail);
    if (/^\s*(?:$|[，,。；;！!？?）)】\]])/u.test(tail) || uncertain)
      return { unit: match === supported ? units[match[1] ?? match[2]] : null, uncertain };
  }
  return null;
}

function sourceRateUnit(context: AnchoredSourceEvent, normalized: CandidateNormalization, subject: string | null, postposedUnit?: RateUnit, paymentSchedule = false): RateUnit | null {
  const edges = monetaryEdges(context, normalized, true);
  if (!edges) return null;
  const detectionText = sourceRateDetectionText;
  const before = detectionText(edges.before.split(/[，,。！？!?；;\n\r\u2028\u2029]/u).at(-1)!);
  const after = detectionText(edges.after.split(/[，,。！？!?；;\n\r\u2028\u2029]/u)[0]);
  const units: Record<string, RateUnit> = { 月: 'month', 日: 'day', 天: 'day', 小时: 'hour', 时: 'hour', 件: 'piece' };
  // A model-supplied subject never exempts a postposed source denominator.
  if (postposedUnit) return postposedUnit;
  const suffix = after.match(/^(?:[元圆圓]\s*)?(?:[/／]\s*|每\s*)(小时|月|日|天|时|件)/u);
  // Only an explicit recurring day plus payment verb exempts 每月. The
  // shared predicate does not exempt slash units or another wage standard.
  if (suffix && !paymentSchedule && !isPostposedMoneyPaymentSchedule(edges.after)) return units[suffix[1]];
  const prefix = before.match(/(?:(?:每|按)(小时|月|日|天|时|件)|(月|日|时)(?:薪|(?:基本)?工资)|小时工资|计件(?:单价|工资)?)(?:标准|约定|为|是|计|共|合计|基本工资|工资|薪酬|薪资|金额|人民币|[¥￥:=])*$/u);
  if (!prefix) return null;
  // “2026年1月工资1000元” and “上月工资1000元” name wage periods,
  // not monthly rates. Explicit 标准, 每月 or /月 still takes precedence.
  // Only the naked 月/日/时工资 alternative can collide with a calendar token.
  const calendarPrefix = before.slice(0, prefix.index);
  const explicitStandard = prefix[0].includes('标准');
  // A bare 月/日/时工资 token can start inside a complete short worker name.
  // Require its literal unique owner at the clause heading, rather than letting
  // an arbitrary model subject swallow a real rate (e.g. 王甲月/李王月).
  if (!explicitStandard && prefix[2] && /^(?:月|日|时)(?:基本)?工资/u.test(prefix[0]) && subject
    && /^[王李张張刘劉陈陳杨楊黄黃赵趙吴吳周徐孙孫马馬朱胡郭何高林罗羅郑鄭梁谢謝宋唐许許韩韓冯馮邓鄧曹彭曾肖萧蕭田董袁潘于蒋蔣蔡余杜叶葉程苏蘇魏吕呂丁任沈姚卢盧姜崔钟鍾谭譚陆陸汪范金石廖贾賈夏韦韋方白邹鄒孟熊秦邱侯江尹薛阎閻段雷龙龍黎史陶贺賀顾顧毛郝龚龔邵万萬钱錢严嚴武戴莫孔向汤湯][月日时時]$/u.test(subject)) {
    const literalBefore = edges.before.split(/[，,。！？!?；;\n\r\u2028\u2029]/u).at(-1)!;
    const owner = literalBefore.indexOf(subject);
    if (owner >= 0 && literalBefore.indexOf(subject, owner + 1) < 0) {
      const heading = literalBefore.slice(0, owner).replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').trim();
      const nameEnd = detectionText(literalBefore.slice(0, owner + subject.length)).length;
      if (/^(?:(?:劳动者|员工|工人|原告|被告|申请人|被申请人)\s*[:：]?\s*)?$/u.test(heading)
        && prefix.index! + prefix[2].length === nameEnd) return null;
    }
  }
  if (!explicitStandard && prefix[2] && /[0-9零〇一二三四五六七八九十百千万两正腊臘]$/u.test(calendarPrefix)
    && !(subject && calendarPrefix.endsWith(detectionText(subject)))) return null;
  if (!explicitStandard && prefix[2] === '月' && /^月(?:基本)?工资/u.test(prefix[0])
    && /(?:上(?:一?个)?|下(?:一?个)?|本|当|该|这(?:个)?)$/u.test(calendarPrefix)
    && !(subject && calendarPrefix.endsWith(detectionText(subject)))) return null;
  // A complete weekday, such as 周日 or 星期日, is a wage period.
  // Only the naked 日工资 form qualifies: explicit standards, recurring
  // 每/按 weekday wording and a subject's own suffix keep their rate guard.
  const weekday = calendarPrefix.match(/(?:周|週|星期|礼拜|禮拜)$/u);
  if (!explicitStandard && prefix[2] === '日' && /^日(?:基本)?工资/u.test(prefix[0])
    && weekday && !/(?:每(?:一?个)?|按)$/u.test(calendarPrefix.slice(0, weekday.index))
    && !(subject && calendarPrefix.endsWith(detectionText(subject)))) return null;
  // “今日工资合计” names one day's amount. Keep explicit 每日, 日薪,
  // 日工资标准 and suffix units as rates; a subject ending in 今/昨/etc.
  // cannot turn its following 日工资 rate into a relative-day expression.
  if (!explicitStandard && prefix[2] === '日' && /^日(?:基本)?工资/u.test(prefix[0])
    && /(?:今|昨|明|前|后|後|当|當|本|该|該|这|這|那|次|翌|同|某)$/u.test(calendarPrefix)
    && !(subject && calendarPrefix.endsWith(detectionText(subject)))) return null;
  return prefix[1] ? units[prefix[1]] : prefix[2] ? units[prefix[2]] : prefix[0].startsWith('小时') ? 'hour' : 'piece';
}

function sourceUnitMismatch(raw: RawCandidateV3, unit: RateUnit | null): boolean {
  return unit !== null && (raw.meaning !== 'rate' || (raw.rateUnit !== null && raw.rateUnit !== 'unknown' && raw.rateUnit !== unit));
}

/** Never edits model literals, raw output, confirmations or an unrelated candidate. Never upgrades money. */
export function reviewCandidateAgainstSource(candidate: FactCandidate, source: FactSource | undefined): FactCandidate {
  const raw = getCandidateRepresentation(candidate);
  if (!raw || !(isV3Candidate(candidate) || isV2Candidate(candidate))) return structuredClone(candidate);
  const reviewed = structuredClone(candidate) as ReviewedCandidate;
  const context = sourceEvent(candidate, source);
  if ('error' in context) {
    appendIssue(reviewed, { code: context.ambiguous ? 'local_context_ambiguous' : 'source_evidence_unresolved', message: context.error });
    if (raw.kind === 'money') {
      reviewed.amount = null;
      if (isV3Candidate(candidate)) reviewed.normalization = unavailableNormalization(candidate, context.error);
    }
    return reviewed;
  }
  if (raw.scope === 'individual' && hasGroupText(`${context.text} ${context.qualifiers}`)) appendIssue(reviewed, {
    code: 'scope_text_mismatch', message: '候选绑定的源文局部事件含班组或多人表述，与“个人”标注不一致；模型裁剪引文不能排除该主体线索，请人工核对。',
  });
  if (raw.kind === 'date' && raw.meaning === 'employment_period' && /(?:签订|签署|订立|签约|签字|签章)/u.test(context.text)) appendIssue(reviewed, {
    code: 'contract_signing_as_employment', message: '候选绑定的源文局部日期事件含签约表述，请核对是否确为任职日期；此为词法线索，不自动改变日期角色。',
  });
  if (raw.kind === 'money' && ['due_total', 'paid_total'].includes(raw.meaning) && (raw.completeness === 'partial'
    || /(?:单笔|本次|此次|一笔|该笔|部分|先付|预付|预支|首批|第[一二三四五六七八九十0-9]+(?:笔|批|期)|仅含|只含|不含|未含|不包括|未包括)/u.test(`${context.text} ${context.qualifiers}`))) appendIssue(reviewed, {
    code: raw.meaning === 'due_total' ? 'partial_due_total' : 'partial_paid_total', message: '候选绑定的源文含单笔、部分或排除工资组成的表述，不能因裁剪引文就提示为本期完整总额，请核对金额覆盖范围。',
  });
  const totalNeedsCompleteRelationship = raw.kind === 'money' && raw.scope === 'individual'
    && ['due_total', 'paid_total'].includes(raw.meaning) && raw.completeness === 'complete';
  if (!totalNeedsCompleteRelationship && (context.qualifiers.length > 0
    || !hasSupportedCandidateAttribution(raw, context.text, normalizeCandidateValue({ ...raw, quote: context.text }).normalization))) appendIssue(reviewed, {
    code: 'source_relation_unresolved', message: '源文未在同一明确事件中支持该候选标注的主体与期间；文字在其他位置出现不足以确认归属，请对照原文核对。此提示也适用于费率、单笔付款、欠款、裁判金额及日期。',
  });
  if (raw.kind === 'money') {
    // Review may only reduce availability, including for historical extractions.
    // New parsing is applied on re-extraction; old raw/value/quote remain intact.
    let sourceNormalized = normalizeCandidateValue({ ...raw, quote: context.text });
    // A local-clause cut may stop at 每月 before the calendar day in the next
    // OCR/TXT line. Extend only a proven recurring-payment schedule, using the
    // original anchored layout as a detection quote. Other contexts, raw
    // evidence and CP positions remain unchanged; old null amounts stay null.
    const literal = normalizeCandidateValue({ ...raw, quote: raw.value });
    const scheduleLayout = literal.amount !== null
      ? sourceMoneyLayoutEdges(context, literal.normalization, source!, candidate.blockId) : null;
    if (scheduleLayout && isPostposedMoneyPaymentSchedule(scheduleLayout.after)) {
      const localPrefix = context.text.slice(0, context.text.indexOf(raw.value));
      sourceNormalized = normalizeCandidateValue({ ...raw, quote: localPrefix + Array.from(raw.value).slice(0, literal.normalization.span!.end).join('') + scheduleLayout.after });
    }
    // A local cut can leave a bare ×/x/* before its operand on the next
    // line/block. Only the anchored full-layout arithmetic grammar may reclassify
    // that local uncertainty; the amount remains unavailable, including old nulls.
    const multiplicationMask = scheduleLayout
      && /^\s*(?:[元圆圓]|人民币|人民幣|RMB|CNY)?\s*[×x*]/iu.test(scheduleLayout.after.normalize('NFKC').replace(/\p{Cf}/gu, ''));
    if (sourceNormalized.normalization.status === 'uncertain' && literal.amount !== null && multiplicationMask
      && sourceMoneyHasAttachedArithmetic(context, literal.normalization, source!, candidate.blockId)) {
      sourceNormalized = {
        ...sourceNormalized, amount: null, normalization: unavailableNormalization(candidate, '源文金额直接附着倍数或算式，候选可能只截取了运算中的基础金额；保留原文且不进行计算。', 'unsupported'),
      };
      if (candidate.amount === null && isV3Candidate(candidate) && candidate.normalization.status === 'uncertain') reviewed.normalization = {
        ...sourceNormalized.normalization, reason: `源文上下文约束：${sourceNormalized.normalization.reason}`,
      };
    }
    if (totalNeedsCompleteRelationship
      && (context.qualifiers.length > 0 || !hasSupportedTotalRelationship(raw, context.text, sourceNormalized.normalization))) appendIssue(reviewed, {
      code: 'source_relation_unresolved', message: '源文未在同一明确事件中绑定该劳动者、完整工资期间和应付/已付总额；跨句线索、多主体、多期间或复杂表述不能仅凭文字出现就视为个人可用金额，请对照原文人工核对。',
    });
    if (sourceNormalized.amount !== null) {
      const blockIndex = source!.blocks.findIndex(block => block.id === candidate.blockId);
      const subunitSource = { blockText: [context.blockText, ...source!.blocks.slice(blockIndex + 1).map(block => block.text)].join('\n'), valueStart: context.valueStart };
      // Layout boundaries do not erase an explicitly attached bound or range.
      // Shared finite grammars alone inspect these edges; arbitrary neighboring
      // prose cannot attach, and stored quote/positions stay in their own block.
      const layout = sourceMoneyLayoutEdges(context, sourceNormalized.normalization, source!, candidate.blockId);
      const qualifierStatus = layout && attachedMoneyQualifierStatus(layout.before, layout.after);
      const postposedRate = layout && sourcePostposedRate(layout.after);
      if (sourceMoneyHasNonCurrencyYuan(subunitSource, sourceNormalized.normalization)) sourceNormalized = {
        ...sourceNormalized, amount: null, normalization: unavailableNormalization(candidate, '源文中的元或圆属于普通复合词，未将裁剪片段作为人民币金额。', 'unsupported'),
      };
      else if (sourceMoneyHasNonCurrencySubunit(subunitSource, sourceNormalized.normalization)) sourceNormalized = {
        ...sourceNormalized, amount: null, normalization: unavailableNormalization(candidate, '源文中的角或分属于时间、计量或普通词语，未将裁剪片段作为分币金额。', 'unsupported'),
      };
      else if (sourceMoneyHasUnsupportedCurrency(context, sourceNormalized.normalization, raw.subject)) sourceNormalized = {
        ...sourceNormalized, amount: null, normalization: unavailableNormalization(candidate, '源文金额直接附着外币或不支持的币种标记，当前规范化不进行币种转换。', 'unsupported'),
      };
      else if (layout && hasUnsafeWholeMoneyContinuation(raw, sourceNormalized.normalization, layout.after)) sourceNormalized = {
        ...sourceNormalized, amount: null, normalization: unavailableNormalization(candidate, '源文完整金额终止词后仍附着数字、币种、费率或不确定续文，未将裁剪值作为精确金额。', 'unsupported'),
      };
      else if (layout && isMoneyRangeEndpoint(layout.before, layout.matched, layout.after)) sourceNormalized = {
        ...sourceNormalized, amount: null, normalization: unavailableNormalization(candidate, '源文明确给出金额区间，未将裁剪后的任一端点作为精确金额。', 'range'),
      };
      else if (layout && hasUnfinishedMoneyRangeAfter(layout.after)) sourceNormalized = {
        ...sourceNormalized, amount: null, normalization: unavailableNormalization(candidate, '源文金额后仍有未完成的区间端点，未将裁剪后的起始金额作为精确金额。', 'uncertain'),
      };
      else if (qualifierStatus) sourceNormalized = {
        ...sourceNormalized, amount: null, normalization: unavailableNormalization(candidate, '源文金额直接附着符号、数量不定或上下界限定，未将裁剪后的数值作为精确金额。', qualifierStatus),
      };
      else if (sourceMoneyHasAttachedArithmetic(context, sourceNormalized.normalization, source!, candidate.blockId)) sourceNormalized = {
        ...sourceNormalized, amount: null, normalization: unavailableNormalization(candidate, '源文金额直接附着倍数或算式，候选可能只截取了运算中的基础金额；保留原文且不进行计算。', 'unsupported'),
      };
      else if (layout && (hasPostposedMoneyUncertainty(layout.after) || postposedRate?.uncertain)) sourceNormalized = {
        ...sourceNormalized, amount: null, normalization: unavailableNormalization(candidate, '源文金额后直接附着问号、待核或未知标记；保留原文，不将裁剪金额作为确定值。'),
      };
      else if (truncatedMoneyToken(context, sourceNormalized.normalization, layout?.after, layout?.before)) sourceNormalized = {
        ...sourceNormalized, amount: null, normalization: unavailableNormalization(candidate, '候选只覆盖源文金额数值的一部分，可能截去了前导数字、小数、分组、中文单位或角分，未生成精确金额。', 'unsupported'),
      };
      else if (layout && (sourceHasUnsupportedRate(layout.before) || postposedRate?.unit === null)) sourceNormalized = {
        ...sourceNormalized, amount: null, normalization: unavailableNormalization(candidate, '源文金额直接附着不受支持的费率分母，未换算成总额或现有费率单位，请人工核对。', 'unsupported'),
      };
      else if (sourceUnitMismatch(raw, sourceRateUnit(context, sourceNormalized.normalization, raw.subject, postposedRate?.unit ?? undefined, isPostposedMoneyPaymentSchedule(layout?.after ?? '')))) sourceNormalized = {
        ...sourceNormalized, amount: null, normalization: unavailableNormalization(candidate, '源文金额直接附着费率单位，与当前总额角色或已声明费率单位冲突，未生成精确金额。', 'rate_unit_mismatch'),
      };
      else if (!sourceMoneyHasExplicitRmbCurrency(context, sourceNormalized.normalization)) sourceNormalized = {
        ...sourceNormalized, amount: null, normalization: unavailableNormalization(candidate, '源文当前金额没有直接附着人民币币种或金额单位，不能将裸数字推定为人民币金额，请人工核对。', 'unsupported'),
      };
    }
    if (sourceNormalized.normalization.status === 'rate_unit_mismatch') appendIssue(reviewed, {
      code: 'rate_unit_mismatch', message: '候选绑定的源文金额直接附着月、日、小时或件单位，与当前金额角色或费率单位冲突，请核对总额与费率。',
    });
    if (candidate.amount !== null && (sourceNormalized.amount === null || sourceNormalized.amount !== candidate.amount)) {
      reviewed.amount = null;
      if (isV3Candidate(candidate)) reviewed.normalization = sourceNormalized.amount === null ? {
        ...sourceNormalized.normalization, reason: `源文上下文约束：${sourceNormalized.normalization.reason}`,
      } : unavailableNormalization(candidate, '源文金额规范结果与候选派生金额不一致，未提供金额提示。');
      appendIssue(reviewed, { code: 'source_amount_context_mismatch', message: '源文局部上下文不支持当前精确金额；未提供精确金额，原始回答与引文仍保留，请核对币种、概数、界限、符号、倍数算式或费率单位。' });
    }
  }
  return reviewed;
}

/** Apply at the store/view boundary, outside formal evaluation. Input state is never mutated. */
export function reviewFactsAgainstSources(state: FactState, sources: FactSource[]): FactState {
  const reviewed = structuredClone(state);
  reviewed.materials = reviewed.materials.map(material => {
    const source = material.status === 'extracted' ? sources.find(item => item.ready && item.id === material.evidenceId && `${item.sha256}:${item.analysisRevision}` === material.signature) : undefined;
    const covered = reviewMaterialCoverage(material, source);
    if (covered.status === 'extracted') covered.candidates = covered.candidates.map(candidate => reviewCandidateAgainstSource(candidate, source));
    return covered;
  });
  return reviewed;
}
