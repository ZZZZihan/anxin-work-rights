import type { CandidateNormalization, NormalizedCandidateValue, RawCandidateV3 } from './material-fact-types-v3.ts';
import { getCandidateLocalEvent, normalizeCandidateValue, normalizeMoneyValue } from './material-facts-v3.ts';
import { parseAmount } from './material-facts.ts';
import { moneyTokenHasNonCurrencySubunit, isNonCurrencySubunitMeasure, sourceMoneyHasNonCurrencySubunit, isRmbCurrencyUnitAt, monetaryExpressionHasUnsupportedCurrency, sourceMoneyHasExplicitRmbCurrency, sourceMoneyHasUnsupportedCurrency } from './material-fact-currency-review.ts';
import { hasAttachedMoneyArithmetic } from './material-fact-arithmetic-review.ts';
import { hasConjunctionMoneyRange, isConjunctionMoneyRangeEndpoint } from './material-fact-range-review.ts';

export type MonetaryExpressionClassification = {
  kind: 'monetary' | 'not_monetary' | 'undetermined';
  normalization: CandidateNormalization;
};

const MAX_INPUT = 4000;
const LOWER_DIGITS = '零一二三四五六七八九';
const NUMERALS = '0-9零〇一二三四五六七八九十百千万亿两壹贰叁肆伍陆柒捌玖拾佰仟';
const LOWER = '零〇一二三四五六七八九十百千万亿两';
const SINGLE_DIGIT = '零〇一二三四五六七八九两壹贰叁肆伍陆柒捌玖';
const MASKED = /[xX×＊*]|未知|不详|不明|待定|无法确定|未提供|未明确|未载明|未记载|未披露|未列明|未注明|未约定|未确定|待确认|待核实|待补充|[?？□＿_]|\.{2,}|…/u;
const UNCERTAIN = /(?:可能|或许|大概|估计|不确定|待核|暂计|暂定)/u;
const APPROXIMATE = new RegExp(`(?:大约|约(?!定|束)|将近|接近|超过|不足|至少|至多|不超过|不少于|不低于|不高于|不得少于|不得低于|不得超过|不得高于|上限|下限|最高|最低)|(?<!最)近\\s*(?:工资|人民币|[¥￥${NUMERALS}])|[${NUMERALS}]\\s*(?:多|余)(?:万|亿)?[元圆]|[元圆]\\s*(?:左右|上下|以上|以下|多|余|起)`, 'u');
const RANGE_SPACE = String.raw`[^\S\r\n\u2028\u2029]*`;
const RANGE_CURRENCY = '(?:人民币|人民幣|(?<![A-Z])(?:CNY|RMB)(?![A-Z])|¥)';
const RANGE_CURRENCIES = `(?:${RANGE_CURRENCY}${RANGE_SPACE})*`;
const RANGE_NUMBER = `[${NUMERALS},.，]+`;
const RANGE_UNIT = `(?:元(?!旦|宵|年|月|素|件|音)|[圆圓](?!满|滿|形|圈|周))(?:${RANGE_SPACE}[${NUMERALS}]+[角分]){0,2}(?:整|正)?`;
// One link grammar serves complete ranges and either cropped endpoint. It
// consumes a unit cropped off the first endpoint and repeated RMB markers on
// either side of the connector, without crossing a source line boundary.
const RANGE_LINK = `${RANGE_SPACE}(?:${RANGE_UNIT}${RANGE_SPACE})?${RANGE_CURRENCIES}(?:至|到|[~～—–-])${RANGE_SPACE}${RANGE_CURRENCIES}`;
const RANGE = new RegExp(`${RANGE_NUMBER}${RANGE_LINK}${RANGE_NUMBER}${RANGE_SPACE}(?:${RANGE_UNIT}|${RANGE_CURRENCY})`, 'iu');
const RANGE_BEFORE = new RegExp(`${RANGE_NUMBER}${RANGE_LINK}$`, 'iu');
// A connector followed by a date/count is not another monetary endpoint.
const RANGE_ENDPOINT = `(?:${RANGE_NUMBER}${RANGE_SPACE}(?:${RANGE_UNIT}|${RANGE_CURRENCY})|${RANGE_NUMBER}[万亿](?=$|[\\s，,。；;！!？?]))`;
const RANGE_AFTER = new RegExp(`^${RANGE_LINK}${RANGE_ENDPOINT}`, 'iu');
const RANGE_NUMERIC_AFTER = new RegExp(`^${RANGE_LINK}[${NUMERALS}]`, 'iu');
const RANGE_TIME_AFTER = new RegExp(`^${RANGE_LINK}(?:[0-9]{4}[-/.][0-9]{1,2}(?:[-/.][0-9]{1,2})?(?![0-9])|[${NUMERALS}]+${RANGE_SPACE}(?:年|个?月|日|天|小时|分钟|秒))`, 'iu');
const TOKEN = new RegExp(`(?:人民[币幣]\\s*)?[¥￥]?\\s*(?:(?:\\d[\\d,，]*(?:\\.\\d+)?)\\s*(?:万|亿)?|[${LOWER}壹贰叁肆伍陆柒捌玖拾佰仟]+)\\s*[元圆圓](?:[0-9${SINGLE_DIGIT}]角)?(?:零?[0-9${SINGLE_DIGIT}]分)?(?:整|正)?`, 'gu');
const PREFIX_CURRENCY_PART = String.raw`(?:[^\S\r\n\u2028\u2029]|人民币|人民幣|[¥￥:：=()（）])`;
const SIGNED_PREFIX = new RegExp(`(?:负数|負數|负值|負值|正数|正數|正值|[负負+＋\\-－−﹣±])(?:${PREFIX_CURRENCY_PART}|的|为|為|是|金额|金額|数值|數值|工资|薪资|薪酬|计|計|共|合计|合計)*$`, 'u');
const INDEFINITE_PREFIX = new RegExp(`(?:数|數|几|幾)${PREFIX_CURRENCY_PART}*$`, 'u');
const APPROXIMATE_PREFIX = new RegExp(`(?:大约|约(?!定|束)|将近|接近|(?<!最)近|逾|不到|不止|超过|不足|至少|至多|不超过|不少于|不低于|不高于|不得少于|不得低于|不得超过|不得高于|上限|下限|最高|最低)(?:${PREFIX_CURRENCY_PART}|为|应付|工资|薪酬|薪资|金额|款项|计|共|合计|税前|税后)*$`, 'u');
const APPROXIMATE_SUFFIX = /^[^\S\r\n\u2028\u2029]*(?:[/／]\s*(?:小时|月|日|天|时|件)\s*)?(?:左右|上下|以上|以下|多|余|起|出头|有余|许)/u;

