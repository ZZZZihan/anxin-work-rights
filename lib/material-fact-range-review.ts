// Only detection copies are folded. The source and its code-point positions
// remain untouched, including when layout divides an explicit range.
export const MONEY_BOUND_PREFIX = '(?:不得少于|不得低于|不得超过|不得高于|不超过|不少于|不低于|不高于|不多于|不大于|不小于|不满|未满|低于|高于|多达|少于|多于|大于|小于|未达|大约|约(?!定|束)|将近|接近|逾|不到|不止|超过|不足|至少|至多|上限|下限|最高|最低)';
export const MONEY_BOUND_SUFFIX = '(?:左右|上下|以上|以下|以内|以外|封顶|出头|有余|多|余|起|许)';

/** Fold a detection copy only; never use this text for source positions. */
export function moneyQualifierDetectionView(text: string): string {
  return text.normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/[約餘滿於達內頂頭許萬]/gu,
    character => ({ 約: '约', 餘: '余', 滿: '满', 於: '于', 達: '达', 內: '内', 頂: '顶', 頭: '头', 許: '许', 萬: '万' })[character]!);
}
const view = (text: string) => moneyQualifierDetectionView(text).replace(/\s+/gu, ' ');
const SPACE = String.raw`\s*`;
const NUMBER = '[0-9零〇一二三四五六七八九十百千万亿两壹贰叁肆伍陆柒捌玖拾佰仟,.，]{1,80}';
const CURRENCY = '(?:人民币|人民幣|(?<![A-Z])(?:CNY|RMB)(?![A-Z])|¥)';
const UNIT = `(?:(?:元(?!旦|宵|年|月|素|件|音)|[圆圓](?!满|形|圈|周))(?:${SPACE}${NUMBER}[角分]){0,2}(?:整|正)?)`;
const PREFIX = `(?:(?:${CURRENCY}|${MONEY_BOUND_PREFIX}|(?<!最)近)${SPACE}){0,3}`;
const SUFFIX = `(?:${SPACE}${MONEY_BOUND_SUFFIX})?`;
const VALUE = `${NUMBER}${SPACE}(?:(?:多|余)${SPACE})?`;
const AMOUNT = `${PREFIX}${VALUE}(?:${UNIT})?(?:${SPACE}${CURRENCY}){0,2}${SUFFIX}`;
// The second endpoint needs its own unit or the existing context-bound 万/亿
// shorthand. A year, duration, person or arbitrary prose is never an endpoint.
const ENDPOINT_END = `(?=$|[\\s，,。；;！!？?]|${MONEY_BOUND_SUFFIX})`;
const EXPLICIT_PREFIX = `(?:${MONEY_BOUND_PREFIX}${SPACE}){0,2}${CURRENCY}${SPACE}${PREFIX}`;
const MONEY_ENDPOINT = `(?:${PREFIX}(?:${VALUE}(?:${UNIT}|${CURRENCY})(?:${SPACE}${CURRENCY}){0,2}|${NUMBER}[万亿]${ENDPOINT_END})|${EXPLICIT_PREFIX}${VALUE}${ENDPOINT_END})${SUFFIX}`;
const LINK = '(?:至|到|[~～—–-])';
const CONNECTED_RANGE = new RegExp(`${AMOUNT}${SPACE}${LINK}${SPACE}${MONEY_ENDPOINT}`, 'giu');
const PAIR = `${AMOUNT}${SPACE}(?:和|与|與|及)${SPACE}${AMOUNT}`;
// A conjunction alone also describes independent payments. Require either the
// closed “between” phrase or the explicit “lies between” prefix. No prose,
// subject name or sentence punctuation can bridge the two endpoints.
const END = '(?:之间|之間|之内|之內|以内|以內)';
const RANGE = new RegExp(`(?:介于|介於)${SPACE}${PAIR}(?:${SPACE}${END})?|${PAIR}${SPACE}${END}`, 'giu');

// Explicit qualifiers may continue over layout whitespace, but no sentence
// punctuation, person or unlisted narrative can bridge a qualifier to money.
const CURRENCY_BRIDGE_PART = `(?:\\s|${CURRENCY}|[:：=()（）])`;
const CURRENCY_BRIDGE = `${CURRENCY_BRIDGE_PART}*`;
const QUALIFIER_BRIDGE = `(?:\\s|${CURRENCY}|[:：=()（）]|为|為|应付|應付|工资|工資|薪酬|薪资|薪資|金额|金額|款项|款項|计|計|共|合计|合計|税前|稅前|税后|稅後)*`;
const ATTACHED_PREFIX = new RegExp(`(?:${MONEY_BOUND_PREFIX}|(?<!最)近)${QUALIFIER_BRIDGE}$`, 'iu');
const SIGNED_BRIDGE = `(?:${CURRENCY_BRIDGE_PART}|的|为|為|是|金额|金額|数值|數值|工资|工資|薪资|薪資|薪酬|计|計|共|合计|合計)*`;
const ATTACHED_SIGNED = new RegExp(`(?:负数|負數|负值|負值|正数|正數|正值|[负負+＋\\-－−﹣±])${SIGNED_BRIDGE}$`, 'iu');
const ATTACHED_INDEFINITE = new RegExp(`(?:数|數|几|幾)${CURRENCY_BRIDGE}$`, 'iu');
const ATTACHED_SUFFIX = new RegExp(`^${SPACE}(?:(?:${UNIT}|${CURRENCY})${SPACE}){0,2}(?:[/／]${SPACE}(?:小时|月|日|天|时|件)${SPACE})?${MONEY_BOUND_SUFFIX}`, 'iu');

/** A clipped value and source review share the same finite qualifier grammar.
 * Explicit modifiers may bridge layout; subjects, numbers and sentences may not.
 * A signed amount remains unsupported, distinct from an approximate bound. */
export function attachedMoneyQualifierStatus(before: string, after: string): 'unsupported' | 'approximate' | null {
  const prefix = view(before), suffix = view(after);
  if (ATTACHED_SIGNED.test(prefix)) return 'unsupported';
  return ATTACHED_INDEFINITE.test(prefix) || ATTACHED_PREFIX.test(prefix) || ATTACHED_SUFFIX.test(suffix) ? 'approximate' : null;
}

export function hasAttachedMoneyQualifier(before: string, after: string): boolean {
  return attachedMoneyQualifierStatus(before, after) !== null;
}

export function hasConjunctionMoneyRange(text: string): boolean {
  return new RegExp(RANGE.source, RANGE.flags).test(view(text));
}

export function hasMoneyRange(text: string): boolean {
  const detection = view(text);
  return new RegExp(CONNECTED_RANGE.source, CONNECTED_RANGE.flags).test(detection) || hasConjunctionMoneyRange(detection);
}

export function isConjunctionMoneyRangeEndpoint(before: string, value: string, after: string): boolean {
  return isEndpoint(before, value, after, [RANGE]);
}

/** Both complete values and clipped source anchors use the same endpoint
 * grammar, including finite qualifiers and explicit layout continuations. */
export function isMoneyRangeEndpoint(before: string, value: string, after: string): boolean {
  return isEndpoint(before, value, after, [CONNECTED_RANGE, RANGE]);
}

function isEndpoint(before: string, value: string, after: string, expressions: RegExp[]): boolean {
  const prefix = view(before), token = view(value), suffix = view(after);
  const start = prefix.length, end = start + token.length;
  if (!token) return false;
  for (const expression of expressions) {
    for (const match of (prefix + token + suffix).matchAll(new RegExp(expression.source, expression.flags))) {
      if (match.index <= start && end <= match.index + match[0].length) return true;
    }
  }
  return false;
}
