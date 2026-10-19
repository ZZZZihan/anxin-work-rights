import { describe, expect, it } from 'vitest';
import type { FactSource } from './material-fact-types';
import type { FactCandidateV2 } from './material-fact-types-v2';
import type { DateMeaning, FactCandidateV3, RawCandidateV3 } from './material-fact-types-v3';
import { applyFactAction, emptyFactState, ingestCandidates } from './material-facts-v3';
import { ingestCandidates as ingestV2 } from './material-facts-v2';
import { reviewFactsAgainstSources } from './material-fact-source-review';

const date = (meaning: DateMeaning, value = '2024年7月', quote = value): RawCandidateV3 => ({
  kind: 'date', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual', meaning,
  completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated',
});
const sourceFor = (text: string): FactSource => ({ id: 'source', name: 'synthetic date event fixture', sha256: 'a'.repeat(64), analysisRevision: 1, ready: true,
  blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] });
function review(text: string, candidate = date('employment_period')) {
  const source = sourceFor(text);
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [candidate] });
  const original = ingestCandidates(emptyFactState(1), source, { raw }, 'synthetic', 'owner', '2026-10-18');
  expect(original.materials[0].candidates).toHaveLength(1);
  const snapshot = JSON.stringify(original);
  const reviewed = reviewFactsAgainstSources(original, [source]);
  const item = reviewed.materials[0].candidates[0] as FactCandidateV3;
  expect(JSON.stringify(original)).toBe(snapshot);
  expect(reviewed.materials[0].raw).toBe(raw);
  expect(item.representation).toEqual(candidate);
  expect(item.value).toBe(candidate.value);
  expect(item.quote).toBe(candidate.quote);
  expect(item.amount).toBeNull();
  expect(reviewed.confirmations).toEqual({ due: null, paid: null });
  return item;
}

