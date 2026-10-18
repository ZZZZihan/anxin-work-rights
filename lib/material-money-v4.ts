import type { CandidateNormalization, NormalizedCandidateValue, RawCandidateV3 } from './material-fact-types-v3.ts';
import { getCandidateLocalEvent, normalizeCandidateValue, normalizeMoneyValue } from './material-facts-v3.ts';
import { parseAmount } from './material-facts.ts';
import { moneyTokenHasNonCurrencyYuan, sourceMoneyHasNonCurrencyYuan, moneyTokenHasNonCurrencySubunit, isNonCurrencySubunitMeasure, sourceMoneyHasNonCurrencySubunit, isRmbCurrencyUnitAt, monetaryExpressionHasUnsupportedCurrency, sourceMoneyHasExplicitRmbCurrency, sourceMoneyHasUnsupportedCurrency } from './material-fact-currency-review.ts';
import { hasAttachedMoneyArithmetic } from './material-fact-arithmetic-review.ts';
import { MONEY_BOUND_PREFIX, MONEY_BOUND_SUFFIX, attachedMoneyQualifierStatus as attachedQualifierStatus, hasMoneyRange, isMoneyRangeEndpoint, moneyQualifierDetectionView } from './material-fact-range-review.ts';

export type MonetaryExpressionClassification = {
  kind: 'monetary' | 'not_monetary' | 'undetermined';
  normalization: CandidateNormalization;
};

const MAX_INPUT = 4000;
const LOWER_DIGITS = '零一二三四五六七八九';
const NUMERALS = '0-9零〇一二三四五六七八九十百千万萬亿億两兩壹贰叁肆伍陆柒捌玖拾佰仟';
const LOWER = '零〇一二三四五六七八九十百千万萬亿億两兩';
const SINGLE_DIGIT = '零〇一二三四五六七八九两兩壹贰叁肆伍陆柒捌玖';
const MASKED = /[xX×＊*]|未知|不详|不明|待定|无法确定|未提供|未明确|未载明|未记载|未披露|未列明|未注明|未约定|未确定|待确认|待核实|待补充|[?？□＿_]|\.{2,}|…/u;
const UNCERTAIN = /(?:可能|或许|大概|估计|不确定|待核|暂计|暂定)/u;
// Keep the established whole-value qualifiers. New boundary words are tested
// only at the matched token below: 不满三个月 must not qualify a later wage.
const APPROXIMATE = new RegExp(`(?:大约|约(?!定|束)|将近|接近|超过|不足|至少|至多|不超过|不少于|不低于|不高于|不得少于|不得低于|不得超过|不得高于|上限|下限|最高|最低)|(?<!最)近\\s*(?:工资|人民币|[¥￥${NUMERALS}])|[${NUMERALS}]\\s*(?:多|余)(?:万|亿)?[元圆圓]|[元圆圓]\\s*${MONEY_BOUND_SUFFIX}`, 'u');
const RANGE_SPACE = String.raw`\s*`;
const RANGE_CURRENCY = '(?:人民币|人民幣|(?<![A-Z])(?:CNY|RMB)(?![A-Z])|¥)';
const RANGE_CURRENCIES = `(?:${RANGE_CURRENCY}${RANGE_SPACE})*`;
const RANGE_UNIT = `(?:元(?!旦|宵|年|月|素|件|音)|[圆圓](?!满|滿|形|圈|周))(?:${RANGE_SPACE}[${NUMERALS}]+[角分]){0,2}(?:整|正)?`;
// An explicit connector may continue over layout whitespace. This numeric
// fallback distinguishes an unfinished endpoint from a date or duration; the
// complete monetary endpoint grammar is shared with source review.
const RANGE_LINK = `${RANGE_SPACE}(?:${RANGE_UNIT}${RANGE_SPACE})?(?:${MONEY_BOUND_SUFFIX}${RANGE_SPACE})?${RANGE_CURRENCIES}(?:至|到|[~～—–-])${RANGE_SPACE}(?:(?:${RANGE_CURRENCY}|${MONEY_BOUND_PREFIX}|(?<!最)近)${RANGE_SPACE}){0,3}`;
const RANGE_NUMERIC_AFTER = new RegExp(`^${RANGE_LINK}[${NUMERALS}]`, 'iu');
const RANGE_TIME_AFTER = new RegExp(`^${RANGE_LINK}(?:[0-9]{4}[-/.][0-9]{1,2}(?:[-/.][0-9]{1,2})?(?![0-9])|[${NUMERALS}]+${RANGE_SPACE}(?:年|个?月|日|天|小时|分钟|秒))`, 'iu');

/** Share the established numeric-continuation fallback with source layout.
 * Complete monetary ranges are checked first by the endpoint guard. */
export function hasUnfinishedMoneyRangeAfter(after: string): boolean {
  const detection = monetaryDetectionView(after);
  return RANGE_NUMERIC_AFTER.test(detection) && !RANGE_TIME_AFTER.test(detection);
}

