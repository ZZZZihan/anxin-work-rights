// Detect only an operator or multiplier attached to the anchored amount.
// This is not an evaluator, and detection copies never replace source evidence.
const NUMERALS = '0-9零〇一二三四五六七八九十百千万萬亿億两兩壹贰叁肆伍陆柒捌玖拾佰仟';
const NUMBER = `[${NUMERALS}]+(?:[.点][${NUMERALS}]+)?`;
const FACTOR = `[+−负負-]?${NUMBER}`;
// Currency, whole-amount and bracket wrappers may have been cropped off value.
// Prose and wage nouns do not belong in this general wrapper bridge.
const WRAPPER_ATOM = '(?:(?:人民币|人民幣|CNY|RMB)|[¥元圆圓角分整正()])';
const BRIDGE_ATOM = `(?:${WRAPPER_ATOM}|[${NUMERALS}]+[角分])`;
const LINE = '[\\r\\n\\u2028\\u2029]';
const CONTINUATION_BRIDGE = `(?:${BRIDGE_ATOM}|${LINE})*`;
const OPERATOR = `(?:乘${LINE}*以|除${LINE}*以|分${LINE}*之|加${LINE}*上|减${LINE}*去|另${LINE}*加|乘|除|加|减|[×*xX÷/+−-])`;
// A finite qualifier can modify an operand, but arbitrary surrounding prose
// cannot. Layout breaks are allowed only on the existing explicit paths.
const OPERAND_MODIFIER = ['实际', '应当', '应', '约定', '核定', '核算', '适用', '有效', '本月', '当月', '当期', '本期']
  .map(name => Array.from(name).join(`${LINE}*`)).join('|');
const NAMED_OPERAND_BASE = ['出勤系数', '工龄系数', '绩效系数', '工资系数', '计发系数', '折算系数', '考核系数', '岗位系数',
  '出勤比例', '支付比例', '计发比例', '折算比例', '出勤天数', '工作天数', '计薪天数', '工作月数', '计薪月数', '人数', '件数']
  .map(name => Array.from(name).join(`${LINE}*`)).join('|');
