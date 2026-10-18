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
