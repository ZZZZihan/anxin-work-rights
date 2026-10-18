import type { CandidateNormalization } from './material-fact-types-v3';

type AnchoredMoneySource = { blockText: string; valueStart: number };

// This is a runtime availability guard, not a parser or a currency conversion.
// Keep the frozen normalizer, original spelling and source positions unchanged.
const CURRENCY_NAMES = [
  '美元', '美金', '美圆', '美圓', '美刀', '美分', '港币', '港幣', '港元', '港圆', '港圓', '港仙',
  '澳门元', '澳門元', '澳门币', '澳门幣', '澳門币', '澳門幣', '澳元', '澳币', '澳幣', '澳圆', '澳圓', '澳大利亚元', '澳大利亞元',
  '欧元', '歐元', '欧币', '歐幣', '欧分', '歐分', '日元', '日圆', '日圓', '日币', '日幣', '円',
  '英镑', '英鎊', '韩元', '韓元', '韩币', '韓幣', '圜', '新加坡元', '新元', '新币', '新幣',
  '新台币', '新臺幣', '新台幣', '新臺币', '台币', '台幣', '臺币', '臺幣', '台元', '臺元',
  '加拿大元', '加元', '加币', '加幣', '新西兰元', '新西蘭元', '纽西兰元', '紐西蘭元', '纽元', '紐元',
  '瑞士法郎', '瑞郎', '法郎', '卢布', '盧布', '卢比', '盧比', '泰铢', '泰銖', '印尼盾', '越南盾',
  '马来西亚林吉特', '馬來西亞林吉特', '马来西亚令吉', '馬來西亞令吉', '林吉特', '令吉', '比索', '雷亚尔', '雷亞爾', '迪拉姆', '里亚尔', '里亞爾', '兰特', '蘭特',
].join('|');
const CURRENCY_CODES = '(?<![A-Z])(?:USD|HKD|AUD|EUR|JPY|GBP|KRW|SGD|MOP|TWD|CAD|NZD|CHF|RUB|INR|THB|IDR|VND|MYR|PHP|BRL|AED|SAR|ZAR|NOK|SEK|DKK|ISK|PLN|CZK|HUF|RON|BGN|TRY|ARS|CLP|COP|PEN|MXN|ILS|IRR|IQD|QAR|KWD|BHD|OMR|PKR|BDT|LKR|NPR|MMK|KHR|LAK|MNT|NGN|EGP|KES|GHS|UGX|TZS|XOF|XAF|XPF|XCD|BTC|ETH)(?![A-Z])';
const CURRENCY_SYMBOLS = '(?!¥)\\p{Sc}';
const CURRENCY_WORDS = '(?<![A-Z])(?:DOLLARS?|EUROS?|POUNDS?|YEN|WON|RS\\.?)(?![A-Z])';
const HORIZONTAL_SPACE = String.raw`[^\S\r\n\u2028\u2029]*`;
// The dollar sign is still a foreign marker when a regional prefix comes first
// in a suffix: US$, HK$, S$, A$, NT$, NZ$, R$, U.S.$, and fullwidth equivalents.
const QUALIFIED_SYMBOL = `(?<![A-Z])(?:[A-Z]\\.?){1,3}${HORIZONTAL_SPACE}${CURRENCY_SYMBOLS}`;
const JAPANESE_YEN = `(?<![A-Z])J\\.?P\\.?(?:N\\.?)?${HORIZONTAL_SPACE}¥`;
const FOREIGN_MARKER = `(?:${CURRENCY_NAMES}|${CURRENCY_CODES}|${QUALIFIED_SYMBOL}|${CURRENCY_SYMBOLS}|${CURRENCY_WORDS}|${JAPANESE_YEN})`;
const FOREIGN_LITERAL = new RegExp(FOREIGN_MARKER, 'iu');
// A deliberately narrow name shape, not identity validation. Complex supplied
// subjects keep the currency guard: 王甲港币 or 王甲以美元 cannot hide a marker.
const CURRENCY_NAME_SUBJECT = new RegExp(`^[王李张張刘劉陈陳杨楊黄黃赵趙吴吳周徐孙孫马馬朱胡郭何高林罗羅郑鄭梁谢謝宋唐许許韩韓冯馮邓鄧曹彭曾肖萧蕭田董袁潘于蒋蔣蔡余杜叶葉程苏蘇魏吕呂丁任沈姚卢盧姜崔钟鍾谭譚陆陸汪范金石廖贾賈夏韦韋方白邹鄒孟熊秦邱侯江尹薛阎閻段雷龙龍黎史陶贺賀顾顧毛郝龚龔邵万萬钱錢严嚴武戴莫孔向汤湯]${FOREIGN_MARKER}$`, 'iu');
// NFKC folds fullwidth letters, symbols and punctuation for detection only. A
// source newline or clause delimiter never becomes a bridge to another event.
const BRIDGE = String.raw`(?:[^\S\r\n\u2028\u2029]|[:=()\[\]{}【】“”‘’"'])*`;
const RMB_LABEL = '(?:人民币|人民幣|CNY|RMB|¥|[元圆圓](?:整|正)?)';
// A cropped RMB symbol must not hide an attached conflicting currency, either.
const CURRENCY_BRIDGE = `${BRIDGE}(?:${RMB_LABEL}${BRIDGE})*`;
const PREFIX = new RegExp(`${FOREIGN_MARKER}${CURRENCY_BRIDGE}$`, 'iu');
const SUFFIX = new RegExp(`^${CURRENCY_BRIDGE}${FOREIGN_MARKER}`, 'iu');
// These words can attribute the same anchored wage/payment to its currency even
// when the model crops the marker out of both value and quote. No arbitrary text,
// person name, numeral, clause delimiter or newline can join this finite bridge.
const WAGE_CURRENCY_WORD = '(?:(?:基本)?工[资資]|薪酬|薪[资資]|薪金|[劳勞][动動][报報]酬|[报報]酬|[计計][价價付发發薪酬算]|折算|折合|[计計]|支付|[发發]放|[结結]算|[标標][准準]|[约約]定|共[计計]|合[计計]|金[额額]|[为為]|是|共|的)';
const WAGE_CURRENCY_PREFIX = new RegExp(`${FOREIGN_MARKER}${CURRENCY_BRIDGE}(?:${WAGE_CURRENCY_WORD}${CURRENCY_BRIDGE})+$`, 'iu');
const WAGE_CURRENCY_SUFFIX = new RegExp(`^${CURRENCY_BRIDGE}(?:(?:${WAGE_CURRENCY_WORD}|币种|幣種|以|按)${CURRENCY_BRIDGE})+${FOREIGN_MARKER}`, 'iu');
const RMB_PREFIX = new RegExp(`(?:人民币|人民幣|(?<![A-Z])(?:CNY|RMB)(?![A-Z])|¥)${BRIDGE}$`, 'iu');
// A cropped 元 in 元旦 (or 圆 in 圆满) is part of a word, not a unit.
// Explicit payment purposes follow the yuan unit: 4000元 + 年终奖/年假补偿.
// This exception does not make 元年 itself, 元月 or arbitrary 年… text money.
const NON_CURRENCY_YUAN_YEAR = '年(?![终終][奖獎]|假(?:[补補][偿償]|工[资資]))';
const RMB_UNIT = `(?:元(?!旦|宵|${NON_CURRENCY_YUAN_YEAR}|月|素|件|音)|[圆圓](?!满|滿|形|圈|周))`;
const RMB_SUFFIX = new RegExp(`^${BRIDGE}(?:人民币|人民幣|(?:CNY|RMB)(?![A-Z])|¥|${RMB_UNIT})`, 'iu');
const TOKEN_UNIT = new RegExp(`^${RMB_UNIT}`, 'u');
// A visible unit may actually begin a compound word. Keep this shared with
// clipped source review; a preceding RMB marker cannot turn a tuple into money.
// 元组装费 is a yuan amount followed by 组装费, not the compound 元组.
const NON_CURRENCY_YUAN_WORD = new RegExp(`^(?:元(?:旦|宵|${NON_CURRENCY_YUAN_YEAR}|月|素|件|音|[组組](?![装裝])|[宝寶])|[圆圓](?:满|滿|形|圈|周|桌|柱|锥|錐|球|筒|盘|盤|弧|环|環))`, 'u');
const NUMERIC_CHARACTER = /[0-9零〇一二三四五六七八九十百千万萬亿億两兩壹贰叁肆伍陆柒捌玖拾佰仟]/u;

