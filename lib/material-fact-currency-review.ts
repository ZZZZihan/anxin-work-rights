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
// NFKC folds fullwidth letters, symbols and punctuation for detection only. A
// source newline or clause delimiter never becomes a bridge to another event.
const BRIDGE = String.raw`(?:[^\S\r\n\u2028\u2029]|[:=()\[\]{}【】“”‘’"'])*`;
const RMB_LABEL = '(?:人民币|人民幣|CNY|RMB|¥|[元圆圓](?:整|正)?)';
// A cropped RMB symbol must not hide an attached conflicting currency, either.
const CURRENCY_BRIDGE = `${BRIDGE}(?:${RMB_LABEL}${BRIDGE})*`;
const PREFIX = new RegExp(`${FOREIGN_MARKER}${CURRENCY_BRIDGE}$`, 'iu');
const SUFFIX = new RegExp(`^${CURRENCY_BRIDGE}${FOREIGN_MARKER}`, 'iu');

/**
 * Refuse a foreign currency marker directly attached to the anchored monetary
 * token, including a marker cropped out of value and quote. Offsets stay in the
 * untouched source; only the two resulting edges are folded for comparison.
 * ¥/￥, 人民币, CNY and RMB retain the existing RMB compatibility policy.
 */
export function sourceMoneyHasUnsupportedCurrency(source: AnchoredMoneySource, normalized: CandidateNormalization): boolean {
  if (!normalized.span) return false;
  const characters = Array.from(normalized.rawValue);
  const start = source.valueStart + characters.slice(0, normalized.span.start).join('').length;
  const end = source.valueStart + characters.slice(0, normalized.span.end).join('').length;
  const before = source.blockText.slice(0, start).normalize('NFKC');
  const after = source.blockText.slice(end).normalize('NFKC');
  return PREFIX.test(before) || SUFFIX.test(after);
}
