import type { CandidateNormalization, DateMeaning, RawCandidateV3 } from './material-fact-types-v3';

// Date roles are events, not interchangeable labels for any nearby calendar text.
// This finite envelope deliberately leaves unsupported prose for human review.
const dateCues: [DateMeaning, RegExp][] = [
  ['employment_period', /^(?:解除劳动关系|终止劳动关系|劳动关系解除|劳动关系终止|解除劳动合同|终止劳动合同|劳动合同解除|劳动合同终止|开始工作|参加工作|入职|离职|任职|工作|到岗|上岗|入厂|离岗|离厂|辞职)(?:日(?!期))?/u],
  ['wage_period', /^(?:(?:工资|薪酬|薪资)(?:(?:所属|归属|覆盖|计发|计薪|对应)(?:期间|月份|期|月)?|支付覆盖(?:期间|期)?|期间)|停工留薪期)/u],
  ['contract_signing', /^(?:(?:签订|签署|订立|签字|签章)(?:劳动)?合同|(?:劳动)?合同(?:签订|签署|订立|签字|签章)|签约)(?:日(?!期))?/u],
  ['contract_performance', /^(?:劳动)?合同(?:约定)?(?:履行(?:期间|期)?|有效(?:期间|期)?|期限|生效)(?:日(?!期))?/u],
  ['payment_date', /^(?:(?:实际)?(?:收到|领取)(?:本期|该期|该笔)?(?:工资|薪酬|薪资)(?:截止日期|截止时间|截止日|日(?!期))?|(?:工资|薪酬|薪资)(?:收到|领取)(?:截止日期|截止时间|截止日|日(?!期))?)/u],
  ['other_date', /^(?:发生工伤|工伤发生|工伤日期|受伤|调薪生效|工资调整生效|调整工资生效|调薪)(?:日(?!期))?/u],
];
const dateNumber = '[0-9〇零一二三四五六七八九十百千两]';
const calendarDate = `(?:${dateNumber}{2,4}年(?:${dateNumber}{1,3}月(?:${dateNumber}{1,3}日)?)?|[0-9]{4}[-/.][0-9]{1,2}(?:[-/.][0-9]{1,2})?)`;
const shortDate = `(?:${dateNumber}{1,3}月(?:${dateNumber}{1,3}日)?|${dateNumber}{1,3}日)`;
// Preserve a complete source month/day without inventing a missing year. This
// finite point form is used only by explicit wage-payment/receipt layouts.
const monthDayPaymentDate = /^(?:[1-9]|1[0-2]|[一二三四五六七八九]|十[一二]?)月(?:[1-9]|[12][0-9]|3[01]|[一二三四五六七八九]|十[一二三四五六七八九]?|二十[一二三四五六七八九]?|三十一?)日$/u;
const intervalEnd = `(?:${calendarDate}|${shortDate}|今)`;
const dateInterval = (start: string) => `(?:自|从|截至|截止至|截止到|截止|到|至)?${start}(?:(?:起)?(?:至|到|—|–|-|~|～)${intervalEnd})?(?:以前|以后|之前|之后|为止|起|止|前|后)?`;
const completeDate = new RegExp(`^${dateInterval(calendarDate)}$`, 'u');
// The protocol permits parallel wage periods as one continuous source literal;
// retain the complete list instead of accepting a cropped first month/range.
const completeWageDates = new RegExp(`^${dateInterval(calendarDate)}(?:[、及和与]${dateInterval(`(?:${calendarDate}|${shortDate})`)})+$`, 'u');
const compact = (text: string) => text.normalize('NFKC').replace(/\s+/gu, '');
// Recurring payment days are explicit source dates, without an invented year or
// month. Keep their finite valid day range separate from other calendar roles.
const recurringPaymentDate = /^每(?:个|個)?月(?:第)?(?:[1-9]|[12][0-9]|3[01]|[一二三四五六七八九]|十[一二三四五六七八九]?|二十[一二三四五六七八九]?|三十一?)[日号號]$/u;
// Fold only detection copies of the existing money-role vocabulary, after raw
// subject/period offsets are located. No source text or candidate is rewritten.
const roleGlyphs: Record<string, string> = { 應: '应', 資: '资', 總: '总', 額: '额', 計: '计', 實: '实', 發: '发', 幣: '币', 圓: '圆', 稅: '税', 間: '间', 補: '补', 貼: '贴', 預: '预', 賠: '赔', 償: '偿', 決: '决', 給: '给', 單: '单', 標: '标', 準: '准', 費: '费', 時: '时', 領: '领', 為: '为' };
const moneyRole = (text: string) => compact(text).replace(/[應資總額計實發幣圓稅間補貼預賠償決給單標準費時領為]/gu, glyph => roleGlyphs[glyph]);
// Date-only cue/bridge aliases, after literal owner/value positions are found.
// Folding never changes the subject, date literal, quote or source offsets.
const dateGlyphs: Record<string, string> = { 於: '于', 職: '职', 辭: '辞', 資: '资', 歸: '归', 屬: '属', 間: '间', 簽: '签', 訂: '订', 勞: '劳', 動: '动', 關: '关', 終: '终', 開: '开', 廠: '厂', 離: '离', 約: '约', 發: '发', 計: '计', 領: '领', 實: '实', 際: '际', 係: '系', 該: '该', 時: '时', 為: '为', 調: '调', 傷: '伤', 並: '并', 與: '与', 結: '结', 後: '后', 從: '从', 應: '应', 須: '须', 給: '给', 畢: '毕', 帳: '账', 賬: '账' };
const dateRole = (text: string) => compact(text).replace(/[於職辭資歸屬間簽訂勞動關終開廠離約發計領實際係該時為調傷並與結後從應須給畢帳賬]/gu, glyph => dateGlyphs[glyph]);
const groupLabel = /[、，,]|班[组組]|公司|[单單]位|集[团團]|工人|[员員]工|[劳勞][动動]者|群[体體]|集[体體]|[众眾]人/u;
// Explicit plural kinship/party labels cannot identify one wage beneficiary.
// Keep their literal amounts for review; an individual model label is no proof
// that a family/party total belongs to one person.
const pluralOwnerLabel = /兄弟|姐妹|夫妻|夫[妇婦]|父[子女]|母[子女]|祖[孙孫]|[双雙]方|各方|多方/u;
// The existing terminal-name exception below has no second person fragment.
// Surname shapes never prove that two nonempty coordinated parts are one worker.
const commonSurname = '王李张張刘劉陈陳杨楊黄黃赵趙吴吳周徐孙孫马馬朱胡郭何高林罗羅郑鄭梁谢謝宋唐许許韩韓冯馮邓鄧曹彭曾肖萧蕭田董袁潘于蒋蔣蔡余杜叶葉程苏蘇魏吕呂丁任沈姚卢盧姜崔钟鍾谭譚陆陸汪范金石廖贾賈夏韦韋方白邹鄒孟熊秦邱侯江尹薛阎閻段雷龙龍黎史陶贺賀顾顧毛郝龚龔邵万萬钱錢严嚴武戴莫孔向汤湯';
const surname = new RegExp(`^[${commonSurname}]$`, 'u');
function collectiveSubject(subject: string): boolean {
  const text = compact(subject);
  if (groupLabel.test(text) || pluralOwnerLabel.test(text) || /等(?:人)?$/u.test(text)
    || /^(?:[他她我你][们們]|大家|各位|[诸諸]位)$/u.test(text)) return true;
  const parts = text.split(/[和与與及跟暨或同&/]/u);
  if (parts.length === 1) return false;
  // A terminal conjunction in a two-codepoint name has no second person (何和,
  // 周及). Longer incomplete labels and multiple coordinators stay uncertain.
  if (parts.some(part => !part)) return !(parts.length === 2 && Array.from(text).length === 2 && surname.test(parts[0]) && !parts[1] && /[和与與及]$/u.test(text));
  // Every nonempty part may denote a different person. The model's individual
  // label and a name-shaped literal cannot resolve that source ambiguity.
  return true;
}

