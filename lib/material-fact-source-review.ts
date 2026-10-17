import type { FactCandidate, FactSource, FactState } from './material-fact-types';
import type { CandidateNormalization, FactReviewIssue, RateUnit, RawCandidateV3 } from './material-fact-types-v3';
import { getCandidateRepresentation, isV2Candidate, isV3Candidate, normalizeCandidateValue } from './material-facts-v3.ts';

/** Runtime source review is deliberately separate from the frozen extraction/evaluation contract. */
export type SourceFactReviewIssue = FactReviewIssue | {
  code: 'source_amount_context_mismatch' | 'source_evidence_unresolved';
  message: string;
};
type ReviewedCandidate = FactCandidate & { reviewIssues: SourceFactReviewIssue[]; normalization?: CandidateNormalization };
type AnchoredSourceEvent = { text: string; blockText: string; valueStart: number };
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
  return { text, blockText: block.text, valueStart };
}

function hasGroupText(text: string): boolean {
  if (/(?:班组|全组|全体(?:工人|员工|劳动者|农民工)?|多人|多名(?:工人|员工|劳动者|农民工))/u.test(text)) return true;
  return [...text.matchAll(/(?<![第0-9一二三四五六七八九十百千万零两])([0-9一二三四五六七八九十百千万零两]+)\s*(?:名|位|人)(?:工人|员工|劳动者|农民工)?/gu)]
    .some(match => /^\d+$/u.test(match[1]) ? BigInt(match[1]) > 1n : !['一', '零'].includes(match[1]));
}
function appendIssue(candidate: ReviewedCandidate, issue: SourceFactReviewIssue) {
  if (!candidate.reviewIssues.some(existing => existing.code === issue.code)) candidate.reviewIssues.push(issue);
}
function unavailableNormalization(candidate: FactCandidate, reason: string, status: CandidateNormalization['status'] = 'uncertain'): CandidateNormalization {
  return { rawValue: candidate.value, status, amount: null, matchedText: null, span: null, reason };
}

function monetaryEdges(context: AnchoredSourceEvent, normalized: CandidateNormalization) {
  if (!normalized.span) return null;
  const characters = Array.from(normalized.rawValue);
  const start = context.valueStart + characters.slice(0, normalized.span.start).join('').length;
  const end = context.valueStart + characters.slice(0, normalized.span.end).join('').length;
  return { before: context.blockText.slice(0, start).replace(/[^\S\r\n]+$/u, ''), after: context.blockText.slice(end).replace(/^[^\S\r\n]+/u, ''), matched: context.blockText.slice(start, end) };
}

/** Inspect the original block: a grouping comma may already be outside the local clause. */
function truncatedMoneyToken(context: AnchoredSourceEvent, normalized: CandidateNormalization): boolean {
  const edges = monetaryEdges(context, normalized);
  if (!edges) return false;
  const numerals = '0-9０-９零〇一二三四五六七八九十百千万亿两壹贰叁肆伍陆柒捌玖拾佰仟';
  if (new RegExp(`[${numerals}.．]$`, 'u').test(edges.before)
    || new RegExp(`[${numerals}][^\\S\\r\\n]*[,，]$`, 'u').test(edges.before)) return true;
  if (!/[元圆角分](?:整|正)?$/u.test(edges.matched)) {
    if (new RegExp(`^[${numerals}.．]`, 'u').test(edges.after)
      || new RegExp(`^[,，][^\\S\\r\\n]*[${numerals}]`, 'u').test(edges.after)) return true;
  }
  // A bare historical number followed only by 元/圆 keeps its old numeric meaning.
  // Extra 角/分, including after an omitted 元, changes that same amount.
  return new RegExp(`^(?:[元圆]\\s*)?[${numerals}]+\\s*[角分]`, 'u').test(edges.after);
}