const RMB_NAME = '(?:人民[币幣]|(?<![A-Za-z])(?:RMB|CNY)(?![A-Za-z]))';
const LITERAL_NUMBER = `(?:(?:\\d[\\d,，]*(?:\\.\\d+)?)\\s*(?:万|萬|亿|億)?|[${LOWER}壹贰叁肆伍陆柒捌玖拾佰仟]+)`;
const SUBUNITS = `(?:[0-9${SINGLE_DIGIT}]角(?:[0-9${SINGLE_DIGIT}]分)?|[0-9${SINGLE_DIGIT}]分)`;
const YUAN_TAIL = `[元圆圓](?:[0-9${SINGLE_DIGIT}]角)?(?:零?[0-9${SINGLE_DIGIT}]分)?(?:整|正)?`;
// New alternatives require an explicit named RMB currency. A bare 5角/2分
// remains unsupported; no time/measure unit is inferred to be money.
const TOKEN = new RegExp(`(?:${RMB_NAME}\\s*${SUBUNITS}(?:整|正)?|${LITERAL_NUMBER}\\s*(?:${YUAN_TAIL}\\s*)?${RMB_NAME}|(?:人民[币幣]\\s*)?[¥￥]?\\s*${LITERAL_NUMBER}\\s*${YUAN_TAIL})`, 'giu');

function result(rawValue: string, status: CandidateNormalization['status'], reason: string, match?: { text: string; index: number; amount: string }): CandidateNormalization {
  return { rawValue, status, amount: match?.amount ?? null, matchedText: match?.text ?? null,
    span: match ? { start: Array.from(rawValue.slice(0, match.index)).length, end: Array.from(rawValue.slice(0, match.index + match.text.length)).length } : null, reason };
}

// Both full literals and clipped source values must consume a modifier before
// the numeric token. It cannot silently turn 数十万 or 负数四万 into its tail.
function monetaryDetectionView(value: string): string {
  // Fold only detection copies; keep line boundaries and every raw offset.
  return moneyQualifierDetectionView(value).replace(/兩/gu, '两').replace(/億/gu, '亿');
}


function smallInteger(value: string): bigint | null {
  if (!value) return 0n;
  let total = 0n, digit: number | null = null, previousUnit = 10000;
  for (const character of value) {
    const n = LOWER_DIGITS.indexOf(character);
    if (n >= 0) {
      if (n === 0) { if (digit !== null) return null; continue; }
      if (digit !== null) return null;
      digit = n;
    } else {
      const unit = ({ 十: 10, 百: 100, 千: 1000 } as Record<string, number>)[character];
      if (!unit || unit >= previousUnit || (digit === null && (unit !== 10 || total !== 0n))) return null;
      total += BigInt(digit ?? 1) * BigInt(unit); digit = null; previousUnit = unit;
    }
  }
  return total + BigInt(digit ?? 0);
}

function lowerSpelling(value: bigint): string {
  if (value === 0n) return '零';
  const small = (n: number) => {
    let output = '', zero = false;
    for (const [unit, label] of [[1000, '千'], [100, '百'], [10, '十'], [1, '']] as const) {
      const digit = Math.floor(n / unit); n %= unit;
      if (digit) { if (zero) output += '零'; output += LOWER_DIGITS[digit] + label; zero = false; }
      else if (output && n) zero = true;
    }
    return output;
  };
  const chunks: number[] = [];
  let n = value;
  while (n) { chunks.push(Number(n % 10000n)); n /= 10000n; }
  let output = '', zero = false;
  for (let index = chunks.length - 1; index >= 0; index--) {
    const chunk = chunks[index];
    if (!chunk) { if (output) zero = true; continue; }
    if (output && (zero || chunk < 1000)) output += '零';
    output += small(chunk) + ['', '万', '亿'][index]; zero = false;
  }
  return output.startsWith('一十') ? output.slice(1) : output;
}

/** Lowercase Arabic-style Chinese integers are checked against their complete spelling.
 * Aliases are local to this parser; no repaired string is sent to the frozen normalizer.
 */
function lowerInteger(value: string): bigint | null {
  if (/两十|十两/u.test(value)) return null;
  const canonicalDigits = Array.from(value, character => character === '〇' ? '零' : character === '两' ? '二' : character).join('');
  const parseWan = (text: string): bigint | null => {
    const parts = text.split('万');
    if (parts.length > 2) return null;
    if (parts.length === 1) return smallInteger(text);
    const high = smallInteger(parts[0]), low = smallInteger(parts[1]);
    return high === null || low === null || high === 0n ? null : high * 10000n + low;
  };
  const parts = canonicalDigits.split('亿');
  if (parts.length > 2) return null;
  let yuan: bigint | null;
  if (parts.length === 1) yuan = parseWan(canonicalDigits);
  else {
    const high = parseWan(parts[0]), low = parseWan(parts[1]);
    yuan = high === null || low === null || high === 0n || high >= 10000n ? null : high * 100000000n + low;
  }
  if (yuan === null) return null;
  const spelling = lowerSpelling(yuan);
  return canonicalDigits === spelling || (spelling.startsWith('十') && canonicalDigits === `一${spelling}`) ? yuan : null;
}