function result(rawValue: string, status: CandidateNormalization['status'], reason: string, match?: { text: string; index: number; amount: string }): CandidateNormalization {
  return { rawValue, status, amount: match?.amount ?? null, matchedText: match?.text ?? null,
    span: match ? { start: Array.from(rawValue.slice(0, match.index)).length, end: Array.from(rawValue.slice(0, match.index + match.text.length)).length } : null, reason };
}

// Both full literals and clipped source values must consume a modifier before
// the numeric token. It cannot silently turn 数十万 or 负数四万 into its tail.
function monetaryDetectionView(value: string): string {
  // Fold only detection copies; keep line boundaries and every raw offset.
  return value.normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/約/gu, '约').replace(/餘/gu, '余');
}

function attachedQualifierStatus(before: string, after: string): 'unsupported' | 'approximate' | null {
  const prefixView = monetaryDetectionView(before), suffixView = monetaryDetectionView(after);
  if (SIGNED_PREFIX.test(prefixView)) return 'unsupported';
  return INDEFINITE_PREFIX.test(prefixView) || APPROXIMATE_PREFIX.test(prefixView) || APPROXIMATE_SUFFIX.test(suffixView) ? 'approximate' : null;
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

function parseLowerAmount(text: string): string | null {
  if (/[元圆]零[零〇]分|角零[零〇一二三四五六七八九两]分/u.test(text)) return null;
  const match = text.match(new RegExp(`^(?:人民币\\s*)?[¥￥]?\\s*([${LOWER}]+)\\s*[元圆](?:(整|正)|(?:([${LOWER_DIGITS}〇两])角)?(?:零?([${LOWER_DIGITS}〇两])分)?(整|正)?)$`, 'u'));
  if (!match) return null;
  const yuan = lowerInteger(match[1]);
  if (yuan === null) return null;
  const digit = (character: string | undefined) => character ? character === '〇' ? 0 : character === '两' ? 2 : LOWER_DIGITS.indexOf(character) : 0;
  return parseAmount(`${yuan}.${digit(match[3])}${digit(match[4])}`)?.amount ?? null;
}

/** Whole Arabic yuan plus single-digit subunits; never add to a decimal/scaled
 * yuan token or infer omitted units. Keep cents exact through the range check.
 */
function parseArabicSubunits(text: string): string | null {
  const match = text.match(new RegExp(`^(?:人民币\\s*)?[¥￥]?\\s*((?:\\d{1,3}(?:[,，]\\d{3})+|\\d+))\\s*[元圆](?:([0-9${SINGLE_DIGIT}])角)?(?:(零?)([0-9${SINGLE_DIGIT}])分)?(?:整|正)?$`, 'u'));
  if (!match || (match[2] === undefined && match[4] === undefined)) return null;
  const digit = (character: string | undefined): bigint => {
    if (character === undefined || character === '〇') return 0n;
    if (character === '两') return 2n;
    const lower = LOWER_DIGITS.indexOf(character), upper = '零壹贰叁肆伍陆柒捌玖'.indexOf(character);
    return lower >= 0 ? BigInt(lower) : upper >= 0 ? BigInt(upper) : BigInt(character);
  };
  // A zero may bridge an omitted jiao, not introduce a second fen digit or
  // follow an explicit jiao. Redundant 零零/零〇分 remain unsupported.
  if (match[3] && (match[2] !== undefined || digit(match[4]) === 0n)) return null;
  const cents = BigInt(match[1].replace(/[,，]/gu, '')) * 100n + digit(match[2]) * 10n + digit(match[4]);
  return parseAmount(`${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`)?.amount ?? null;
}

function remainingNumbers(rawValue: string, index: number, text: string): string {
  // Work only on a separate validation view. Returned spans always address the original string.
  const rest = (rawValue.slice(0, index) + '\u0000' + rawValue.slice(index + text.length)).normalize('NFKC');
  const count = `[${NUMERALS}]+`;
  return rest.replace(/\d{4}[-/.]\d{1,2}(?:[-/.]\d{1,2})?/gu, '')
    .replace(new RegExp(`${count}\\s*年(?:\\s*${count}\\s*月(?:\\s*${count}\\s*日)?)?`, 'gu'), '')
    .replace(new RegExp(`${count}(?:\\.\\d+)?\\s*(?:个?月|天|日|小时|分钟|件|(?:个|名|位)(?:工人|员工|劳动者)|名|人|倍|年)`, 'gu'), '');
}

/** Parse one complete RMB literal with exact cents, preserving the unmodified evidence. */
export function normalizeMoneyValueV4(rawValue: string): CandidateNormalization {
  if (rawValue.length > MAX_INPUT) return result(rawValue, 'unsupported', '金额原文超过4000字符上限，未尝试解析或截断。');
  if (monetaryExpressionHasUnsupportedCurrency(rawValue) || /±/u.test(rawValue)) return result(rawValue, 'unsupported', '仅支持明确人民币金额，外币、币种冲突和正负范围符号未转换。');
  if (/[％%]|百分之/u.test(rawValue)) return result(rawValue, 'percentage', '比例不能作为精确金额。');
  const isRange = RANGE.test(monetaryDetectionView(rawValue)) || hasConjunctionMoneyRange(rawValue);
  const matches = [...rawValue.matchAll(new RegExp(TOKEN.source, 'gu'))];
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
    if (moneyTokenHasNonCurrencySubunit(text, after)) return result(rawValue, 'unsupported', '匹配到的角或分属于时间、计量或普通词语，未作为分币金额。');
    const qualifierStatus = attachedQualifierStatus(before, after);
    if (qualifierStatus) return result(rawValue, qualifierStatus, '完整金额带有数量不定、概数界限或正负限定，未截取其中的精确正数。');
    if (!isRmbCurrencyUnitAt(rawValue, index + text.search(/[元圆圓]/u))) return result(rawValue, 'unsupported', '匹配到的元或圆属于普通词语，不能截成金额单位。');
    if (new RegExp(`[${NUMERALS}０-９,.，负負+＋\\-－−﹣¥￥]$`, 'u').test(before)
      || new RegExp(`^[${NUMERALS}０-９,.，元圆圓角分整正]`, 'u').test(after)) return result(rawValue, 'unsupported', '完整金额的数字、单位或符号边界不合法，未截取其中有效片段。');
    const rest = remainingNumbers(rawValue, index, text)
      .replace(/(?:一共|一次性|一并|同一|唯一|统一|另一笔|一笔)/gu, '')
      .replace(new RegExp(`第[${NUMERALS}]+(?:笔|次|项|条|人)`, 'gu'), '');
    if (new RegExp(`[${NUMERALS}０-９]`, 'u').test(rest)) return result(rawValue, 'multiple_amounts', '原文仍有无法解释为日期、计数或倍数的数字，可能存在省略币种的另一笔金额或复杂中文数表达。');
    // Currency spelling aliases exist only in this parse copy after the raw
    // token is anchored. Returned evidence and code-point spans use text/rawValue.
    const parseText = text.replace(/^人民幣/u, '人民币').replace(/圓/gu, '圆');
    const onlyLower = new RegExp(`^(?:人民币\\s*)?[¥￥]?\\s*[${LOWER}]+\\s*[元圆][${LOWER}角分整正]*$`, 'u').test(parseText);
    const parsed = onlyLower ? parseLowerAmount(parseText) : parseArabicSubunits(parseText) ?? normalizeMoneyValue(parseText).amount;
    return parsed ? result(rawValue, 'exact', '唯一完整人民币金额已精确解析；原文和位置保持不变。', { text, index, amount: parsed })
      : result(rawValue, 'unsupported', '金额语法、精度或数值范围不受支持，未猜测省略位数。');
  }
  // Retain the frozen implementation's bare-Arabic-number compatibility only for a whole value.
  return normalizeMoneyValue(rawValue);
}