function dateSide(text: string): { meanings: DateMeaning[]; joins: number } | null {
  let remaining = dateRole(text), needsCue = false, joins = 0;
  const meanings: DateMeaning[] = [];
  while (remaining) {
    const cue = dateCues.map(([meaning, pattern]) => ({ meaning, text: remaining.match(pattern)?.[0] })).find(item => item.text);
    if (cue) {
      meanings.push(cue.meaning); remaining = remaining.slice(cue.text!.length); needsCue = false;
      continue;
    }
    // No boundary words (起/止/前/后/至) here: they must remain in raw.value,
    // otherwise the model has cropped the date or its interval semantics.
    const neutral = remaining.match(/^(?:日期|时间|期间|开始|结束|的|于|在|为|是|[:：])/u)?.[0];
    if (neutral) { remaining = remaining.slice(neutral.length); continue; }
    const join = remaining.match(/^(?:并且|同时|也是|和|及|与|且|并|亦)/u)?.[0];
    if (join && meanings.length && !needsCue) {
      joins++; needsCue = true; remaining = remaining.slice(join.length); continue;
    }
    return null;
  }
  return needsCue ? null : { meanings, joins };
}

function hasSupportedDateMeaning(raw: RawCandidateV3, before: string, after: string): boolean {
  // A cropped year/month/day, a second date outside the candidate, or event prose
  // hidden inside value must not acquire a role merely because a verb matches.
  const value = dateRole(raw.value);
  if (!completeDate.test(value) && !(raw.meaning === 'wage_period' && completeWageDates.test(value))
    && !(raw.meaning === 'payment_date' && recurringPaymentDate.test(value))) return false;
  const left = dateSide(before), right = dateSide(after);
  if (!left || !right) return false;
  const cues = [...left.meanings, ...right.meanings];
  if (cues.length === 1) return cues[0] === raw.meaning;
  // The extraction contract explicitly permits two roles for the same calendar
  // span only when actual employment and wage coverage are both stated together.
  return cues.length === 2 && left.joins + right.joins === 1
    && cues.includes('employment_period') && cues.includes('wage_period')
    && cues.some(meaning => meaning === raw.meaning);
}

