import type { CandidateNormalization, NormalizedCandidateValue, RawCandidateV3 } from './material-fact-types-v3.ts';
import { getCandidateLocalEvent, normalizeCandidateValue, normalizeMoneyValue } from './material-facts-v3.ts';
import { parseAmount } from './material-facts.ts';
import { sourceMoneyHasExplicitRmbCurrency, sourceMoneyHasUnsupportedCurrency } from './material-fact-currency-review.ts';

export type MonetaryExpressionClassification = {
  kind: 'monetary' | 'not_monetary' | 'undetermined';
  normalization: CandidateNormalization;
};

const MAX_INPUT = 4000;
const LOWER_DIGITS = '零一二三四五六七八九';
const NUMERALS = '0-9零〇一二三四五六七八九十百千万亿两壹贰叁肆伍陆柒捌玖拾佰仟';
const LOWER = '零〇一二三四五六七八九十百千万亿两';
const SINGLE_DIGIT = '零〇一二三四五六七八九两壹贰叁肆伍陆柒捌玖';
const FOREIGN = /美元|美金|港币|港元|澳元|欧元|日元|英镑|韩元|新加坡元|(?:USD|HKD|AUD|EUR|JPY|GBP|KRW|SGD)|[$€£₩±]/iu;
const MASKED = /[xX×＊*]|未知|不详|不明|待定|无法确定|未提供|未明确|未载明|未记载|未披露|未列明|未注明|未约定|未确定|待确认|待核实|待补充|[?？□＿_]|\.{2,}|…/u;
const UNCERTAIN = /(?:可能|或许|大概|估计|不确定|待核|暂计|暂定)/u;
const APPROXIMATE = new RegExp(`(?:大约|约(?!定|束)|将近|接近|超过|不足|至少|至多|不超过|不少于|不低于|不高于|不得少于|不得低于|不得超过|不得高于|上限|下限|最高|最低)|近\\s*(?:工资|人民币|[¥￥${NUMERALS}])|[${NUMERALS}]\\s*(?:多|余)(?:万|亿)?[元圆]|[元圆]\\s*(?:左右|上下|以上|以下|多|余|起)`, 'u');
const RANGE = new RegExp(`[${NUMERALS},.，]+\\s*[元圆]?\\s*(?:至|到|[~～—–-])\\s*[${NUMERALS},.，]+\\s*[元圆]`, 'u');
const TOKEN = new RegExp(`(?:人民币\\s*)?[¥￥]?\\s*(?:(?:\\d[\\d,，]*(?:\\.\\d+)?)\\s*(?:万|亿)?|[${LOWER}壹贰叁肆伍陆柒捌玖拾佰仟]+)\\s*[元圆](?:[${SINGLE_DIGIT}]角)?(?:零?[${SINGLE_DIGIT}]分)?(?:整|正)?`, 'gu');

