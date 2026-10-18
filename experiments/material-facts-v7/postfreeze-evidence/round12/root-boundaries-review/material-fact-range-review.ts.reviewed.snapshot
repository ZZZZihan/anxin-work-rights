// Only detection copies are folded. The source and its code-point positions
// remain untouched, including when layout divides an explicit range.
const view = (text: string) => text.normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/\s+/gu, ' ');
const SPACE = String.raw`\s*`;
const NUMBER = '[0-9零〇一二三四五六七八九十百千万亿两壹贰叁肆伍陆柒捌玖拾佰仟,.，]{1,80}';
const CURRENCY = '(?:人民币|人民幣|(?<![A-Z])(?:CNY|RMB)(?![A-Z])|¥)';
const UNIT = `(?:[元圆圓](?:${SPACE}${NUMBER}[角分]){0,2}(?:整|正)?)`;
const AMOUNT = `(?:${CURRENCY}${SPACE}){0,2}${NUMBER}${SPACE}(?:${UNIT})?`;
const PAIR = `${AMOUNT}${SPACE}(?:和|与|與|及)${SPACE}${AMOUNT}`;
// A conjunction alone also describes independent payments. Require either the
// closed “between” phrase or the explicit “lies between” prefix. No prose,
// subject name or sentence punctuation can bridge the two endpoints.
const END = '(?:之间|之間|之内|之內|以内|以內)';
const RANGE = new RegExp(`(?:介于|介於)${SPACE}${PAIR}(?:${SPACE}${END})?|${PAIR}${SPACE}${END}`, 'giu');

export function hasConjunctionMoneyRange(text: string): boolean {
  return new RegExp(RANGE.source, RANGE.flags).test(view(text));
}

export function isConjunctionMoneyRangeEndpoint(before: string, value: string, after: string): boolean {
  const prefix = view(before), token = view(value), suffix = view(after);
  const start = prefix.length, end = start + token.length;
  if (!token) return false;
  for (const match of (prefix + token + suffix).matchAll(new RegExp(RANGE.source, RANGE.flags))) {
    if (match.index <= start && end <= match.index + match[0].length) return true;
  }
  return false;
}