function sourceRateUnit(context: AnchoredSourceEvent, normalized: CandidateNormalization): RateUnit | null {
  const edges = monetaryEdges(context, normalized);
  if (!edges) return null;
  const before = edges.before.split(/[，,。！？!?；;\n\r]/u).at(-1)!, after = edges.after.split(/[，,。！？!?；;\n\r]/u)[0];
  const units: Record<string, RateUnit> = { 月: 'month', 日: 'day', 天: 'day', 小时: 'hour', 时: 'hour', 件: 'piece' };
  const suffix = after.match(/^(?:[元圆]\s*)?(?:[/／]\s*|每\s*)(小时|月|日|天|时|件)/u);
  if (suffix) return units[suffix[1]];
  const prefix = before.match(/(?:每\s*(小时|月|日|天|时|件)|(月|日|时)(?:薪|工资)|小时工资|计件(?:单价|工资)?)(?:为|是|计|共|合计|工资|薪酬|薪资|金额|人民币|[¥￥]|\s)*$/u);
  if (!prefix) return null;
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
  if (raw.scope === 'individual' && hasGroupText(context.text)) appendIssue(reviewed, {
    code: 'scope_text_mismatch', message: '候选绑定的源文局部事件含班组或多人表述，与“个人”标注不一致；模型裁剪引文不能排除该主体线索，请人工核对。',
  });
  if (raw.kind === 'date' && raw.meaning === 'employment_period' && /(?:签订|签署|订立|签约|签字|签章)/u.test(context.text)) appendIssue(reviewed, {
    code: 'contract_signing_as_employment', message: '候选绑定的源文局部日期事件含签约表述，请核对是否确为任职日期；此为词法线索，不自动改变日期角色。',
  });
  if (raw.kind === 'money' && raw.meaning === 'paid_total' && (raw.completeness === 'partial' || /(?:单笔|本次|此次|一笔|该笔|部分|先付|预付|预支)/u.test(context.text))) appendIssue(reviewed, {
    code: 'partial_paid_total', message: '候选绑定的源文局部事件含单笔或部分付款表述，不能因裁剪引文就提示为本期完整已付总额，请核对付款范围。',
  });
  if (raw.kind === 'money') {
    // Reuse the frozen normalizer only as a runtime source constraint. Its raw/value/quote
    // and the frozen model result remain intact; only derived availability can decrease.
    let sourceNormalized = normalizeCandidateValue({ ...raw, quote: context.text });
    if (sourceNormalized.amount !== null) {
      if (truncatedMoneyToken(context, sourceNormalized.normalization)) sourceNormalized = {
        ...sourceNormalized, amount: null, normalization: unavailableNormalization(candidate, '候选只覆盖源文金额数值的一部分，可能截去了前导数字、小数、分组、中文单位或角分，未生成精确金额。', 'unsupported'),
      };
      else if (sourceUnitMismatch(raw, sourceRateUnit(context, sourceNormalized.normalization))) sourceNormalized = {
        ...sourceNormalized, amount: null, normalization: unavailableNormalization(candidate, '源文金额直接附着费率单位，与当前总额角色或已声明费率单位冲突，未生成精确金额。', 'rate_unit_mismatch'),
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
      appendIssue(reviewed, { code: 'source_amount_context_mismatch', message: '源文局部上下文不支持当前精确金额；未提供精确金额，原始回答与引文仍保留，请核对概数、界限、符号或费率单位。' });
    }
  }
  return reviewed;
}

/** Apply at the store/view boundary, outside formal evaluation. Input state is never mutated. */
export function reviewFactsAgainstSources(state: FactState, sources: FactSource[]): FactState {
  const reviewed = structuredClone(state);
  for (const material of reviewed.materials) {
    if (material.status !== 'extracted') continue;
    const source = sources.find(item => item.ready && item.id === material.evidenceId && `${item.sha256}:${item.analysisRevision}` === material.signature);
    material.candidates = material.candidates.map(candidate => reviewCandidateAgainstSource(candidate, source));
  }
  return reviewed;
}