function result(rawValue: string, status: CandidateNormalization['status'], reason: string, match?: { text: string; index: number; amount: string }): CandidateNormalization {
  return { rawValue, status, amount: match?.amount ?? null, matchedText: match?.text ?? null,
    span: match ? { start: Array.from(rawValue.slice(0, match.index)).length, end: Array.from(rawValue.slice(0, match.index + match.text.length)).length } : null, reason };
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

function remainingNumbers(rawValue: string, index: number, text: string): string {
  // Work only on a separate validation view. Returned spans always address the original string.
  const rest = rawValue.slice(0, index) + '\u0000' + rawValue.slice(index + text.length);
  const count = `[${NUMERALS}]+`;
  return rest.replace(/\d{4}[-/.]\d{1,2}(?:[-/.]\d{1,2})?/gu, '')
    .replace(new RegExp(`${count}\\s*年(?:\\s*${count}\\s*月(?:\\s*${count}\\s*日)?)?`, 'gu'), '')
    .replace(new RegExp(`${count}(?:\\.\\d+)?\\s*(?:个?月|天|日|小时|分钟|件|名|人|倍|年)`, 'gu'), '');
}

/** Parse one complete RMB literal with exact cents, preserving the unmodified evidence. */
export function normalizeMoneyValueV4(rawValue: string): CandidateNormalization {
  if (rawValue.length > MAX_INPUT) return result(rawValue, 'unsupported', '金额原文超过4000字符上限，未尝试解析或截断。');
  if (FOREIGN.test(rawValue)) return result(rawValue, 'unsupported', '仅支持明确人民币金额，外币、币种冲突和正负范围符号未转换。');
  if (/[％%]|百分之/u.test(rawValue)) return result(rawValue, 'percentage', '比例不能作为精确金额。');
  if (MASKED.test(rawValue)) return result(rawValue, 'masked', '金额未知、未明确或被遮盖；保留原文且不转换为零。');
  if (UNCERTAIN.test(rawValue)) return result(rawValue, 'uncertain', '金额有不确定或待核表述。');
  if (RANGE.test(rawValue)) return result(rawValue, 'range', '金额属于区间，未选取单个端点。');
  if (APPROXIMATE.test(rawValue)) return result(rawValue, 'approximate', '金额是概数或界限，未转成精确金额。');

  const matches = [...rawValue.matchAll(new RegExp(TOKEN.source, 'gu'))];
  if (matches.length > 1) return result(rawValue, 'multiple_amounts', '原文含多笔金额，无法唯一选取。');
  if (matches.length === 1) {
    const match = matches[0], text = match[0].trimStart(), index = match.index + match[0].length - text.length;
    const before = rawValue.slice(0, index).trimEnd(), after = rawValue.slice(index + text.length);
    if (new RegExp(`[${NUMERALS},.，负負+＋\\-－−﹣¥￥]$`, 'u').test(before)
      || new RegExp(`^[${NUMERALS},.，元圆角分整正]`, 'u').test(after)) return result(rawValue, 'unsupported', '完整金额的数字、单位或符号边界不合法，未截取其中有效片段。');
    const rest = remainingNumbers(rawValue, index, text)
      .replace(/(?:一共|一次性|一并|同一|唯一|统一|另一笔|一笔)/gu, '')
      .replace(new RegExp(`第[${NUMERALS}]+(?:笔|次|项|条|人)`, 'gu'), '');
    if (new RegExp(`[${NUMERALS}]`, 'u').test(rest)) return result(rawValue, 'multiple_amounts', '原文仍有无法解释为日期、计数或倍数的数字，可能存在省略币种的另一笔金额或复杂中文数表达。');
    const onlyLower = new RegExp(`^(?:人民币\\s*)?[¥￥]?\\s*[${LOWER}]+\\s*[元圆][${LOWER}角分整正]*$`, 'u').test(text);
    const parsed = onlyLower ? parseLowerAmount(text) : normalizeMoneyValue(text).amount;
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
      const beforeBoundary = before.trimEnd(), afterBoundary = after.trimStart();
      const bareValue = !/人民币|[元圆¥￥]/u.test(candidate.value);
      const attachedYuan = new RegExp(`^\\s*[元圆](?:整|正)?(?=$|[^${NUMERALS}元圆角分整正])`, 'u').test(after);
      const sourceAnchor = { blockText: local.text, valueStart: offset };
      const attachedCurrency = sourceMoneyHasExplicitRmbCurrency(sourceAnchor, normalized);
      const suffixRate = after.match(/^\s*[/／]\s*(小时|月|日|天|时|件)/u);
      const rateUnits: Record<string, RawCandidateV3['rateUnit']> = { 小时: 'hour', 月: 'month', 日: 'day', 天: 'day', 时: 'hour', 件: 'piece' };
      const rangeBefore = new RegExp(`[${NUMERALS},.，]+\\s*[元圆]?\\s*(?:至|到|[~～—–-])\\s*$`, 'u');
      if (sourceMoneyHasUnsupportedCurrency(sourceAnchor, normalized)) normalized = result(candidate.value, 'unsupported', '原文金额直接附着外币或冲突币种，未换算。');
      else if (suffixRate && (candidate.meaning !== 'rate' || (candidate.rateUnit !== 'unknown' && candidate.rateUnit !== rateUnits[suffixRate[1]]))) normalized = result(candidate.value, 'rate_unit_mismatch', '原文紧贴的费率单位与金额角色或候选费率单位冲突。');
      else if (rangeBefore.test(before) || new RegExp(`^\\s*(?:至|到|[~～—–-])\\s*[${NUMERALS}]`, 'u').test(after)) normalized = result(candidate.value, 'range', '当前金额在原文中直接属于区间端点。');
      else if (/(?:大约|约(?!定|束)|将近|接近|(?<!最)近|超过|不足|至少|至多|不超过|不少于|不低于|不高于|不得少于|不得低于|不得超过|不得高于|上限|下限|最高|最低)(?:为|应付|工资|薪酬|薪资|金额|款项|人民币|计|共|合计|税前|税后|\s)*$/u.test(before)
        || /^\s*(?:[/／]\s*(?:小时|月|日|天|时|件)\s*)?(?:左右|上下|以上|以下|多|余|起)/u.test(after)) normalized = result(candidate.value, 'approximate', '当前金额在原文中直接附着概数或界限修饰词。');
      else if (/(?:可能|或许|大概|估计|待核|暂计|暂定)(?:为|工资|金额|人民币|\s)*$/u.test(before) || /(?:或|或者)\s*$/u.test(before)
        || new RegExp(`^\\s*(?:或|或者)\\s*[${NUMERALS}]`, 'u').test(after)) normalized = result(candidate.value, 'uncertain', '当前金额在原文中有直接附着的不确定或备选表述。');
      else if (/(?:负数|負數|负值|負值|[负負+＋\-－−﹣±])\s*$/u.test(before)
        || /(?:美元|美金|港币|港元|澳元|欧元|日元|英镑|韩元|新加坡元|USD|HKD|AUD|EUR|JPY|GBP|KRW|SGD|[$€£₩])\s*$/iu.test(before)
        || /^\s*(?:美元|美金|港币|港元|澳元|欧元|日元|英镑|韩元|新加坡元|USD|HKD|AUD|EUR|JPY|GBP|KRW|SGD|[$€£₩])/iu.test(after)) normalized = result(candidate.value, 'unsupported', '原文金额直接附着正负或外币标记。');
      else if (bareValue && !attachedCurrency) normalized = result(candidate.value, 'unsupported', 'value 和当前原文锚点均无明确人民币单位，未猜测这是金额。');
      else if (new RegExp(`[${NUMERALS},.，]$`, 'u').test(beforeBoundary)
        || new RegExp(`[${NUMERALS}][元圆]?\\s*(?:点|又|分之|加上|另加|加|减|乘|除)\\s*$`, 'u').test(beforeBoundary)
        || /^[,.，]\d/u.test(afterBoundary)
        || (!attachedYuan && new RegExp(`^[${NUMERALS}元圆角分整正]`, 'u').test(afterBoundary))) normalized = result(candidate.value, 'unsupported', 'value 截去了直接相邻的金额数字或角分，未升级为精确金额。');
      else if (legacy.normalization.status !== 'unsupported' && legacy.normalization.status !== 'multiple_amounts') normalized = legacy.normalization;
    }
  }
  return { value: normalized.amount ?? candidate.value, amount: normalized.amount, rateUnit: candidate.rateUnit, normalization: normalized };
}

