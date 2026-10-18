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
const intervalEnd = `(?:${calendarDate}|${shortDate}|今)`;
const dateInterval = (start: string) => `(?:自|从|截至|截止至|截止到|截止|到|至)?${start}(?:(?:起)?(?:至|到|—|–|-|~|～)${intervalEnd})?(?:以前|以后|之前|之后|为止|起|止|前|后)?`;
const completeDate = new RegExp(`^${dateInterval(calendarDate)}$`, 'u');
// The protocol permits parallel wage periods as one continuous source literal;
// retain the complete list instead of accepting a cropped first month/range.
const completeWageDates = new RegExp(`^${dateInterval(calendarDate)}(?:[、及和]${dateInterval(`(?:${calendarDate}|${shortDate})`)})+$`, 'u');
const compact = (text: string) => text.normalize('NFKC').replace(/\s+/gu, '');

function dateSide(text: string): { meanings: DateMeaning[]; joins: number } | null {
  let remaining = compact(text), needsCue = false, joins = 0;
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
  const value = compact(raw.value);
  if (!completeDate.test(value) && !(raw.meaning === 'wage_period' && completeWageDates.test(value))) return false;
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

/** Runtime-only acceptance envelope. This is intentionally not a general Chinese parser.
 * A literal occurrence is insufficient evidence of ownership. Unsupported layouts keep
 * their original candidate and require human review instead of guessing an association.
 */
export function hasSupportedTotalRelationship(raw: RawCandidateV3, text: string, normalized: CandidateNormalization): boolean {
  if (!raw.subject || !raw.period || !normalized.span) return false;
  // A model may put the entire coordinated/group label into subject while still
  // declaring individual. Preserve it for review; it is not a single worker anchor.
  if (/[、和与及等]|班组|公司|单位|集团|工人|员工|劳动者|群体|集体|众人/u.test(raw.subject)) return false;
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
  const role = before.slice(periodStart + raw.period.length).normalize('NFKC').replace(/\s+/gu, '');
  // Matching just a month inside a longer interval, or borrowing another worker/amount,
  // leaves unrecognized text here. Completeness must also be explicit in this same event.
  if (!/(?:完整|全部|总额|总计|合计|共计|累计)/u.test(role)) return false;
  if (raw.meaning === 'due_total' ? !/应付/u.test(role) || /已付|实付|已支付/u.test(role) : !/已付|实付|已支付/u.test(role) || /应付/u.test(role)) return false;
  if (!/^(?:(?:的|期间|本期|工资|薪酬|薪资|金额|款项|人民币|RMB|CNY|[¥￥]|完整|全部|总额|总计|合计|共计|累计|应付|已支付|已付|实付|为|是|计|共|税前|税后|按月支付|按日支付|按周支付)|[:：])*$/iu.test(role)) return false;
  // Do not silently ignore a second event, a missing wage component or a qualification
  // following the number inside this clause. Currency precision is reviewed separately.
  return /^(?:(?:元|圆|整|正|人民币|RMB|CNY)|\s)*$/iu.test(after);
}

/** Every displayed role needs attribution, even when it can never suggest a total.
 * Accept only a single explicit owner/value event; unsupported prose gets a review
 * issue without rewriting its model-provided subject, period, value or role.
 */
export function hasSupportedCandidateAttribution(raw: RawCandidateV3, text: string, normalized: CandidateNormalization): boolean {
  if (!raw.subject) return false;
  if (raw.scope === 'individual' && /[、和与及等]|班组|公司|单位|集团|工人|员工|劳动者|群体|集体|众人/u.test(raw.subject)) return false;
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
    if (!/^(?:(?:一人|本人|个人|的|于|自|从|在)|(?:在[\p{L}\p{N}（）()·]{1,60}(?:公司|单位|工厂|工地|项目部|厂|店))|\s)*$/u.test(bridge)) return false;
    role = role.slice(periodStart + raw.period.length);
  }
  role = role.normalize('NFKC').replace(/\s+/gu, '');
  const attributionText = raw.kind === 'date' ? `${role}${after}` : role;
  const receipt = /收到|领取/u.test(attributionText);
  // A payment verb establishes a payer, not the wage beneficiary requested by
  // the extraction contract. Preserve the label but warn if receipt is unsupported.
  if ((raw.meaning === 'payment' || raw.meaning === 'payment_date' || raw.scope === 'organization'
    || (raw.kind !== 'date' && /支付|付款|给付/u.test(attributionText))) && !receipt) return false;
  if (raw.kind === 'date') {
    // Date-specific cues reject a payer's 支付工资 while allowing the distinct
    // explicit wage-coverage label 工资支付覆盖期间 without claiming receipt.
    return hasSupportedDateMeaning(raw, role, after);
  }
  // Finite non-total vocabulary cannot absorb another name, date or amount.
  // This validates attribution only; the stricter complete-total gate is separate.
  return /^(?:(?:的|期间|本期|工资|薪酬|薪资|金额|款项|应得|补贴|交通补贴|人民币|RMB|CNY|[¥￥]|完整|全部|部分|总额|总计|合计|共计|累计|应付|已支付|已付|实付|支付|付款|收到|领取|拖欠|欠付|尚欠|欠薪|欠款|裁决|判决|判付|裁判|赔偿|补偿|给付|月薪|日薪|时薪|每月|每日|每天|每小时|每件|单价|标准|费率|本次|此次|该笔|单笔|一笔|先付|预付|预支|为|是|计|共|税前|税后|按月支付|按日支付|按周支付)|[:：])*$/iu.test(role)
    && /^(?:(?:元|圆|整|正|人民币|RMB|CNY)|\s)*(?:(?:[/／]|每)(?:月|日|天|小时|时|件))?$/iu.test(after);
}