function hasSupportedWagePaymentLayout(raw: RawCandidateV3, before: string, after: string): boolean {
  if (raw.kind !== 'date' || raw.meaning !== 'payment_date' || raw.scope !== 'individual') return false;
  const value = dateRole(raw.value), left = dateRole(before), right = dateRole(after);
  const wage = '(?:工资|薪酬|薪资)';
  // An explicit recurring wage schedule identifies its payment date, not an
  // actual receipt or a money payer. The located single owner and full left/
  // right envelopes cannot absorb negation, another person or a partial date.
  if (recurringPaymentDate.test(value)) {
    const payment = '(?:支付|发放|给付|給付|付清|发薪)';
    if (new RegExp(`^(?:的)?${wage}(?:于|在)?$`, 'u').test(left)
      && new RegExp(`^${payment}$`, 'u').test(right)) return true;
    return left === '' && new RegExp(`^${payment}${wage}$`, 'u').test(right);
  }
  const point = new RegExp(`^${calendarDate}$`, 'u');
  const paymentPoint = point.test(value) || monthDayPaymentDate.test(value);
  // The wage belongs to the already located owner. No new person, calendar
  // fragment, negation or procedural command can be absorbed by these layouts.
  if (paymentPoint && new RegExp(`^(?:的)?${wage}(?:于|在)?$`, 'u').test(left)
    && /^(?:实际)?(?:收到|领取|到账|入账)$/u.test(right)) return true;
  // An explicit wage payment date is supported without inferring that payment
  // happened. The date role, located beneficiary and whole verb envelope stay
  // separate from money receipt and complete paid-total authorization.
  if (paymentPoint && new RegExp(`^(?:的)?${wage}(?:于|在)$`, 'u').test(left)
    && /^(?:支付|发放|给付|付清)$/u.test(right)) return true;
  const deadline = new RegExp(`^${calendarDate}(?:以前|之前|前)$`, 'u');
  if (deadline.test(value) && new RegExp(`^(?:的)?${wage}(?:应|须|需|必须)?(?:于|在)$`, 'u').test(left)
    && /^(?:支付|发放|给付|付清)(?:完毕)?$/u.test(right)) return true;
  return point.test(value) && right === ''
    && new RegExp(`^(?:的)?${wage}(?:支付|发放|给付)(?:截止日期|截止时间|截止日|截止)(?:为|是|于|在)?$`, 'u').test(left);
}