/** A three-way gate: only positively identified non-money is safe to reject.
 * Unknown or complex input is retained for review instead of requiring an ASCII digit.
 */
export function classifyMonetaryExpression(value: string): MonetaryExpressionClassification {
  const normalization = normalizeMoneyValueV4(value);
  const explicit = /人民币|[¥￥]|[元圆]|(?:USD|HKD|AUD|EUR|JPY|GBP|KRW|SGD)|[$€£₩]/iu.test(value)
    || new RegExp(`[${NUMERALS}]+[角分](?!钟)`, 'u').test(value);
  if (normalization.status === 'exact' || explicit) return { kind: 'monetary', normalization };
  if (MASKED.test(value) && /工资|薪资|薪酬|金额|款项|欠薪|报酬|劳务费|付款|应付|实付|已付|尚欠|欠款/u.test(value)) return { kind: 'monetary', normalization };
  const count = `[${NUMERALS}]+`;
  const date = `(?:[${NUMERALS}]+\\s*年(?:\\s*[${NUMERALS}]+\\s*月(?:\\s*[${NUMERALS}]+\\s*日)?)?|\\d{4}[-/.]\\d{1,2}(?:[-/.]\\d{1,2})?)`;
  const wageStage = `(?:${date}(?:\\s*(?:至|到|[~～—–-])\\s*${date})?|[${NUMERALS}]+月份?|某月|本月|上月|下月|每月|离职前|入职前|入职后|试用期)`;
  const wageDescription = new RegExp(`^(?:${wageStage}\\s*)?(?:的)?(?:基本|其他|其余|全部|正常|岗位|绩效|应付|已付|实付|税前|税后)?(?:工资|薪资|薪酬|劳务费|劳动报酬)(?:合计|总额)?$`, 'u');
  if (wageDescription.test(value.trim()) && !MASKED.test(value)) return { kind: 'not_monetary', normalization: result(value, 'not_money', '原文为工资名称或期间描述，未表述金额。') };
  const withoutDatesAndCounts = value.trim().replace(/\d{4}[-/.]\d{1,2}(?:[-/.]\d{1,2})?/gu, '')
    .replace(new RegExp(`${count}\\s*(?:年|个?月|天|日|小时|分钟|件|名(?:工人|员工|劳动者)?|个?人|位|个|倍|次)`, 'gu'), '')
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