function subunitDigit(character: string | undefined): bigint {
  if (character === undefined || character === '〇') return 0n;
  if (character === '两') return 2n;
  const lower = LOWER_DIGITS.indexOf(character), upper = '零壹贰叁肆伍陆柒捌玖'.indexOf(character);
  return lower >= 0 ? BigInt(lower) : upper >= 0 ? BigInt(upper) : BigInt(character);
}

function amountWithSubunits(yuan: bigint, jiao: string | undefined, zero: string | undefined, fen: string | undefined): string | null {
  // A zero may bridge an omitted jiao, not introduce a second fen digit or
  // follow an explicit jiao. Redundant 零零/零〇分 remain unsupported.
  if (zero && (jiao !== undefined || subunitDigit(fen) === 0n)) return null;
  const cents = yuan * 100n + subunitDigit(jiao) * 10n + subunitDigit(fen);
  return parseAmount(`${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`)?.amount ?? null;
}

function parseLowerAmount(text: string): string | null {
  const match = text.match(new RegExp(`^(?:人民币\\s*)?[¥￥]?\\s*([${LOWER}]+)\\s*[元圆](?:([0-9${SINGLE_DIGIT}])角)?(?:(零?)([0-9${SINGLE_DIGIT}])分)?(?:整|正)?$`, 'u'));
  if (!match) return null;
  const yuan = lowerInteger(match[1]);
  return yuan === null ? null : amountWithSubunits(yuan, match[2], match[3], match[4]);
}

/** Whole Arabic yuan plus single-digit subunits; never add to a decimal/scaled
 * yuan token or infer omitted units. Keep cents exact through the range check.
 */
function parseArabicSubunits(text: string): string | null {
  const match = text.match(new RegExp(`^(?:人民币\\s*)?[¥￥]?\\s*((?:\\d{1,3}(?:[,，]\\d{3})+|\\d+))\\s*[元圆](?:([0-9${SINGLE_DIGIT}])角)?(?:(零?)([0-9${SINGLE_DIGIT}])分)?(?:整|正)?$`, 'u'));
  if (!match || (match[2] === undefined && match[4] === undefined)) return null;
  return amountWithSubunits(BigInt(match[1].replace(/[,，]/gu, '')), match[2], match[3], match[4]);
}

function parseFinancialSubunits(text: string): string | null {
  const match = text.match(new RegExp(`^(?:人民币\\s*)?[¥￥]?\\s*([零壹贰叁肆伍陆柒捌玖拾佰仟万亿]+)\\s*[元圆](?:([0-9${SINGLE_DIGIT}])角)?(?:(零?)([0-9${SINGLE_DIGIT}])分)?(?:整|正)?$`, 'u'));
  if (!match) return null;
  // Reuse the frozen canonical financial-integer grammar for the yuan part;
  // do not invent a second upper-case numeral parser or repair shorthand.
  const yuan = normalizeMoneyValue(`${match[1]}元`);
  return yuan.status === 'exact' && yuan.amount?.endsWith('.00')
    ? amountWithSubunits(BigInt(yuan.amount.slice(0, -3)), match[2], match[3], match[4]) : null;
}

function parseExplicitRmbSubunits(text: string): string | null {
  const match = text.match(new RegExp(`^${RMB_NAME}\\s*(?:([0-9${SINGLE_DIGIT}])角(?:([0-9${SINGLE_DIGIT}])分)?|([0-9${SINGLE_DIGIT}])分)(?:整|正)?$`, 'iu'));
  return match ? amountWithSubunits(0n, match[1], undefined, match[2] ?? match[3]) : null;
}

function remainingNumbers(rawValue: string, index: number, text: string): string {
  // Work only on a separate validation view. Returned spans always address the original string.
  const rest = (rawValue.slice(0, index) + '\u0000' + rawValue.slice(index + text.length)).normalize('NFKC');
  const count = `[${NUMERALS}]+`;
  return rest.replace(/\d{4}[-/.]\d{1,2}(?:[-/.]\d{1,2})?/gu, '')
    .replace(new RegExp(`${count}\\s*年(?:\\s*${count}\\s*月(?:\\s*${count}\\s*日)?)?`, 'gu'), '')
    .replace(new RegExp(`${count}(?:\\.\\d+)?\\s*(?:个?月|天|日|小时|分钟|秒|件|(?:个|名|位)(?:工人|员工|劳动者)|名|人|倍|年)`, 'gu'), '');
}