/** Runtime-only acceptance envelope. This is intentionally not a general Chinese parser.
 * A literal occurrence is insufficient evidence of ownership. Unsupported layouts keep
 * their original candidate and require human review instead of guessing an association.
 */
export function hasSupportedTotalRelationship(raw: RawCandidateV3, text: string, normalized: CandidateNormalization): boolean {
  if (!raw.subject || !raw.period || !normalized.span) return false;
  // A model may put the entire coordinated/group label into subject while still
  // declaring individual. Preserve it for review; it is not a single worker anchor.
  if (collectiveSubject(raw.subject)) return false;
  const valueStart = text.indexOf(raw.value);
  if (valueStart < 0) return false;
  const chars = Array.from(normalized.rawValue);
  const moneyStart = valueStart + chars.slice(0, normalized.span.start).join('').length;
  const moneyEnd = valueStart + chars.slice(0, normalized.span.end).join('').length;
  const before = text.slice(0, moneyStart), after = text.slice(moneyEnd).trim().normalize('NFKC');
  const subjectStart = before.indexOf(raw.subject), periodStart = before.indexOf(raw.period);
  if (subjectStart < 0 || periodStart < subjectStart + raw.subject.length
    || before.indexOf(raw.subject, subjectStart + 1) >= 0 || before.indexOf(raw.period, periodStart + 1) >= 0) return false;
  const heading = before.slice(0, subjectStart).replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').trim();
  // A prefixed worker name, delegation, payer or second subject cannot establish ownership.
  if (!/^(?:(?:劳动者|员工|工人|原告|被告|申请人|被申请人|第三[0-9一二三四五六七八九十百千万零两]*人)\s*[:：]?\s*)?$/u.test(heading)) return false;
  const bridge = before.slice(subjectStart + raw.subject.length, periodStart).trim();
  if (!/^(?:(?:一人|本人|个人|的|于|自|从|在)|(?:在[\p{L}\p{N}（）()·]{1,60}(?:公司|单位|工厂|工地|项目部|厂|店))|\s)*$/u.test(bridge)) return false;
  const role = moneyRole(before.slice(periodStart + raw.period.length));
  // Matching just a month inside a longer interval, or borrowing another worker/amount,
  // leaves unrecognized text here. Completeness must also be explicit in this same event.
  if (!/(?:完整|全部|总额|总计|合计|共计|累计)/u.test(role)) return false;
  if (raw.meaning === 'due_total' ? !/应付|应发/u.test(role) || /已付|实付|已支付|实发/u.test(role) : !/已付|实付|已支付|实发/u.test(role) || /应付|应发/u.test(role)) return false;
  if (!/^(?:(?:的|期间|本期|工资|薪酬|薪资|金额|款项|人民币|RMB|CNY|[¥￥]|完整|全部|总额|总计|合计|共计|累计|应付|应发|已支付|已付|实付|实发|为|是|计|共|税前|税后|按月支付|按日支付|按周支付)|[:：])*$/iu.test(role)) return false;
  // Do not silently ignore a second event, a missing wage component or a qualification
  // following the number inside this clause. Currency precision is reviewed separately.
  return /^(?:(?:元|圆|整|正|人民币|RMB|CNY)|\s)*$/iu.test(moneyRole(after));
}