describe('runtime date meanings bind to their own local event', () => {
  it('warns when a received-wages date is labeled as an employment period', () => {
    const item = review('王甲于2024年7月收到工资。');
    expect(item.reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
  });

  const roles: { meaning: DateMeaning; event: string }[] = [
    { meaning: 'employment_period', event: '入职' },
    { meaning: 'wage_period', event: '工资所属期间' },
    { meaning: 'contract_signing', event: '签订合同' },
    { meaning: 'contract_performance', event: '合同履行期间' },
    { meaning: 'payment_date', event: '收到工资' },
    { meaning: 'other_date', event: '发生工伤' },
  ];
  it.each(roles)('keeps a uniquely anchored matching $meaning even when its quote omits the event', ({ meaning, event }) => {
    expect(review(`王甲于2024年7月${event}。`, date(meaning)).reviewIssues).toEqual([]);
  });
  it.each(roles)('does not accept $meaning without its own event cue', ({ meaning }) => {
    expect(review('王甲于2024年7月日期。', date(meaning)).reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
  });
  it.each(roles)('does not crop the end of a larger date interval for $meaning', ({ meaning, event }) => {
    const item = review(`王甲2024年7月至2024年8月${event}。`, date(meaning));
    expect(item.reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
  });
  it.each(roles)('does not crop a leading date boundary for $meaning', ({ meaning, event }) => {
    expect(review(`王甲自2024年7月${event}。`, date(meaning)).reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
  });

  it.each([
    ['employment_period', '王甲的入职日期为2024年7月。', '2024年7月'],
    ['employment_period', '王甲于2024年7月离职。', '2024年7月'],
    ['employment_period', '王甲终止劳动关系日期为2024年7月。', '2024年7月'],
    ['employment_period', '王甲的劳动合同解除日期为2024年7月。', '2024年7月'],
    ['employment_period', '王甲自2024年7月起任职。', '自2024年7月起'],
    ['employment_period', '王甲自2024年7月至今任职。', '自2024年7月至今'],
    ['employment_period', '王甲于二〇二四年七月开始工作。', '二〇二四年七月'],
    ['employment_period', '👷‍♀️王甲于２０２４年７月入职。', '２０２４年７月'],
    ['wage_period', '王甲的工资归属期间为2024年7月。', '2024年7月'],
    ['wage_period', '王甲的工资支付覆盖期间为2024年7月。', '2024年7月'],
    ['wage_period', '王甲2024年7月工资支付覆盖期间。', '2024年7月'],
    ['wage_period', '王甲的工资所属期间为2024年7月、2024年8月。', '2024年7月、2024年8月'],
    ['wage_period', '王甲2024年7月及8月工资所属期间。', '2024年7月及8月'],
    ['wage_period', '王甲2024年7月1日至10日和15日至20日工资所属期间。', '2024年7月1日至10日和15日至20日'],
    ['wage_period', '王甲的停工留薪期为自2024年7月至9月。', '自2024年7月至9月'],
    ['wage_period', '王甲2024年7月1日至31日工资覆盖期间。', '2024年7月1日至31日'],
    ['contract_signing', '王甲于2024年7月签订劳动合同。', '2024年7月'],
    ['contract_signing', '王甲的劳动合同签署日期为2024-07-01。', '2024-07-01'],
    ['contract_signing', '王甲签约日期为2024/07/01。', '2024/07/01'],
    ['contract_performance', '王甲的劳动合同约定履行期间为自2024年7月至2025年6月。', '自2024年7月至2025年6月'],
    ['contract_performance', '王甲的合同有效期为2024年7月至2025年6月。', '2024年7月至2025年6月'],
    ['contract_performance', '王甲的合同生效日为2024年7月。', '2024年7月'],
    ['payment_date', '王甲领取工资日期为2024年7月。', '2024年7月'],
    ['payment_date', '王甲于2024年7月实际收到工资。', '2024年7月'],
    ['payment_date', '王甲的领取工资截止日期为2024年7月。', '2024年7月'],
    ['other_date', '王甲的工伤发生日期为2024年7月。', '2024年7月'],
    ['other_date', '王甲的调薪生效日为2024年7月。', '2024年7月'],
    ['other_date', '王甲的工资调整生效日期为2024年7月。', '2024年7月'],
  ] as const)('keeps explicit %s event: %s', (meaning, text, value) => {
    expect(review(text, date(meaning, value)).reviewIssues).toEqual([]);
  });

  it.each(['employment_period', 'wage_period'] as const)('keeps %s when the same date explicitly covers both employment and wages', meaning => {
    const item = review('王甲的任职期间和工资所属期间为2024年7月。', date(meaning));
    expect(item.reviewIssues).toEqual([]);
  });

  it.each(['起', '前', '后', '以前', '以后', '起至2025年8月'])('does not crop the boundary %s off the date value', boundary => {
    expect(review(`王甲2024年7月${boundary}任职。`).reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
  });
  it.each([
    ['王甲于12024年7月入职。', '2024年7月'],
    ['王甲于2024年7月31日入职。', '2024年7月'],
    ['王甲于2024年7月入职。', '2024年'],
    ['王甲于2024年7月入职。', '24年7月'],
    ['王甲于２０２４年７月３１日入职。', '２０２４年７月'],
  ])('does not bind a cropped calendar token from %s', (text, value) => {
    expect(review(text, date('employment_period', value)).reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
  });

  it.each([
    ['employment_period', '收到工资并入职'],
    ['payment_date', '收到工资并入职'],
    ['contract_signing', '签订合同及合同履行期间'],
    ['contract_performance', '签订合同及合同履行期间'],
    ['other_date', '发生工伤和领取工资'],
    ['payment_date', '发生工伤和领取工资'],
    ['employment_period', '入职和离职'],
    ['employment_period', '任职工资所属期间'],
    ['wage_period', '任职工资所属期间'],
    ['employment_period', '入职和'],
  ] as const)('does not guess %s attribution from mixed local events: %s', (meaning, event) => {
    expect(review(`王甲于2024年7月${event}。`, date(meaning)).reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
  });
  it.each([
    ['employment_period', '未入职'], ['employment_period', '计划入职'],
    ['contract_signing', '尚未签订合同'], ['contract_signing', '拟签订合同'],
    ['contract_performance', '合同尚未履行'], ['payment_date', '没有收到工资'],
    ['other_date', '并未发生工伤'], ['wage_period', '工资所属期间不明'],
  ] as const)('keeps unsupported negated or hypothetical %s for review: %s', (meaning, event) => {
    expect(review(`王甲于2024年7月${event}。`, date(meaning)).reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
  });
  it('does not let other_date evade an explicit receipt event', () => {
    expect(review('王甲于2024年7月收到工资。', date('other_date')).reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
  });
  it('does not crop a parallel wage-period list to the first month', () => {
    expect(review('王甲2024年7月、2024年8月工资所属期间。', date('wage_period')).reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
  });
  it.each(roles.filter(role => role.meaning !== 'wage_period'))('does not relabel parallel wage periods as $meaning', ({ meaning }) => {
    const value = '2024年7月及8月';
    expect(review(`王甲${value}工资所属期间。`, date(meaning, value)).reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
  });
  it('does not hide a competing event inside the model date value', () => {
    const value = '2024年7月收到工资';
    expect(review(`王甲于${value}。`, date('employment_period', value)).reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
  });
  it('does not use an earlier event label to relabel a later receipt date', () => {
    expect(review('王甲任职日期不明但于2024年7月收到工资。').reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
  });
  it('does not borrow a different calendar date from another event in the same clause', () => {
    expect(review('王甲于2024年7月签订合同并于2024年8月入职。', date('employment_period')).reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
  });

  it('reviews a stored v2 date role without upgrading its schema, raw output, or representation', () => {
    const source = sourceFor('王甲于2024年7月收到工资。'), candidate = date('employment_period');
    const raw = JSON.stringify({ schemaVersion: 2, candidates: [candidate] });
    const original = ingestV2(emptyFactState(1), source, { raw }, 'historical-synthetic', 'owner', '2026-10-18');
    const snapshot = structuredClone(original);
    expect(original.materials[0].candidates).toHaveLength(1);
    const reviewed = reviewFactsAgainstSources(original, [source]);
    const item = reviewed.materials[0].candidates[0] as FactCandidateV2;
    expect(item.reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
    expect(item.schemaVersion).toBe(2);
    expect(item.representation).toEqual(candidate);
    expect(reviewed.materials[0].raw).toBe(raw);
    expect(reviewed.materials[0].rejected).toEqual(snapshot.materials[0].rejected);
    expect(original).toEqual(snapshot);
  });

  it('preserves actual user confirmations and their audit when a date role needs additional review', () => {
    const source = sourceFor('王甲于2024年7月收到工资。'), candidate = date('employment_period');
    const raw = JSON.stringify({ schemaVersion: 3, candidates: [candidate] });
    let state = ingestCandidates(emptyFactState(1), source, { raw }, 'synthetic', 'owner', '2026-10-18');
    state = applyFactAction(state, { action: 'confirm_scope', scope: { worker: '王甲', employer: '甲公司', start: '2024-07-01', end: '2024-07-31' },
      note: '合成测试：本人核对主体和工资期间。', verified: true }, [source], 'owner', '2026-10-18');
    for (const [field, amount] of [['due', '1000'], ['paid', '0']] as const) {
      state = applyFactAction(state, { action: 'confirm_amount', field, amount, note: '合成测试：本人核对完整金额，明确已付零元。', reviewedCandidateIds: [], complete: true, verified: true }, [source], 'owner', '2026-10-18');
    }
    const snapshot = structuredClone(state);
    const reviewed = reviewFactsAgainstSources(state, [source]);
    expect((reviewed.materials[0].candidates[0] as FactCandidateV3).reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
    expect(reviewed.scope).toEqual(snapshot.scope);
    expect(reviewed.scopeReview).toEqual(snapshot.scopeReview);
    expect(reviewed.confirmations).toEqual(snapshot.confirmations);
    expect(reviewed.confirmations.paid?.amount).toBe('0.00');
    expect(reviewed.history).toEqual(snapshot.history);
    expect(reviewed.materials[0].raw).toBe(raw);
    expect(state).toEqual(snapshot);
  });
});