/** Parse one complete RMB literal with exact cents, preserving the unmodified evidence. */
export function normalizeMoneyValueV4(rawValue: string): CandidateNormalization {
  if (rawValue.length > MAX_INPUT) return result(rawValue, 'unsupported', '金额原文超过4000字符上限，未尝试解析或截断。');
  if (monetaryExpressionHasUnsupportedCurrency(rawValue) || /±/u.test(rawValue)) return result(rawValue, 'unsupported', '仅支持明确人民币金额，外币、币种冲突和正负范围符号未转换。');
  if (/[％%]|百分之/u.test(rawValue)) return result(rawValue, 'percentage', '比例不能作为精确金额。');
  const isRange = hasMoneyRange(monetaryDetectionView(rawValue));
  const matches = [...rawValue.matchAll(new RegExp(TOKEN.source, TOKEN.flags))];
  // An explicit operation is distinct from a redaction: ×/x/* must not hide
  // the fact that the matched amount is only an operand. Keep raw indices.
  if (!isRange && matches.length === 1) {
    const match = matches[0];
    if (hasAttachedMoneyArithmetic(rawValue.slice(0, match.index), rawValue.slice(match.index + match[0].length))) return result(rawValue, 'unsupported', '金额直接参与倍数或算式，未把其中的金额操作数当作计算结果。');
  }
  if (MASKED.test(rawValue)) return result(rawValue, 'masked', '金额未知、未明确或被遮盖；保留原文且不转换为零。');
  if (UNCERTAIN.test(rawValue)) return result(rawValue, 'uncertain', '金额有不确定或待核表述。');
  if (isRange) return result(rawValue, 'range', '金额属于区间，未选取单个端点。');
  if (APPROXIMATE.test(monetaryDetectionView(rawValue))) return result(rawValue, 'approximate', '金额是概数或界限，未转成精确金额。');

  if (matches.length > 1) return result(rawValue, 'multiple_amounts', '原文含多笔金额，无法唯一选取。');
  if (matches.length === 1) {
    const match = matches[0], text = match[0].trimStart(), index = match.index + match[0].length - text.length;
    const before = rawValue.slice(0, index).trimEnd(), after = rawValue.slice(index + text.length);
    if (moneyTokenHasNonCurrencyYuan(text, after)) return result(rawValue, 'unsupported', '匹配到的元或圆属于完整普通词语，不能截成金额单位。');
    if (moneyTokenHasNonCurrencySubunit(text, after)) return result(rawValue, 'unsupported', '匹配到的角或分属于时间、计量或普通词语，未作为分币金额。');
    const qualifierStatus = attachedQualifierStatus(before, after);
    if (qualifierStatus) return result(rawValue, qualifierStatus, '完整金额带有数量不定、概数界限或正负限定，未截取其中的精确正数。');
    const yuanAt = text.search(/[元圆圓]/u);
    if (yuanAt >= 0 && !isRmbCurrencyUnitAt(rawValue, index + yuanAt)) return result(rawValue, 'unsupported', '匹配到的元或圆属于普通词语，不能截成金额单位。');
    if (new RegExp(`[${NUMERALS}０-９,.，负負+＋\\-－−﹣¥￥]$`, 'u').test(before)
      || new RegExp(`^[${NUMERALS}０-９,.，元圆圓角分整正]`, 'u').test(after)) return result(rawValue, 'unsupported', '完整金额的数字、单位或符号边界不合法，未截取其中有效片段。');
    const rest = remainingNumbers(rawValue, index, text)
      .replace(/(?:一共|一次性|一并|同一|唯一|统一|另一笔|一笔)/gu, '')
      .replace(new RegExp(`第[${NUMERALS}]+(?:笔|次|项|条|人)`, 'gu'), '');
    if (new RegExp(`[${NUMERALS}０-９]`, 'u').test(rest)) return result(rawValue, 'multiple_amounts', '原文仍有无法解释为日期、计数或倍数的数字，可能存在省略币种的另一笔金额或复杂中文数表达。');
    // Currency spelling aliases exist only in this parse copy after the raw
    // token is anchored. Returned evidence and code-point spans use text/rawValue.
    let parseText = text.replace(/^人民幣/u, '人民币').replace(/圓/gu, '圆').replace(/萬/gu, '万').replace(/億/gu, '亿').replace(/兩/gu, '两');
    const subunitAmount = parseExplicitRmbSubunits(parseText);
    // A postfix currency label is replaced only in this parse copy, after the
    // complete original token has been anchored. Never change returned spans.
    const postfix = parseText.match(new RegExp(`\\s*${RMB_NAME}$`, 'iu'));
    if (postfix) {
      parseText = parseText.slice(0, postfix.index).trimEnd();
      if (!/[元圆角分整正]$/u.test(parseText)) parseText += '元';
    }
    const onlyLower = new RegExp(`^(?:人民币\\s*)?[¥￥]?\\s*[${LOWER}]+\\s*[元圆][0-9${LOWER}${SINGLE_DIGIT}角分整正]*$`, 'u').test(parseText);
    const onlyFinancial = new RegExp(`^(?:人民币\\s*)?[¥￥]?\\s*[零壹贰叁肆伍陆柒捌玖拾佰仟万亿]+\\s*[元圆][0-9${SINGLE_DIGIT}角分整正]*$`, 'u').test(parseText);
    const parsed = subunitAmount ?? (onlyLower ? parseLowerAmount(parseText) : onlyFinancial ? parseFinancialSubunits(parseText) : parseArabicSubunits(parseText) ?? normalizeMoneyValue(parseText).amount);
    return parsed ? result(rawValue, 'exact', '唯一完整人民币金额已精确解析；原文和位置保持不变。', { text, index, amount: parsed })
      : result(rawValue, 'unsupported', '金额语法、精度或数值范围不受支持，未猜测省略位数。');
  }
  // Retain the frozen implementation's bare-Arabic-number compatibility only for a whole value.
  return normalizeMoneyValue(rawValue);
}