// These complete lexical compounds use 元 as a word component. Do not ban
// arbitrary 元论/元催化 continuations: 五元论文费 and 五元催化器维修费
// still describe a yuan amount followed by its purpose.
function ordinaryYuanCompoundAt(value: string, index: number): boolean {
  const before = value.slice(0, index), after = value.slice(index);
  const head = before.slice(-1), previous = before.slice(-2, -1);
  if (previous && NUMERIC_CHARACTER.test(previous)) return false;
  return /[二2]/u.test(head) && /^元[论論](?![文证證述])/u.test(after)
    || /[三3]/u.test(head) && /^元催化(?:器|剂|劑)/u.test(after);
}

// Detection copies may be folded, but callers keep their original text and
// offsets. Format controls must not split a visible currency name or unit.
function currencyText(text: string): string {
  return text.normalize('NFKC').replace(/\p{Cf}/gu, '');
}

/** A complete candidate literal may not discard any conflicting currency in
 * that literal. Source blocks still require the narrower anchored checks below,
 * so another event cannot lend or invalidate the current event's currency. */
export function monetaryExpressionHasUnsupportedCurrency(value: string): boolean {
  return FOREIGN_LITERAL.test(currencyText(value));
}

/** Test a unit at an original UTF-16 offset without treating the 元 in 元旦 or
 * the 圆 in 圆满 as currency. The same lexical boundary serves parsing/review. */