/** Adds source-bound qualifier checks without modifying source text or frozen representations. */
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
      const suffixRate = after.match(/^\s*(?:[元圆圓]\s*)?(?:[/／]\s*|每\s*)(小时|月|日|天|时|件)/u);
      const rateUnits: Record<string, RawCandidateV3['rateUnit']> = { 小时: 'hour', 月: 'month', 日: 'day', 天: 'day', 时: 'hour', 件: 'piece' };
      const qualifierStatus = attachedQualifierStatus(before, after);
      if (sourceMoneyHasNonCurrencySubunit({ blockText: candidate.quote, valueStart: quoteOffset }, normalized)) normalized = result(candidate.value, 'unsupported', '原文中的角或分属于普通词语，裁剪后的片段未作为分币金额。');
      else if (sourceMoneyHasUnsupportedCurrency(sourceAnchor, normalized)) normalized = result(candidate.value, 'unsupported', '原文金额直接附着外币或冲突币种，未换算。');
      else if (suffixRate && (candidate.meaning !== 'rate' || (candidate.rateUnit !== 'unknown' && candidate.rateUnit !== rateUnits[suffixRate[1]]))) normalized = result(candidate.value, 'rate_unit_mismatch', '原文紧贴的费率单位与金额角色或候选费率单位冲突。');
      else if (RANGE_BEFORE.test(monetaryDetectionView(before)) || RANGE_AFTER.test(monetaryDetectionView(after))
        || isConjunctionMoneyRangeEndpoint(arithmeticBefore, candidate.value, arithmeticAfter)) normalized = result(candidate.value, 'range', '当前金额在原文中直接属于区间端点。');
      else if (RANGE_NUMERIC_AFTER.test(monetaryDetectionView(after)) && !RANGE_TIME_AFTER.test(monetaryDetectionView(after))) normalized = result(candidate.value, 'uncertain', '连接词后的数字未形成完整金额或明确时间，不能确认被截取的数值可用。');
      else if (hasAttachedMoneyArithmetic(arithmeticBefore, arithmeticAfter)) normalized = result(candidate.value, 'unsupported', '当前金额在原文中直接参与倍数或算式，未把裁剪后的金额操作数当作计算结果。');
      else if (qualifierStatus) normalized = result(candidate.value, qualifierStatus, '当前金额在原文中直接附着数量不定、概数界限或正负限定，未截取为精确正数。');
      else if (/(?:可能|或许|大概|估计|待核|暂计|暂定)(?:为|工资|金额|人民币|\s)*$/u.test(before) || /(?:或|或者)\s*$/u.test(before)
        || new RegExp(`^\\s*(?:或|或者)\\s*[${NUMERALS}]`, 'u').test(after)) normalized = result(candidate.value, 'uncertain', '当前金额在原文中有直接附着的不确定或备选表述。');
      else if (bareValue && !attachedCurrency) normalized = result(candidate.value, 'unsupported', 'value 和当前原文锚点均无明确人民币单位，未猜测这是金额。');
      else if (new RegExp(`[${NUMERALS},.，]$`, 'u').test(beforeBoundary)
        || new RegExp(`[${NUMERALS}][元圆圓]?\\s*(?:点|又|分之|加上|另加|加|减|乘|除)\\s*$`, 'u').test(beforeBoundary)
        || /^[,.，]\d/u.test(afterBoundary)
        || (!attachedYuan && new RegExp(`^[${NUMERALS}元圆圓角分整正]`, 'u').test(afterBoundary))) normalized = result(candidate.value, 'unsupported', 'value 截去了直接相邻的金额数字或角分，未升级为精确金额。');
      else if (legacy.normalization.status !== 'unsupported' && legacy.normalization.status !== 'multiple_amounts'
        && !(legacy.normalization.status === 'range' && RANGE_TIME_AFTER.test(monetaryDetectionView(after)))) normalized = legacy.normalization;
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
  const wageStage = `(?:${date}(?:\\s*(?:至|到|[~～—–-])\\s*${date})?|[${NUMERALS}]+月份?|元月份?|元旦|${relativeMonth}|月|${dayStage}|离职前|入职前|入职后|试用期)`;
  const wageDescription = new RegExp(`^(?:${wageStage}\\s*)?(?:的)?(?:基本|其他|其余|全部|正常|岗位|绩效|应付|已付|实付|税前|税后)?(?:工资|薪资|薪酬|劳务费|劳动报酬)(?:合计|总额|标准)?$`, 'u');
  if (wageDescription.test(value.trim()) && !MASKED.test(value)) return { kind: 'not_monetary', normalization: result(value, 'not_money', '原文为工资名称或期间描述，未表述金额。') };
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
  const text = value.trim().replace(/\s*(?:工资|劳务费|劳动报酬)\s*$/u, '').trim().replace(/^人民币\s*/u, '');
  const prefix = text.match(/^(不得少于|不得低于|不得超过|不得高于|不超过|不少于|不低于|不高于|大约|将近|接近|超过|不足|至少|至多|上限|下限|最高|最低|可能|或许|大概|估计|不确定|待核|暂计|暂定|约|近)\s*/u);
  const suffix = text.match(/\s*(左右|上下|以上|以下|多|余|起)$/u);
  const start = prefix?.[0].length ?? 0, end = suffix ? text.length - suffix[0].length : text.length;
  if (end <= start) return null;
  const literal = text.slice(start, end).trim();
  const inner = literal.match(new RegExp(`^(?:人民币\\s*)?([${NUMERALS},.，]+)(多|余)([元圆])$`, 'u'));
  if (inner) {
    // This synthetic literal exists only to derive a comparison key; no source span,
    // normalized candidate, or calculation amount is created from repaired evidence.
    const base = normalizeMoneyValueV4(`${inner[1]}${inner[3]}`);
    return base.status === 'exact' ? `${normalization.status}:${prefix?.[1] ?? ''}:${base.amount}:${suffix?.[1] ?? ''}:inner=${inner[2]}` : null;
  }
  if (!prefix && !suffix) return null;
  const exact = normalizeMoneyValueV4(literal);
  // Whole-literal anchoring prevents removing a wage noun from a complex narrative.
  if (exact.status !== 'exact' || exact.matchedText !== literal) return null;
  return `${normalization.status}:${prefix?.[1] ?? ''}:${exact.amount}:${suffix?.[1] ?? ''}`;
}
