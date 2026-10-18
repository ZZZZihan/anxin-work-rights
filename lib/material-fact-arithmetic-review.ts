// Detect only an operator or multiplier attached to the anchored amount.
// This is not an evaluator, and detection copies never replace source evidence.
const NUMERALS = '0-9零〇一二三四五六七八九十百千万亿两壹贰叁肆伍陆柒捌玖拾佰仟';
const NUMBER = `[${NUMERALS}]+(?:[.点][${NUMERALS}]+)?`;
const FACTOR = `[+−负負-]?${NUMBER}`;
// Currency, whole-amount and bracket wrappers may have been cropped off value.
// Prose and wage nouns do not belong in this general wrapper bridge.
const WRAPPER_ATOM = '(?:(?:人民币|人民幣|CNY|RMB)|[¥元圆圓角分整正()])';
const BRIDGE_ATOM = `(?:${WRAPPER_ATOM}|[${NUMERALS}]+[角分])`;
const LINE = '[\\r\\n\\u2028\\u2029]';
const CONTINUATION_BRIDGE = `(?:${BRIDGE_ATOM}|${LINE})*`;
const OPERATOR = `(?:乘${LINE}*以|除${LINE}*以|分${LINE}*之|加${LINE}*上|减${LINE}*去|另${LINE}*加|乘|除|加|减|[×*xX÷/+−-])`;
// These are operands only beside an explicit operator. A coefficient named
// elsewhere in the sentence must not turn a stated amount into an expression.
const NAMED_OPERAND = ['出勤系数', '绩效系数', '工资系数', '计发系数', '折算系数', '考核系数', '岗位系数',
  '出勤比例', '支付比例', '计发比例', '折算比例', '出勤天数', '工作天数', '计薪天数', '工作月数', '计薪月数', '人数', '件数']
  .map(name => Array.from(name).join(`${LINE}*`)).join('|');
const OPERAND = `(?:${FACTOR}|${NAMED_OPERAND})`;
const PREFIX_OPERATOR = new RegExp(`(?:倍${CONTINUATION_BRIDGE}(?:的${CONTINUATION_BRIDGE})?|${OPERATOR}${CONTINUATION_BRIDGE})$`, 'u');
const PREFIX_FACTOR = new RegExp(`${FACTOR}${CONTINUATION_BRIDGE}$`, 'u');
const PREFIX_NAMED_OPERAND = new RegExp(`(?:${NAMED_OPERAND})${CONTINUATION_BRIDGE}$`, 'u');
const SUFFIX_MULTIPLIER = new RegExp(`^${FACTOR}${CONTINUATION_BRIDGE}倍`, 'u');
const SUFFIX_FRACTION = new RegExp(`^(?:${FACTOR}${CONTINUATION_BRIDGE}(?:分${LINE}*之|/)${CONTINUATION_BRIDGE}${FACTOR}|[+−负負-]?(?:一${LINE}*)?半|${FACTOR}${CONTINUATION_BRIDGE}%)`, 'u');
const SUFFIX_OPERATOR = new RegExp(`^${OPERATOR}${CONTINUATION_BRIDGE}${OPERAND}`, 'u');
const LEADING_BRIDGE = new RegExp(`^${CONTINUATION_BRIDGE}`, 'u');
// Once 的 is explicit, 二分之一 is a fraction, not a cropped 二分 currency tail.
const LEADING_FACTOR_WRAPPERS = new RegExp(`^(?:${WRAPPER_ATOM}|${LINE})*`, 'u');
// A directly named amount can still be the operand: 四万元基本工资的两倍.
// Keep nouns out of the general bridge: 两倍工资共四万元 states a result.
// A finite noun may precede explicit 的/an operator, or an immediate same-line
// factor+倍. Only the explicit paths can bridge OCR line breaks in that noun;
// punctuation and other prose cannot attach an arithmetic operand.
const AMOUNT_NOUN = ['工资', '基本工资', '月工资', '工资款', '工资总额', '应发工资', '应付工资', '实发工资', '欠付工资', '拖欠工资',
  '薪资', '薪酬', '奖金', '津贴', '补贴', '劳务费', '劳动报酬', '加班费', '经济补偿金', '赔偿金']
  .map(noun => Array.from(noun).join(`${LINE}*`)).join('|');
const LEADING_AMOUNT_NOUN = new RegExp(`^(?:${AMOUNT_NOUN})${CONTINUATION_BRIDGE}(?=的|${OPERATOR}|${FACTOR}${CONTINUATION_BRIDGE}倍)`, 'u');

function detectionView(value: string): string {
  return value.normalize('NFKC').replace(/\p{Cf}/gu, '')
    .replace(/[^\S\r\n\u2028\u2029]/gu, '');
}

/** Inspect raw text immediately before and after one already anchored money span.
 * Horizontal whitespace, compatibility glyphs and format controls are handled
 * only in the detection view. An explicit operator or 的…倍 can continue over
 * layout newlines; a bare number on the next line cannot attach to this amount.
 * Finite direct amount nouns before 的/an operator share that rule. A noun
 * directly followed by a bare factor+倍 must stay on the amount's same line.
 * Visible sentence separators and other intervening prose break attachment.
 * A true /月, /日, /小时 or /件 rate has no numeric operand and remains supported.
 */
export function hasAttachedMoneyArithmetic(before: string, after: string): boolean {
  const left = detectionView(before), right = detectionView(after);
  // Match the adjacent operator first; scanning a long number without an
  // operator must not repeatedly retry the complete numeric grammar.
  const operator = left.match(PREFIX_OPERATOR);
  if (operator && PREFIX_FACTOR.test(left.slice(0, operator.index))) return true;
  // A bare named factor does not imply a multiplier. Require the explicit
  // operator path here, preserving the existing numeric 倍 grammar separately.
  if (operator && !operator[0].startsWith('倍') && PREFIX_NAMED_OPERAND.test(left.slice(0, operator.index))) return true;
  const bridge = right.match(LEADING_BRIDGE)![0];
  let suffix = right.slice(bridge.length);
  const noun = suffix.match(LEADING_AMOUNT_NOUN);
  if (noun) {
    suffix = suffix.slice(noun[0].length);
    if (!suffix.startsWith('的')) {
      if (SUFFIX_OPERATOR.test(suffix)) return true;
      const multiplier = suffix.match(SUFFIX_MULTIPLIER);
      return multiplier !== null && !/[\r\n\u2028\u2029]/u.test(bridge + noun[0] + multiplier[0]);
    }
  }
  if (suffix.startsWith('的')) {
    suffix = suffix.slice(1).replace(LEADING_FACTOR_WRAPPERS, '');
    return SUFFIX_MULTIPLIER.test(suffix) || SUFFIX_FRACTION.test(suffix);
  }
  if (SUFFIX_OPERATOR.test(suffix)) return true;
  return !/[\r\n\u2028\u2029]/u.test(bridge) && SUFFIX_MULTIPLIER.test(suffix);
}