export function isRmbCurrencyUnitAt(value: string, index: number): boolean {
  const rest = currencyText(value.slice(index));
  const before = currencyText(value.slice(0, index)).replace(/\s/gu, '');
  const after = rest.replace(/\s/gu, '');
  return TOKEN_UNIT.test(rest) && !NON_CURRENCY_YUAN_WORD.test(after)
    && !ordinaryYuanCompoundAt(before + after, before.length);
}

/** Test the original token plus its immediate continuation on detection copies.
 * Layout alone cannot make a cropped compound word become a yuan unit. */
export function moneyTokenHasNonCurrencyYuan(token: string, after: string): boolean {
  const part = currencyText(token).replace(/\s/gu, '');
  const tail = currencyText(after).replace(/\s/gu, '');
  const whole = part + tail;
  return [...part.matchAll(/[元圆圓]/gu)].some(match => NON_CURRENCY_YUAN_WORD.test(whole.slice(match.index)) || ordinaryYuanCompoundAt(whole, match.index))
    || (!/[元圆圓]/u.test(part) && (NON_CURRENCY_YUAN_WORD.test(tail) || ordinaryYuanCompoundAt(whole, part.length)));
}

// A supplied subject is evidence only at one complete, same-clause occurrence
// before this amount. Never infer a name in the standalone literal parser, and
// never exempt a currency word itself just because the model calls it a subject.
function beforeWithoutAnchoredSubject(text: string, start: number, end: number, subject: string | null): string {
  const before = text.slice(0, start);
  if (!subject || /[，,。！？!?；;\r\n\u2028\u2029]/u.test(subject)) return before;
  const detection = currencyText(subject).trim();
  if (!CURRENCY_NAME_SUBJECT.test(detection)) return before;
  const separators = /[，,。！？!?；;\r\n\u2028\u2029]/u;
  let left = start, right = end;
  while (left > 0 && !separators.test(text[left - 1])) left--;
  while (right < text.length && !separators.test(text[right])) right++;
  const clause = text.slice(left, right), offset = clause.indexOf(subject);
  if (offset < 0 || clause.indexOf(subject, offset + 1) >= 0) return before;
  const subjectStart = left + offset, subjectEnd = subjectStart + subject.length;
  if (subjectEnd > start) return before;
  const preceding = currencyText(text.slice(left, subjectStart));
  // Do not trim a supplied substring out of a larger person's name. A finite
  // role label can introduce the complete subject; arbitrary prose cannot.
  // Separate property alternatives retain supplementary letters/numbers on
  // hosts whose regexp class-plus-end-anchor optimization mishandles them.
  if (/(?:\p{L}|\p{N})$/u.test(preceding)
    && !/(?:员工|員工|工人|劳动者|勞動者|原告|被告|申请人|申請人|向|给|給)$/u.test(preceding)) return before;
  const following = currencyText(text.slice(subjectEnd, start));
  if (!new RegExp(`^${BRIDGE}(?:的${BRIDGE})?(?:${WAGE_CURRENCY_WORD}|人民币|人民幣|${FOREIGN_MARKER}|[0-9零〇一二三四五六七八九十])`, 'iu').test(following)) return before;
  // Parentheses are a neutral bridge, not deletion: an external marker may
  // still attach through the subject, while split letters cannot form a marker.
  return text.slice(0, subjectStart) + '()' + text.slice(subjectEnd, start);
}

function anchoredMoneyEdges(source: AnchoredMoneySource, normalized: CandidateNormalization, subject: string | null = null) {
  if (!normalized.span) return null;
  const characters = Array.from(normalized.rawValue);
  const start = source.valueStart + characters.slice(0, normalized.span.start).join('').length;
  const end = source.valueStart + characters.slice(0, normalized.span.end).join('').length;
  return {
    before: currencyText(beforeWithoutAnchoredSubject(source.blockText, start, end, subject)),
    token: currencyText(source.blockText.slice(start, end)),
    after: currencyText(source.blockText.slice(end)),
  };
}