const NAMED_OPERAND = `(?:(?:${OPERAND_MODIFIER})${LINE}*(?:的${LINE}*)?){0,2}(?:${NAMED_OPERAND_BASE})`;
// Unknown formula variables are not amounts either. Bound identifiers and
// require their complete word so an arbitrary Chinese payment narrative is
// never accepted as an operand just because it follows 加 or 支付.
const SYMBOLIC_OPERAND = '(?:(?<![A-Za-z0-9_])[A-Za-z_][A-Za-z0-9_]{0,31}(?![A-Za-z0-9_])|(?<![α-ωΑ-Ω])[α-ωΑ-Ω](?![α-ωΑ-Ω]))';
const UNKNOWN_OPERAND = `(?:${NAMED_OPERAND}|${SYMBOLIC_OPERAND})`;
const OPERAND = `(?:${FACTOR}|${UNKNOWN_OPERAND})`;
// Coefficients and ratios can have names unknown to this parser. Bound the
// complete Han name to 16 characters and require its coefficient/rate suffix,
// then use it only on explicit arithmetic paths. This is not arbitrary prose
// or an ordinary /月 rate. A one-character 率 suffix has one more name slot.
const COEFFICIENT_OPERAND = `(?:(?:[\\p{Script=Han}]${LINE}*){0,14}(?:系${LINE}*[数數]|比${LINE}*例)|(?:[\\p{Script=Han}]${LINE}*){0,15}率)`;
const EXPLICIT_OPERAND = `(?:${OPERAND}|${COEFFICIENT_OPERAND})`;
// Single-character operators must not cut ordinary words such as 加班费 or
// 除外. Multi-character operator words and symbols already state the operation.
const COEFFICIENT_OPERATOR = `(?:乘${LINE}*以|除${LINE}*以|分${LINE}*之|加${LINE}*上|减${LINE}*去|另${LINE}*加|乘|除(?!${LINE}*(?:外|了))|加(?!${LINE}*(?:班|薪))|减(?!${LINE}*(?:免|薪))|[×*xX÷/+−-])`;
// 成/折 name proportions of the anchored base, never the payable result.
// Keep their grammar finite and require attachment (的/打/operator, or the
// same-line bare factor rule). Do not read 八成 in independent prose as math.
const PROPORTION = `(?:${FACTOR}${LINE}*(?:成(?:${LINE}*[0-9零〇一二三四五六七八九半])?|折)|半${LINE}*[成折]|[对對]${LINE}*折)`;
const SUFFIX_PROPORTION = new RegExp(`^(?:${PROPORTION})`, 'u');
const SUFFIX_DISCOUNT = new RegExp(`^打${LINE}*(?:${PROPORTION})`, 'u');
const PREFIX_PROPORTION = new RegExp(`(?:${PROPORTION})${CONTINUATION_BRIDGE}的${CONTINUATION_BRIDGE}$`, 'u');
const PREFIX_PROPORTION_FACTOR = new RegExp(`(?:${PROPORTION})${CONTINUATION_BRIDGE}$`, 'u');
const PREFIX_OPERATOR = new RegExp(`(?:倍${CONTINUATION_BRIDGE}(?:的${CONTINUATION_BRIDGE})?|${OPERATOR}${CONTINUATION_BRIDGE})$`, 'u');
const PREFIX_FACTOR = new RegExp(`${FACTOR}${CONTINUATION_BRIDGE}$`, 'u');
const PREFIX_UNKNOWN_OPERAND = new RegExp(`(?:${UNKNOWN_OPERAND}|${COEFFICIENT_OPERAND})${CONTINUATION_BRIDGE}$`, 'u');
const SUFFIX_MULTIPLIER = new RegExp(`^${OPERAND}${CONTINUATION_BRIDGE}倍`, 'u');
const SUFFIX_EXPLICIT_MULTIPLIER = new RegExp(`^${EXPLICIT_OPERAND}${CONTINUATION_BRIDGE}倍`, 'u');
const SUFFIX_FRACTION = new RegExp(`^(?:${EXPLICIT_OPERAND}${CONTINUATION_BRIDGE}(?:分${LINE}*之|/)${CONTINUATION_BRIDGE}${EXPLICIT_OPERAND}|[+−负負-]?(?:一${LINE}*)?半|${EXPLICIT_OPERAND}${CONTINUATION_BRIDGE}%)`, 'u');
const SUFFIX_OPERATOR = new RegExp(`^${OPERATOR}${CONTINUATION_BRIDGE}${OPERAND}`, 'u');
const SUFFIX_COEFFICIENT_OPERATOR = new RegExp(`^${COEFFICIENT_OPERATOR}${CONTINUATION_BRIDGE}${COEFFICIENT_OPERAND}`, 'u');
// A named wage component is an unknown operand only on an explicit operation.
// Bound a complete Han component name to 16 code points and require one of the
// finite payroll noun endings. Thus 销售提成/工龄津贴 share the guard without
// accepting arbitrary prose. Ordinary 加班费, 奖金发放 or a separate worker's
// payment narrative cannot be cut into an operation.
const PAY_COMPONENT = ['基本工资', '岗位工资', '绩效工资', '计件工资', '工资', '薪资', '薪酬', '奖金', '年终奖', '绩效奖金', '绩效奖',
  '加班费', '提成', '佣金', '津贴', '交通补贴', '补贴', '餐补', '房补', '补助金', '补助', '劳务费', '劳动报酬', '经济补偿金', '赔偿金']
  .map(noun => `(?:[\\p{Script=Han}]${LINE}*){0,${16 - Array.from(noun).length}}${Array.from(noun).join(`${LINE}*`)}`).join('|');
const PAY_COMPONENT_OPERAND = `(?:(?:${OPERAND_MODIFIER})${LINE}*(?:的${LINE}*)?){0,2}(?:${PAY_COMPONENT})(?!\\p{L}|\\p{N})`;
const SUFFIX_PAY_COMPONENT_OPERATOR = new RegExp(`^${COEFFICIENT_OPERATOR}${CONTINUATION_BRIDGE}${PAY_COMPONENT_OPERAND}`, 'u');
const PREFIX_PAY_COMPONENT_OPERATOR = new RegExp(`${COEFFICIENT_OPERATOR}${CONTINUATION_BRIDGE}$`, 'u');
const PREFIX_PAY_COMPONENT = new RegExp(`(?<!\\p{L}|\\p{N})${PAY_COMPONENT_OPERAND}${CONTINUATION_BRIDGE}$`, 'u');
// A presentation hyphen can introduce a payment date or duration. Require a
// complete time unit: a bare -2000, -200元 or -50% remains subtraction. This
// exception does not apply to an explicit 减/减去 or the mathematical minus −.
// The final boundary prevents a partial year from hiding -2024年5元/年5.
const TIME_INTEGER = `[${NUMERALS}]+`;
// A punctuation-only date needs all three components. A bare -2000.05 is
// also a decimal subtraction, so year/month without named units is ambiguous.
const HYPHEN_TIME = new RegExp(`^-${LINE}*(?:[0-9]{4}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12][0-9]|3[01])|${TIME_INTEGER}年(?:${LINE}*${TIME_INTEGER}月(?:${LINE}*${TIME_INTEGER}日)?)?|${NUMBER}(?:个?月|日|天|小时|分钟|秒))(?![${NUMERALS}点.元圆圓角分%/×*xX÷+−-])`, 'u');