/** Every displayed role needs attribution, even when it can never suggest a total.
 * Accept only a single explicit owner/value event; unsupported prose gets a review
 * issue without rewriting its model-provided subject, period, value or role.
 */
export function hasSupportedCandidateAttribution(raw: RawCandidateV3, text: string, normalized: CandidateNormalization): boolean {
  if (!raw.subject) return false;
  if (raw.scope === 'individual' && collectiveSubject(raw.subject)) return false;
  const valueStart = text.indexOf(raw.value);
  if (valueStart < 0) return false;
  const chars = Array.from(normalized.rawValue);
  const start = valueStart + (normalized.span ? chars.slice(0, normalized.span.start).join('').length : 0);
  const end = normalized.span ? valueStart + chars.slice(0, normalized.span.end).join('').length : valueStart + raw.value.length;
  const before = text.slice(0, start), after = text.slice(end).trim().normalize('NFKC');
  const subjectStart = before.indexOf(raw.subject);
  if (subjectStart < 0 || before.indexOf(raw.subject, subjectStart + 1) >= 0) return false;
  const heading = before.slice(0, subjectStart).replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').trim();
  if (!/^(?:(?:劳动者|员工|工人|原告|被告|申请人|被申请人|第三[0-9一二三四五六七八九十百千万零两]*人)\s*[:：]?\s*)?$/u.test(heading)) return false;
  let role = before.slice(subjectStart + raw.subject.length).trim();
  if (raw.period && !(raw.kind === 'date' && raw.period === raw.value)) {
    const periodStart = role.indexOf(raw.period);
    if (periodStart < 0 || role.indexOf(raw.period, periodStart + 1) >= 0) return false;
    const bridge = role.slice(0, periodStart).trim();
    if (!/^(?:(?:一人|本人|个人|的|于|自|从|在)|(?:在[\p{L}\p{N}（）()·]{1,60}(?:公司|单位|工厂|工地|项目部|厂|店))|\s)*$/u.test(raw.kind === 'date' ? dateRole(bridge) : bridge)) return false;
    role = role.slice(periodStart + raw.period.length);
  }
  role = raw.kind === 'date' ? dateRole(role) : moneyRole(role);
  const attributionText = raw.kind === 'date' ? `${role}${dateRole(after)}` : role;
  const receipt = raw.kind === 'date' ? /收到|领取|到账|入账/u.test(attributionText) : /收到|领取/u.test(attributionText);
  const paymentLayout = hasSupportedWagePaymentLayout(raw, role, after);
  // A payment verb establishes a payer, not the wage beneficiary requested by
  // the extraction contract. Preserve the label but warn if receipt is unsupported.
  if ((raw.meaning === 'payment' || raw.meaning === 'payment_date' || raw.scope === 'organization'
    || (raw.kind !== 'date' && /支付|付款|给付/u.test(attributionText))) && !receipt && !paymentLayout) return false;
  if (raw.kind === 'date') {
    // Date-specific cues reject a payer's 支付工资 while allowing the distinct
    // explicit wage-coverage label 工资支付覆盖期间 without claiming receipt.
    return paymentLayout || hasSupportedDateMeaning(raw, role, after);
  }
  // Finite non-total vocabulary cannot absorb another name, date or amount.
  // This validates attribution only; the stricter complete-total gate is separate.
  const suffix = moneyRole(after);
  const supportedSuffix = /^(?:(?:元|圆|整|正|人民币|RMB|CNY)|\s)*(?:(?:[/／]|每)(?:月|日|天|小时|时|件))?$/iu.test(suffix)
    // This branch recognizes an explicitly declared rate in the same event;
    // it does not make that rate a complete total or accept arbitrary 按 prose.
    || (raw.meaning === 'rate' && /^(?:(?:元|圆|整|正|人民币|RMB|CNY)|\s)*按(?:(?:小时|月|日|天|件)(?:计算|计酬|计[价價]|计薪|计)?|时(?:计算|计酬|计[价價]|计薪|计))[）)】\]]*$/iu.test(suffix.replace(/\p{Cf}/gu, '')));
  // Match the finite naked wage-rate labels already recognized by source-rate
  // review. Keep them out of the generic money vocabulary: a calendar period,
  // another owner, non-rate role or mismatching declared/suffix unit is no proof.
  const prefixRate = role.replace(/\p{Cf}/gu, '').replace(/約/gu, '约').replace(/價/gu, '价')
    .match(/^(?:的)?(?:(月|日|时)(?:基本)?工资|(小时)工资|(计件)(?:单价|工资)?)(?:标准|约定|为|是|计|共|合计|基本工资|工资|薪酬|薪资|金额|人民币|[¥￥:=])*$/u);
  if (prefixRate) {
    // A cropped period such as 2026年1 must not leave its 月 to masquerade as
    // 月工资. Rejoin only for detection; a complete period plus its separate
    // 月工资/日工资 label does not form this calendar continuation.
    const periodWithUnit = raw.period && prefixRate[1] ? `${dateRole(raw.period)}${prefixRate[1]}` : null;
    if (periodWithUnit && (completeDate.test(periodWithUnit) || new RegExp(`^${shortDate}$`, 'u').test(periodWithUnit))) return false;
    const units: Record<string, string> = { 月: 'month', 日: 'day', 天: 'day', 小时: 'hour', 时: 'hour', 件: 'piece', 计件: 'piece' };
    const unit = units[prefixRate[1] ?? prefixRate[2] ?? prefixRate[3]];
    const suffixRate = suffix.replace(/\p{Cf}/gu, '')
      .match(/(?:[/／]|每|按)(小时|月|日|天|时|件)(?:计算|计酬|计[价價]|计薪|计)?[）)】\]]*$/u)?.[1];
    return raw.meaning === 'rate' && raw.rateUnit === unit && supportedSuffix
      && (!suffixRate || units[suffixRate] === unit);
  }
  // These explicit non-wage receipts keep their supplied other_money role.
  // Never add their nouns to the generic wage envelope: receiving compensation
  // or materials money does not establish a wage payment or complete total.
  if (raw.meaning === 'other_money' && /^(?:的)?(?:实际)?(?:收到|领取)(?:(?:经|經)(?:济|濟)补偿金|补偿金|赔偿金|[奖獎]金|费用|押金|保[证證]金|[罚罰](?:款|金)|材料款)(?:为|是|计)?(?:人民币|RMB|CNY|[¥￥])?$/iu.test(role)) return supportedSuffix;
  // 应发/实发 are supported only as complete individual wage totals. Reuse
  // the stricter same-owner/period/event gate instead of admitting these new
  // words into arbitrary non-total attribution or inferring actual receipt.
  if (/应发|实发/u.test(role)) return raw.scope === 'individual' && raw.completeness === 'complete'
    && (raw.meaning === 'due_total' || raw.meaning === 'paid_total')
    && hasSupportedTotalRelationship(raw, text, normalized);
  return /^(?:(?:的|期间|本期|工资|薪酬|薪资|金额|款项|应得|补贴|交通补贴|人民币|RMB|CNY|[¥￥]|完整|全部|部分|总额|总计|合计|共计|累计|应付|已支付|已付|实付|支付|付款|收到|领取|拖欠|欠付|尚欠|欠薪|欠款|裁决|判决|判付|裁判|赔偿|补偿|给付|月薪|日薪|时薪|每月|每日|每天|每小时|每件|单价|标准|费率|本次|此次|该笔|单笔|一笔|先付|预付|预支|为|是|计|共|税前|税后|按月支付|按日支付|按周支付)|[:：])*$/iu.test(role)
    && supportedSuffix;
}