/** Adds source-bound qualifier checks without modifying source text or frozen representations. */
/** An immediately following uncertainty marker can be cropped out of value
 * and quote. Inspect a detection copy, retaining punctuation as evidence. */
export function hasPostposedMoneyUncertainty(after: string): boolean {
  const text = after.normalize('NFKC').replace(/\p{Cf}/gu, '');
  return /^\s*(?:[元圆圓]|人民币|人民幣|RMB|CNY)?\s*[()[\]{}【】]*\s*(?:[?□_]|待核(?:实)?|待(?:定|确认|补充)|未知|不详|不明|无法确定|未(?:提供|明确|载明|记载|披露|列明|注明|约定|确定)|\.{2,}|…)/iu.test(text);
}

export function normalizeCandidateValueV4(candidate: RawCandidateV3): NormalizedCandidateValue {
  if (candidate.kind === 'money' && (candidate.value.length > MAX_INPUT || candidate.quote.length > MAX_INPUT)) {
    const normalization = result(candidate.value, 'unsupported', '金额或引用原文超过4000字符上限，未截断解析。');
    return { value: candidate.value, amount: null, rateUnit: candidate.rateUnit, normalization };
  }
  const legacy = normalizeCandidateValue(candidate);
  if (candidate.kind === 'date' || legacy.normalization.status === 'rate_unit_mismatch') return legacy;
  let normalized = normalizeMoneyValueV4(candidate.value);
  if (normalized.status === 'exact') {
    const local = getCandidateLocalEvent(candidate);
    if (local.text === null) normalized = result(candidate.value, 'uncertain', '金额原文在引用中缺失或重复，无法唯一定位当前事件。');
    else {
      const offset = local.text.indexOf(candidate.value), before = local.text.slice(0, offset), after = local.text.slice(offset + candidate.value.length);
      // The unique quote anchor is already verified above. An explicit
      // arithmetic continuation can cross a layout newline outside local.text;
      // only this guard uses the complete quote, through the shared grammar.
      const quoteOffset = candidate.quote.indexOf(candidate.value);
      const arithmeticBefore = candidate.quote.slice(0, quoteOffset), arithmeticAfter = candidate.quote.slice(quoteOffset + candidate.value.length);
      const beforeBoundary = monetaryDetectionView(before).trimEnd(), afterBoundary = monetaryDetectionView(after).trimStart();
      const bareValue = !/人民[币幣]|[元圆圓¥￥]/u.test(candidate.value);
      const attachedYuan = new RegExp(`^\\s*[元圆圓](?:整|正)?(?=$|[^${NUMERALS}元圆圓角分整正])`, 'u').test(after);
      const sourceAnchor = { blockText: local.text, valueStart: offset };
      const attachedCurrency = sourceMoneyHasExplicitRmbCurrency(sourceAnchor, normalized);
      const rateUnits: Record<string, RawCandidateV3['rateUnit']> = { 小时: 'hour', 月: 'month', 日: 'day', 天: 'day', 时: 'hour', 件: 'piece' };
      const qualifierStatus = attachedQualifierStatus(arithmeticBefore, arithmeticAfter);
      const valueCharacters = Array.from(candidate.value), span = normalized.span;
      const rangeBefore = arithmeticBefore + (span ? valueCharacters.slice(0, span.start).join('') : '');
      const rangeToken = span ? valueCharacters.slice(span.start, span.end).join('') : candidate.value;
      const rangeAfter = (span ? valueCharacters.slice(span.end).join('') : '') + arithmeticAfter;
      // A slash explicitly names a denominator: retain unsupported units as
      // unresolved rates rather than silently treating their numerator as a
      // total. The existing finite units keep their following-prose behavior.
      // Fold only this detection copy; raw value/quote and CP spans stay intact.
      const rateAfter = monetaryDetectionView(rangeAfter).replace(/[^\S\r\n\u2028\u2029]/gu, '');
      const suffixRate = rateAfter.match(/^\s*(?:[元圆圓]\s*)?(?:\/\s*([\p{L}]+)|每\s*(小时|月|日|天|时|件|年|周|週|季度|季|次|分钟|分鐘|秒|公里|人|班))/u);
      const rateText = suffixRate?.[1] ?? suffixRate?.[2];
      const supportedRate = rateText?.match(/^(小时|月|日|天|时|件)/u)?.[1];
      if (sourceMoneyHasNonCurrencyYuan({ blockText: candidate.quote, valueStart: quoteOffset }, normalized)) normalized = result(candidate.value, 'unsupported', '原文中的元或圆属于完整普通词语，裁剪后的片段未作为人民币金额。');
      else if (sourceMoneyHasNonCurrencySubunit({ blockText: candidate.quote, valueStart: quoteOffset }, normalized)) normalized = result(candidate.value, 'unsupported', '原文中的角或分属于普通词语，裁剪后的片段未作为分币金额。');
      else if (sourceMoneyHasUnsupportedCurrency(sourceAnchor, normalized, candidate.subject)) normalized = result(candidate.value, 'unsupported', '原文金额直接附着外币或冲突币种，未换算。');
      else if (suffixRate && !supportedRate) normalized = result(candidate.value, 'unsupported', '原文金额直接附着不受支持的费率单位，保留原文且未换算为总额或现有费率单位。');
      else if (supportedRate && (candidate.meaning !== 'rate' || (candidate.rateUnit !== 'unknown' && candidate.rateUnit !== rateUnits[supportedRate]))) normalized = result(candidate.value, 'rate_unit_mismatch', '原文紧贴的费率单位与金额角色或候选费率单位冲突。');
      else if (isMoneyRangeEndpoint(monetaryDetectionView(rangeBefore), monetaryDetectionView(rangeToken), monetaryDetectionView(rangeAfter))) normalized = result(candidate.value, 'range', '当前金额在原文中直接属于区间端点。');
      else if (hasPostposedMoneyUncertainty(rangeAfter)) normalized = result(candidate.value, 'uncertain', '当前金额后直接附着问号、待核或未知标记，未将裁剪值作为精确金额。');
      else if (hasUnfinishedMoneyRangeAfter(arithmeticAfter)) normalized = result(candidate.value, 'uncertain', '连接词后的数字未形成完整金额或明确时间，不能确认被截取的数值可用。');
      else if (hasAttachedMoneyArithmetic(arithmeticBefore, arithmeticAfter)) normalized = result(candidate.value, 'unsupported', '当前金额在原文中直接参与倍数或算式，未把裁剪后的金额操作数当作计算结果。');
      else if (qualifierStatus) normalized = result(candidate.value, qualifierStatus, '当前金额在原文中直接附着数量不定、概数界限或正负限定，未截取为精确正数。');
      else if (/(?:可能|或许|大概|估计|待核|暂计|暂定)(?:为|工资|金额|人民币|\s)*$/u.test(before) || /(?:或|或者)\s*$/u.test(before)
        || new RegExp(`^\\s*(?:或|或者)\\s*(?:${RMB_NAME}\\s*)?[${NUMERALS}]`, 'iu').test(after)) normalized = result(candidate.value, 'uncertain', '当前金额在原文中有直接附着的不确定或备选表述。');
      else if (bareValue && !attachedCurrency) normalized = result(candidate.value, 'unsupported', 'value 和当前原文锚点均无明确人民币单位，未猜测这是金额。');
      else if (new RegExp(`[${NUMERALS},.，]$`, 'u').test(beforeBoundary)
        || new RegExp(`[${NUMERALS}][元圆圓]?\\s*(?:点|又|分之|加上|另加|加|减|乘|除)\\s*$`, 'u').test(beforeBoundary)
        || /^[,.，]\d/u.test(afterBoundary)
        || (!attachedYuan && new RegExp(`^[${NUMERALS}元圆圓角分整正]`, 'u').test(afterBoundary))) normalized = result(candidate.value, 'unsupported', 'value 截去了直接相邻的金额数字或角分，未升级为精确金额。');
      else if (legacy.normalization.status !== 'unsupported' && legacy.normalization.status !== 'multiple_amounts'
        && !(legacy.normalization.status === 'range' && RANGE_TIME_AFTER.test(monetaryDetectionView(arithmeticAfter)))) normalized = legacy.normalization;
    }
  }
  return { value: normalized.amount ?? candidate.value, amount: normalized.amount, rateUnit: candidate.rateUnit, normalization: normalized };
}