function suffixIsOperation(suffix: string): boolean {
  return (SUFFIX_OPERATOR.test(suffix) || SUFFIX_COEFFICIENT_OPERATOR.test(suffix) || SUFFIX_PAY_COMPONENT_OPERATOR.test(suffix)) && !HYPHEN_TIME.test(suffix);
}
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
const LEADING_AMOUNT_NOUN = new RegExp(`^(?:${AMOUNT_NOUN})${CONTINUATION_BRIDGE}(?=的|打|${OPERATOR}|${OPERAND}${CONTINUATION_BRIDGE}倍|${PROPORTION})`, 'u');

function detectionView(value: string): string {
  const glyphs: Record<string, string> = { 貳: '贰', 參: '叁', 陸: '陆', 獎: '奖', 終: '终', 費: '费', 資: '资', 績: '绩', 貼: '贴', 補: '补', 勞: '劳', 務: '务', 動: '动', 報: '报', 經: '经', 濟: '济', 償: '偿', 賠: '赔', 減: '减', 當: '当', 實: '实', 應: '应', 約: '约', 適: '适', 計: '计', 發: '发', 齡: '龄', 數: '数' };
  return value.normalize('NFKC').replace(/\p{Cf}/gu, '')
    .replace(/[^\S\r\n\u2028\u2029]/gu, '')
    .replace(/[貳參陸獎終費資績貼補勞務動報經濟償賠減當實應約適計發齡數]/gu, glyph => glyphs[glyph]);
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
  // The amount can be the right operand as well. Require the same bounded
  // complete payroll name and an explicit operator, never a bare adjacent noun.
  const payOperator = left.match(PREFIX_PAY_COMPONENT_OPERATOR);
  if (payOperator && PREFIX_PAY_COMPONENT.test(left.slice(0, payOperator.index))) return true;
  // A named coefficient or variable is meaningful only with the adjacent
  // operator or explicit 倍 construction, never as a bare name elsewhere.
  if (operator && PREFIX_UNKNOWN_OPERAND.test(left.slice(0, operator.index))) return true;
  if (operator && PREFIX_PROPORTION_FACTOR.test(left.slice(0, operator.index))) return true;
  if (PREFIX_PROPORTION.test(left)) return true;
  const bridge = right.match(LEADING_BRIDGE)![0];
  let suffix = right.slice(bridge.length);
  const noun = suffix.match(LEADING_AMOUNT_NOUN);
  if (noun) {
    suffix = suffix.slice(noun[0].length);
    if (!suffix.startsWith('的')) {
      if (suffixIsOperation(suffix) || SUFFIX_DISCOUNT.test(suffix)) return true;
      const multiplier = suffix.match(SUFFIX_MULTIPLIER) ?? suffix.match(SUFFIX_PROPORTION);
      return multiplier !== null && !/[\r\n\u2028\u2029]/u.test(bridge + noun[0] + multiplier[0]);
    }
  }
  if (suffix.startsWith('的')) {
    suffix = suffix.slice(1).replace(LEADING_FACTOR_WRAPPERS, '');
    return SUFFIX_EXPLICIT_MULTIPLIER.test(suffix) || SUFFIX_FRACTION.test(suffix) || SUFFIX_PROPORTION.test(suffix);
  }
  if (suffixIsOperation(suffix) || SUFFIX_DISCOUNT.test(suffix)) return true;
  return !/[\r\n\u2028\u2029]/u.test(bridge) && (SUFFIX_MULTIPLIER.test(suffix) || SUFFIX_PROPORTION.test(suffix));
}
