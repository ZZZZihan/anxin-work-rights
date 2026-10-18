import type { CandidateNormalization, RawCandidateV3 } from './material-fact-types-v3';

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
    || /支付|付款|给付/u.test(attributionText)) && !receipt) return false;
  if (raw.kind === 'date') {
    // A date may itself be the declared period. Do not borrow a separate period
    // or silently accept a suffix that extends this date into another interval.
    return /^(?:(?:的|于|自|从|在|为|是|日期|时间|期间|工资|归属|所属|任职|工作|入职|离职|签约|签订|签署|合同|履行|支付|收到|领取)|[:：])*$/u.test(role)
      && /^(?:(?:入职|离职|任职|工作|签约|签订|签署|合同|履行|支付|收到|领取|工资|所属|发生|工伤|日期|时间|期间|开始|结束|起|止)|\s)*$/u.test(after);
  }
  // Finite non-total vocabulary cannot absorb another name, date or amount.
  // This validates attribution only; the stricter complete-total gate is separate.
  return /^(?:(?:的|期间|本期|工资|薪酬|薪资|金额|款项|应得|补贴|交通补贴|人民币|RMB|CNY|[¥￥]|完整|全部|部分|总额|总计|合计|共计|累计|应付|已支付|已付|实付|支付|付款|收到|领取|拖欠|欠付|尚欠|欠薪|欠款|裁决|判决|判付|裁判|赔偿|补偿|给付|月薪|日薪|时薪|每月|每日|每天|每小时|每件|单价|标准|费率|本次|此次|该笔|单笔|一笔|先付|预付|预支|为|是|计|共|税前|税后|按月支付|按日支付|按周支付)|[:：])*$/iu.test(role)
    && /^(?:(?:元|圆|整|正|人民币|RMB|CNY)|\s)*(?:(?:[/／]|每)(?:月|日|天|小时|时|件))?$/iu.test(after);
}