/** A three-way gate: only positively identified non-money is safe to reject.
 * Unknown or complex input is retained for review instead of requiring an ASCII digit.
 */
export function classifyMonetaryExpression(value: string): MonetaryExpressionClassification {
  const normalization = normalizeMoneyValueV4(value);
  const detection = monetaryDetectionView(value).replace(/\s/gu, '');
  // Only a complete percentage (optionally named by a finite ratio label) is
  // definite non-money. This whole-value grammar contains no currency unit;
  // in particular 百分比 must not be cropped into 百分 as a fen amount.
  // 四万元的50% and unknown ratio prose cannot match and remain reviewable.
  const ratioNumber = `[+−负負-]?[${NUMERALS}]+(?:[.点][${NUMERALS}]+)?`;
  const ratioDescription = new RegExp(`^(?:(?:出勤率|出勤比例|支付比例|计发比例|折算比例|比例|百分比)(?:为|是|:)?)?(?:${ratioNumber}%|百分之${ratioNumber})$`, 'u');
  if (ratioDescription.test(detection)) return { kind: 'not_monetary', normalization: result(value, 'not_money', '原文仅为比例或百分比，未表述金额。') };
  const proportionDescription = new RegExp(`^(?:打)?(?:${ratioNumber}(?:成(?:[0-9零〇一二三四五六七八九半])?|折)|半[成折]|[对對]折)$`, 'u');
  if (proportionDescription.test(detection)) return { kind: 'not_monetary', normalization: result(value, 'not_money', '原文仅为成数或折扣，未表述金额。') };
  const explicit = /人民[币幣]|[¥￥]/u.test(value) || monetaryExpressionHasUnsupportedCurrency(value)
    || [...value.matchAll(/[元圆圓]/gu)].some(match => isRmbCurrencyUnitAt(value, match.index))
    || [...detection.matchAll(new RegExp(`[${NUMERALS}]+[角分]`, 'gu'))]
      .some(match => !moneyTokenHasNonCurrencySubunit(match[0], detection.slice(match.index + match[0].length)));
  if (normalization.status === 'exact' || explicit) return { kind: 'monetary', normalization };
  if (MASKED.test(value) && /工资|薪资|薪酬|金额|款项|欠薪|报酬|劳务费|付款|应付|实付|已付|尚欠|欠款/u.test(value)) return { kind: 'monetary', normalization };
  const ordinaryCount = detection.match(new RegExp(`^[${NUMERALS}]+([角分].*)$`, 'u'));
  if (ordinaryCount && isNonCurrencySubunitMeasure(ordinaryCount[1]) && !MASKED.test(value))
    return { kind: 'not_monetary', normalization: result(value, 'not_money', '原文仅为时间、计量或普通词语的计数，未表述金额。') };
  const count = `[${NUMERALS}]+`;
  const date = `(?:[${NUMERALS}]+\\s*年(?:\\s*(?:[${NUMERALS}]+月份?|元月份?|元旦)(?:\\s*[${NUMERALS}]+\\s*日)?)?|\\d{4}[-/.]\\d{1,2}(?:[-/.]\\d{1,2})?)`;
  // Keep the definite relative-month forms aligned with sourceRateUnit's
  // calendar-period boundary; the anchored wage grammar still requires no amount.
  const relativeMonth = '(?:上(?:一?个)?|下(?:一?个)?|本|当|该|这(?:个)?|某|每)月';
  // These definite day references name a wage period only inside the complete
  // amount-free description below; never remove them from an unknown amount.
  const relativeDay = '(?:(?:今|昨|明|前|后|当)(?:日|天)|本日|该日|(?:这|那)(?:日|天|一天)|同(?:日|一天)|(?:前|后|上|下)一(?:日|天)|次日|翌日)';
  const dayStage = `(?:${relativeDay}|每(?:日|天)|日|某日|该天)`;
  const wageStage = `(?:${date}(?:\\s*(?:至|到|[~～—–-])\\s*${date})?|[${NUMERALS}]+月份?|元月份?|元旦|${relativeMonth}|月|${dayStage}|离职前|入职前|入职后|试用期|本期)`;
  const wageDescription = new RegExp(`^(?:${wageStage}\\s*)?(?:的)?(?:基本|其他|其余|全部|正常|岗位|绩效|应付|已付|实付|税前|税后|拖欠|欠付|未付)?(?:工资|薪资|薪酬|劳务费|劳动报酬)(?:合计|总额|标准)?$`, 'u');
  // This separate finite wage-label view changes no amount grammar or source
  // text. Unknown/masked suffixes cannot match the complete empty-label rule.
  const wageLabel = value.trim().replace(/[資勞動報務費應標準稅後崗績離職試]/gu,
    character => ({ 資: '资', 勞: '劳', 動: '动', 報: '报', 務: '务', 費: '费', 應: '应', 標: '标', 準: '准', 稅: '税', 後: '后', 崗: '岗', 績: '绩', 離: '离', 職: '职', 試: '试' })[character]!);
  if (wageDescription.test(wageLabel) && !MASKED.test(value)) return { kind: 'not_monetary', normalization: result(value, 'not_money', '原文为工资名称或期间描述，未表述金额。') };
  const ordinaryWord = /^(?:元月份?|元旦|元宵(?:节)?|元年|元素|元件|元音|[圆圓](?:满|滿|形|圈|周))$/u;
  const wageCompletion = /^(?:已|已经)?[圆圓][满滿](?:完成)?(?:工资|薪资|薪酬|劳务费|劳动报酬)(?:发放|支付|结算)(?:工作)?$/u;
  if (!MASKED.test(value) && (ordinaryWord.test(value.trim()) || wageCompletion.test(value.trim()) || new RegExp(`^${date}$`, 'u').test(value.trim()))) return { kind: 'not_monetary', normalization: result(value, 'not_money', '原文为日期、普通词语或工资发放描述，未表述金额。') };
  const withoutDatesAndCounts = value.trim().replace(/\d{4}[-/.]\d{1,2}(?:[-/.]\d{1,2})?/gu, '')
    .replace(new RegExp(`${count}\\s*(?:年|个?月|天|日|小时|分钟|件|名(?:工人|员工|劳动者)?|(?:个|位)(?:工人|员工|劳动者)|个?人|位|个|倍|次)`, 'gu'), '')
    .replace(/(?:工资|薪资|薪酬|劳务费|劳动报酬|应付|已付|实付|月薪|日薪|时薪|工作|为|是|按月|按日|发放|支付|劳动者|每月|每年|每|共计|计|[\s，,。:：;；至到])/gu, '');
  if ((!value.trim() || !withoutDatesAndCounts) && !MASKED.test(value)) return { kind: 'not_monetary', normalization: result(value, 'not_money', '原文仅为日期、普通计数或无金额工资描述。') };
  return { kind: 'undetermined', normalization };
}