/**
 * Refuse a foreign currency marker attached to the anchored monetary token,
 * directly or through finite same-event wage/payment wording, including a marker
 * cropped out of value and quote. Offsets stay in the
 * untouched source; only the two resulting edges are folded for comparison.
 * ¥/￥, 人民币, CNY and RMB retain the existing RMB compatibility policy.
 */
export function sourceMoneyHasUnsupportedCurrency(source: AnchoredMoneySource, normalized: CandidateNormalization, subject: string | null = null): boolean {
  const edges = anchoredMoneyEdges(source, normalized, subject);
  if (!edges) return false;
  // A model can retain the yen sign inside value while cropping its JP prefix.
  // Include the token's leading currency characters when checking that edge.
  const leadingMarker = edges.token.match(/^(?:人民币|人民幣)?[^\S\r\n\u2028\u2029]*¥/u)?.[0] ?? '';
  return PREFIX.test(edges.before) || PREFIX.test(edges.before + leadingMarker)
    || WAGE_CURRENCY_PREFIX.test(edges.before.replace(/[^\S\r\n\u2028\u2029]/gu, '')) || SUFFIX.test(edges.after)
    || WAGE_CURRENCY_SUFFIX.test(edges.after.replace(/[^\S\r\n\u2028\u2029]/gu, ''));
}

/** A bare number is never evidence of RMB. Only this anchored token or its
 * immediately attached edges can supply the currency; headers, another event,
 * and another line must not lend their unit to an otherwise unitless number. */
export function sourceMoneyHasExplicitRmbCurrency(source: AnchoredMoneySource, normalized: CandidateNormalization): boolean {
  const edges = anchoredMoneyEdges(source, normalized);
  if (!edges) return false;
  const unitInToken = [...edges.token.matchAll(/[元圆圓]/gu)]
    .some(match => isRmbCurrencyUnitAt(edges.token + edges.after, match.index));
  const inToken = !/[\r\n\u2028\u2029]/u.test(edges.token)
    && (/(?:人民币|人民幣|(?<![A-Z])(?:RMB|CNY)(?![A-Z])|¥)/iu.test(edges.token) || unitInToken);
  return inToken || RMB_PREFIX.test(edges.before) || RMB_SUFFIX.test(edges.after);
}

/** A matched 角/分 may be the start of an ordinary word rather than cents.
 * Inspect only subunit characters inside this token; the following source can
 * complete a cropped word across OCR whitespace, but cannot contribute a unit.
 * Detection copies never replace the source used for evidence or offsets. */
const NON_CURRENCY_SUBUNIT_WORD = '(?:分(?:钟|鐘|米|贝|貝|数|數|配|类|類|析|别|別|期|段|批|时|時|量|摊|攤|红|紅|店|公司|支|组|組|隔|辨|歧|清|离|離)|角(?:度|色|落|逐|标|標|形|点|點|膜|质|質))';

/** Only complete, explicit measure units establish a non-monetary count.
 * Other lexical uses such as 十万分红 may name a unitless amount: excluding
 * their 分 from cents is not sufficient evidence to reject the whole value. */
export function isNonCurrencySubunitMeasure(value: string): boolean {
  return /^(?:分[钟鐘米贝貝]|角度)$/u.test(currencyText(value).replace(/\s/gu, ''));
}

export function moneyTokenHasNonCurrencySubunit(token: string, after: string): boolean {
  const part = currencyText(token).replace(/\s/gu, '');
  const whole = part + currencyText(after).replace(/\s/gu, '');
  const ordinary = new RegExp(`^${NON_CURRENCY_SUBUNIT_WORD}`, 'u');
  const fraction = /^分之(?=$|[0-9零〇一二三四五六七八九十百千万亿两壹贰叁肆伍陆柒捌玖拾佰仟A-Za-z_α-ωΑ-Ω])/u;
  return [...part.matchAll(/[角分]/gu)].some(match => ordinary.test(whole.slice(match.index)) || fraction.test(whole.slice(match.index)));
}

export function sourceMoneyHasNonCurrencySubunit(source: AnchoredMoneySource, normalized: CandidateNormalization): boolean {
  const edges = anchoredMoneyEdges(source, normalized);
  return edges !== null && moneyTokenHasNonCurrencySubunit(edges.token, edges.after);
}

export function sourceMoneyHasNonCurrencyYuan(source: AnchoredMoneySource, normalized: CandidateNormalization): boolean {
  const edges = anchoredMoneyEdges(source, normalized);
  return edges !== null && moneyTokenHasNonCurrencyYuan(edges.token, edges.after);
}
