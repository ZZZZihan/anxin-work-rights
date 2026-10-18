// Detect only an operator or multiplier attached to the anchored amount.
// This is not an evaluator, and detection copies never replace source evidence.
const NUMERALS = '0-9零〇一二三四五六七八九十百千万亿两壹贰叁肆伍陆柒捌玖拾佰仟';
const NUMBER = `[${NUMERALS}]+(?:[.点][${NUMERALS}]+)?`;
const FACTOR = `[+−负負-]?${NUMBER}`;
// Currency, whole-amount and bracket wrappers may have been cropped off value.
// No wage nouns or visible sentence separators belong in this finite bridge.
const WRAPPER_ATOM = '(?:(?:人民币|人民幣|CNY|RMB)|[¥元圆圓角分整正()])';
const BRIDGE_ATOM = `(?:${WRAPPER_ATOM}|[${NUMERALS}]+[角分])`;
const LINE = '[\\r\\n\\u2028\\u2029]';
const CONTINUATION_BRIDGE = `(?:${BRIDGE_ATOM}|${LINE})*`;
const OPERATOR = `(?:乘${LINE}*以|除${LINE}*以|分${LINE}*之|加${LINE}*上|减${LINE}*去|另${LINE}*加|乘|除|加|减|[×*xX÷/+−-])`;
const PREFIX_OPERATOR = new RegExp(`(?:倍${CONTINUATION_BRIDGE}(?:的${CONTINUATION_BRIDGE})?|${OPERATOR}${CONTINUATION_BRIDGE})$`, 'u');
const PREFIX_FACTOR = new RegExp(`${FACTOR}${CONTINUATION_BRIDGE}$`, 'u');
const SUFFIX_MULTIPLIER = new RegExp(`^${FACTOR}${CONTINUATION_BRIDGE}倍`, 'u');
const SUFFIX_FRACTION = new RegExp(`^(?:${FACTOR}${CONTINUATION_BRIDGE}(?:分${LINE}*之|/)${CONTINUATION_BRIDGE}${FACTOR}|[+−负負-]?(?:一${LINE}*)?半|${FACTOR}${CONTINUATION_BRIDGE}%)`, 'u');
const SUFFIX_OPERATOR = new RegExp(`^${OPERATOR}${CONTINUATION_BRIDGE}${FACTOR}`, 'u');
const LEADING_BRIDGE = new RegExp(`^${CONTINUATION_BRIDGE}`, 'u');
// Once 的 is explicit, 二分之一 is a fraction, not a cropped 二分 currency tail.
const LEADING_FACTOR_WRAPPERS = new RegExp(`^(?:${WRAPPER_ATOM}|${LINE})*`, 'u');

function detectionView(value: string): string {
  return value.normalize('NFKC').replace(/\p{Cf}/gu, '')
    .replace(/[^\S\r\n\u2028\u2029]/gu, '');
}

/** Inspect raw text immediately before and after one already anchored money span.
 * Horizontal whitespace, compatibility glyphs and format controls are handled
 * only in the detection view. An explicit operator or 的…倍 can continue over
 * layout newlines; a bare number on the next line cannot attach to this amount.
 * Visible sentence separators and intervening prose always break attachment.
 * A true /月, /日, /小时 or /件 rate has no numeric operand and remains supported.
 */
export function hasAttachedMoneyArithmetic(before: string, after: string): boolean {
  const left = detectionView(before), right = detectionView(after);
  // Match the adjacent operator first; scanning a long number without an
  // operator must not repeatedly retry the complete numeric grammar.
  const operator = left.match(PREFIX_OPERATOR);
  if (operator && PREFIX_FACTOR.test(left.slice(0, operator.index))) return true;
  const bridge = right.match(LEADING_BRIDGE)![0];
  let suffix = right.slice(bridge.length);
  if (suffix.startsWith('的')) {
    suffix = suffix.slice(1).replace(LEADING_FACTOR_WRAPPERS, '');
    return SUFFIX_MULTIPLIER.test(suffix) || SUFFIX_FRACTION.test(suffix);
  }
  if (SUFFIX_OPERATOR.test(suffix)) return true;
  return !/[\r\n\u2028\u2029]/u.test(bridge) && SUFFIX_MULTIPLIER.test(suffix);
}