/** A conservative comparison key, never a calculation amount.
 * Exact amounts share a key across supported spellings. For non-exact values, only an
 * anchored single amount with explicit qualifiers and an optional wage-name suffix is
 * comparable; qualifiers retain their words and positions. Complex inputs return null.
 */
export function canonicalMonetaryExpression(value: string): string | null {
  const normalization = normalizeMoneyValueV4(value);
  if (normalization.status === 'exact') return `exact:${normalization.amount}`;
  if (!['approximate', 'uncertain'].includes(normalization.status)) return null;
  // Comparison-only folding has no source offsets or calculation authority.
  // Reuse the finite qualifier grammar while retaining each word and its side:
  // 不满/不少于/不到/开外 must never collapse into each other or an exact key.
  const wrapped = monetaryDetectionView(value).trim().replace(/\s*(?:工[资資]|[劳勞][务務][费費]|[劳勞][动動][报報]酬)\s*$/u, '').trim();
  const leadingRmb = wrapped.match(/^人民[币幣]\s*/u)?.[0] ?? '';
  const text = wrapped.slice(leadingRmb.length);
  const prefix = text.match(new RegExp(`^(${MONEY_BOUND_PREFIX}|近|可能|或许|大概|估计|不确定|待核|暂计|暂定)\\s*`, 'u'));
  const suffix = text.match(new RegExp(`\\s*(${MONEY_BOUND_SUFFIX})$`, 'u'));
  const start = prefix?.[0].length ?? 0, end = suffix ? text.length - suffix[0].length : text.length;
  if (end <= start) return null;
  let literal = text.slice(start, end).trim();
  const inner = literal.match(new RegExp(`^(?:人民[币幣]\\s*)?([${NUMERALS},.，]+)(多|余)([元圆圓])$`, 'u'));
  if (inner) {
    // This synthetic literal exists only to derive a comparison key; no source span,
    // normalized candidate, or calculation amount is created from repaired evidence.
    const base = normalizeMoneyValueV4(`${inner[1]}${inner[3]}`);
    return base.status === 'exact' ? `${normalization.status}:${prefix?.[1] ?? ''}:${base.amount}:${suffix?.[1] ?? ''}:inner=${inner[2]}` : null;
  }
  if (!prefix && !suffix) return null;
  let exact = normalizeMoneyValueV4(literal);
  // The outer currency was removed only to locate the finite qualifier. A
  // subunit literal still needs that same explicit RMB; never infer it naked.
  if (exact.status !== 'exact' && leadingRmb) {
    literal = leadingRmb + literal;
    exact = normalizeMoneyValueV4(literal);
  }
  // Whole-literal anchoring prevents removing a wage noun from a complex narrative.
  if (exact.status !== 'exact' || exact.matchedText !== literal) return null;
  return `${normalization.status}:${prefix?.[1] ?? ''}:${exact.amount}:${suffix?.[1] ?? ''}`;
}
