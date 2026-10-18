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
const RMB_UNIT = '(?:元(?!旦|宵|年|月|素|件|音)|[圆圓](?!满|滿|形|圈|周))';
const RMB_SUFFIX = new RegExp(`^${BRIDGE}(?:人民币|人民幣|(?:CNY|RMB)(?![A-Z])|¥|${RMB_UNIT})`, 'iu');
const TOKEN_UNIT = new RegExp(`^${RMB_UNIT}`, 'u');
// A visible unit may actually begin a compound word. Keep this shared with
// clipped source review; a preceding RMB marker cannot turn a tuple into money.
// 元组装费 is a yuan amount followed by 组装费, not the compound 元组.
const NON_CURRENCY_YUAN_WORD = /^(?:元(?:旦|宵|年|月|素|件|音|[组組](?![装裝])|[宝寶])|[圆圓](?:满|滿|形|圈|周|桌|柱|锥|錐|球|筒|盘|盤|弧|环|環))/u;

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
  return TOKEN_UNIT.test(rest) && !NON_CURRENCY_YUAN_WORD.test(rest.replace(/\s/gu, ''));
}

/** Test the original token plus its immediate continuation on detection copies.
 * Layout alone cannot make a cropped compound word become a yuan unit. */
export function moneyTokenHasNonCurrencyYuan(token: string, after: string): boolean {
  const part = currencyText(token).replace(/\s/gu, '');
  const tail = currencyText(after).replace(/\s/gu, '');
  const whole = part + tail;
  return [...part.matchAll(/[元圆圓]/gu)].some(match => NON_CURRENCY_YUAN_WORD.test(whole.slice(match.index)))
    || (!/[元圆圓]/u.test(part) && NON_CURRENCY_YUAN_WORD.test(tail));
}

function anchoredMoneyEdges(source: AnchoredMoneySource, normalized: CandidateNormalization) {
  if (!normalized.span) return null;
  const characters = Array.from(normalized.rawValue);
  const start = source.valueStart + characters.slice(0, normalized.span.start).join('').length;
  const end = source.valueStart + characters.slice(0, normalized.span.end).join('').length;
  return {
    before: currencyText(source.blockText.slice(0, start)),
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
export function sourceMoneyHasUnsupportedCurrency(source: AnchoredMoneySource, normalized: CandidateNormalization): boolean {
  const edges = anchoredMoneyEdges(source, normalized);
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
    && (/(?:人民币|人民幣|¥)/u.test(edges.token) || unitInToken);
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
