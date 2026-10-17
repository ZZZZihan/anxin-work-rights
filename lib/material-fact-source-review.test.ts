import { describe, expect, it } from 'vitest';
import type { FactSource, FactState } from './material-fact-types';
import type { FactCandidateV3, RawCandidateV3 } from './material-fact-types-v3';
import { applyFactAction, buildFactView, emptyFactState, ingestCandidates, prepareCalculation, validateCandidateOutput } from './material-facts-v3';
import { reviewCandidateAgainstSource, reviewFactsAgainstSources } from './material-fact-source-review';
import { ingestCandidates as ingestV2, validateCandidateOutput as validateV2 } from './material-facts-v2';

const ACTOR = 'synthetic-owner', AT = '2026-10-17T12:00:00.000Z';
const source = (text: string): FactSource => ({ id: 'source', name: '合成源文绑定反例', sha256: 'a'.repeat(64), analysisRevision: 1, ready: true, blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] });
const entry = (overrides: Partial<RawCandidateV3> = {}): RawCandidateV3 => ({ kind: 'money', value: '80000元', quote: '完整应付工资80000元', blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'due_total', completeness: 'complete', period: '2024年7月', rateUnit: null, assertion: 'narrated', ...overrides });
function stateFor(material: FactSource, candidate = entry()) {
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [candidate] });
  let state = ingestCandidates(emptyFactState(1), material, { raw }, 'synthetic', ACTOR, AT);
  state = applyFactAction(state, { action: 'confirm_scope', scope: { worker: '王甲', employer: '甲公司', start: '2024-07-01', end: '2024-07-31' }, note: '本人核对主体和期间', verified: true }, [material], ACTOR, AT);
  return state;
}
const item = (state: FactState) => state.materials[0].candidates[0] as FactCandidateV3;

describe('post-freeze runtime source binding, separate from model evaluation', () => {
  it('reproduces cropped quote group bypass and blocks its personal total hint', () => {
    const material = source('王甲班组10人在甲公司2024年7月完整应付工资80000元。');
    const original = stateFor(material), snapshot = JSON.stringify(original);
    expect(item(original).reviewIssues).toEqual([]);
    expect(buildFactView(original, [material]).fields.due.values).toEqual(['80000.00']);
    const reviewed = reviewFactsAgainstSources(original, [material]);
    expect(item(reviewed).reviewIssues.map(issue => issue.code)).toContain('scope_text_mismatch');
    expect(buildFactView(reviewed, [material]).fields.due.values).toEqual([]);
    expect(item(reviewed).amount).toBe('80000.00');
    expect(item(reviewed).quote).toBe('完整应付工资80000元');
    expect(JSON.stringify(original)).toBe(snapshot);
  });
  it.each(['三人', '十一名工人', '班组10人'])('detects the source-local %s omitted from quote', group => {
    const material = source(`王甲等${group}在甲公司2024年7月完整应付工资80000元。`);
    const reviewed = reviewFactsAgainstSources(stateFor(material), [material]);
    expect(item(reviewed).reviewIssues.map(issue => issue.code)).toContain('scope_text_mismatch');
  });
  it.each(['第三人王甲', '第三十一人王甲', '王甲一人'])('keeps %s as an individual source counterexample', subject => {
    const material = source(`${subject}在甲公司2024年7月完整应付工资80000元。`);
    const reviewed = reviewFactsAgainstSources(stateFor(material), [material]);
    expect(item(reviewed).reviewIssues).toEqual([]);
    expect(buildFactView(reviewed, [material]).fields.due.values).toEqual(['80000.00']);
  });
  it.each(['。', '；', '，', '\n'])('does not import another event across %s', separator => {
    const material = source(`另一班组十一名工人另案处理${separator}王甲在甲公司2024年7月完整应付工资80000元。`);
    const reviewed = reviewFactsAgainstSources(stateFor(material), [material]);
    expect(item(reviewed).reviewIssues).toEqual([]);
    expect(buildFactView(reviewed, [material]).fields.due.values).toEqual(['80000.00']);
  });
  it.each([
    ['工资约80000元', 'approximate'], ['工资至少80000元', 'approximate'], ['工资不低于80000元', 'approximate'],
    ['工资80000元左右', 'approximate'], ['工资负80000元', 'unsupported'], ['工资- 80000元', 'unsupported'],
    ['工资80000元至90000元', 'range'], ['工资可能80000元', 'uncertain'],
  ])('downgrades precision from source even if quote crops the modifier: %s', (text, status) => {
    const material = source(`王甲在甲公司2024年7月${text}。`), original = stateFor(material, entry({ quote: '80000元' }));
    expect(item(original).normalization.status).toBe('exact');
    const reviewed = reviewFactsAgainstSources(original, [material]);
    expect(item(reviewed).amount).toBeNull();
    expect(item(reviewed).normalization.status).toBe(status);
    expect(item(reviewed).reviewIssues.map(issue => issue.code)).toContain('source_amount_context_mismatch');
    expect(item(reviewed).representation).toEqual(item(original).representation);
    expect(item(reviewed).value).toBe('80000元');
    expect(item(reviewed).quote).toBe('80000元');
    expect(buildFactView(reviewed, [material]).fields.due.values).toEqual([]);
  });
  it('does not let another amount approximation contaminate the anchored exact value', () => {
    const material = source('另一工人工资约90000元，王甲在甲公司2024年7月完整应付工资80000元。');
    const reviewed = reviewFactsAgainstSources(stateFor(material, entry({ quote: '80000元' })), [material]);
    expect(item(reviewed).amount).toBe('80000.00');
    expect(item(reviewed).normalization.status).toBe('exact');
    expect(item(reviewed).reviewIssues).toEqual([]);
  });
  it('refuses a repeated cropped quote even if the extractor stored the first occurrence', () => {
    const material = source('王甲在甲公司2024年7月工资约80000元。王甲完整应付工资80000元。');
    const reviewed = reviewFactsAgainstSources(stateFor(material, entry({ quote: '80000元' })), [material]);
    expect(item(reviewed).amount).toBeNull();
    expect(item(reviewed).normalization.status).toBe('uncertain');
    expect(item(reviewed).reviewIssues.map(issue => issue.code)).toContain('local_context_ambiguous');
    expect(buildFactView(reviewed, [material]).fields.due.values).toEqual([]);
  });
  it('uses a unique longer quote to bind the exact occurrence among repeated amounts', () => {
    const material = source('王甲在甲公司2024年7月工资约80000元。王甲完整应付工资80000元。');
    const reviewed = reviewFactsAgainstSources(stateFor(material, entry()), [material]);
    expect(item(reviewed).amount).toBe('80000.00');
    expect(item(reviewed).reviewIssues).toEqual([]);
  });
  it.each([
    ['18000元', '8000元'], ['80000元', '0000元'], ['08000元', '8000元'],
    ['0.01元', '01元'], ['0.10元', '0元'], ['0.01元', '0.0'],
    ['18,000元', '000元'], ['18，000元', '000元'],
    ['壹万捌仟元', '捌仟元'], ['拾壹元', '壹元'], ['一万8000元', '8000元'],
    ['8000元5角', '8000元'], ['壹仟元零伍分', '壹仟元'], ['8000元伍角', '8000元'],
    ['8000万元', '8000'], ['8000元5角', '8000'],
  ])('refuses an internal monetary token crop: source %s, value %s', (literal, value) => {
    const material = source(`2024年7月记录。王甲完整应付工资${literal}。`);
    const original = stateFor(material, entry({ value, quote: value }));
    expect(item(original).amount).not.toBeNull();
    const reviewed = reviewFactsAgainstSources(original, [material]);
    expect(item(reviewed).amount).toBeNull();
    expect(item(reviewed).normalization.status).toBe('unsupported');
    expect(item(reviewed).reviewIssues.map(issue => issue.code)).toContain('source_amount_context_mismatch');
    expect(item(reviewed).representation).toEqual(item(original).representation);
    expect(buildFactView(reviewed, [material]).fields.due.values).toEqual([]);
  });
  it.each([
    ['共8000元', '8000元'], ['人民币8000元', '8000元'], ['￥8000元', '8000元'],
    ['2024年7月8000元', '8000元'], ['8000元', '8000'], ['8000圆', '8000'],
    ['0元', '0元'], ['0.01元', '0.01元'], ['壹万捌仟元整', '壹万捌仟元整'],
    ['记录，8000元', '8000元'],
  ])('keeps complete numeric meanings and ordinary prefixes: %s', (text, value) => {
    const material = source(`2024年7月记录。王甲完整应付工资${text}。`);
    const reviewed = reviewFactsAgainstSources(stateFor(material, entry({ value, quote: value })), [material]);
    expect(item(reviewed).amount).not.toBeNull();
    expect(item(reviewed).normalization.status).toBe('exact');
    expect(item(reviewed).reviewIssues).toEqual([]);
  });
  it.each(['本次', '此次', '该笔', '部分', '先付', '预付'])('restores source-local %s payment coverage warnings cropped from quote', cue => {
    const material = source(`王甲2024年7月${cue}支付80000元。`);
    const original = stateFor(material, entry({ meaning: 'paid_total', quote: '80000元' }));
    expect(item(original).reviewIssues).toEqual([]);
    const reviewed = reviewFactsAgainstSources(original, [material]);
    expect(item(reviewed).reviewIssues.map(issue => issue.code)).toContain('partial_paid_total');
    expect(buildFactView(reviewed, [material]).fields.paid.values).toEqual([]);
    expect(item(reviewed).amount).toBe('80000.00');
  });
  it('keeps another event partial-payment cue outside the anchored paid total', () => {
    const material = source('另一工人本次支付90000元，王甲2024年7月完整已付工资80000元。');
    const reviewed = reviewFactsAgainstSources(stateFor(material, entry({ meaning: 'paid_total', quote: '完整已付工资80000元' })), [material]);
    expect(item(reviewed).reviewIssues).toEqual([]);
    expect(buildFactView(reviewed, [material]).fields.paid.values).toEqual(['80000.00']);
  });
  it.each(['80000元/月', '80000元每月', '80000元/天', '每月80000元', '每小时80000元', '月薪80000元', '日薪80000元', '月工资80000元', '日工资80000元'])('refuses a source rate unit omitted by a total quote: %s', text => {
    const material = source(`王甲2024年7月${text}。`);
    const reviewed = reviewFactsAgainstSources(stateFor(material, entry({ quote: '80000元' })), [material]);
    expect(item(reviewed).amount).toBeNull();
    expect(item(reviewed).normalization.status).toBe('rate_unit_mismatch');
    expect(item(reviewed).reviewIssues.map(issue => issue.code)).toContain('rate_unit_mismatch');
  });
  it('checks declared rate units while retaining a matching rate and payment-frequency narrative', () => {
    const material = source('王甲2024年7月每小时80000元。');
    const raw = entry({ quote: '80000元', meaning: 'rate', completeness: 'not_applicable', rateUnit: 'month' });
    const mismatch = reviewFactsAgainstSources(stateFor(material, raw), [material]);
    expect(item(mismatch).amount).toBeNull();
    expect(item(mismatch).normalization.status).toBe('rate_unit_mismatch');
    const matching = reviewFactsAgainstSources(stateFor(material, { ...raw, rateUnit: 'hour' }), [material]);
    expect(item(matching).amount).toBe('80000.00');
    expect(item(matching).reviewIssues).toEqual([]);
    for (const phrase of ['按月支付本期累计应付', '按月支付本期完整应付']) {
      const frequency = source(`王甲2024年7月${phrase}80000元。`);
      const total = reviewFactsAgainstSources(stateFor(frequency, entry({ quote: '80000元' })), [frequency]);
      expect(item(total).amount).toBe('80000.00');
      expect(item(total).reviewIssues).toEqual([]);
    }
  });
  it('does not join numeric or rate token edges across a source newline', () => {
    for (const text of ['工资记录1\n80000元', '工资记录每小时\n80000元', '完整应付80000元\n每月']) {
      const material = source(`王甲2024年7月${text}。`);
      const reviewed = reviewFactsAgainstSources(stateFor(material, entry({ quote: '80000元' })), [material]);
      expect(item(reviewed).amount).toBe('80000.00');
      expect(item(reviewed).reviewIssues).toEqual([]);
    }
  });
  it('verifies Unicode positions and refuses a forged or mismatched source binding', () => {
    const material = source('😀𠮷王甲在甲公司2024年7月完整应付工资80000元。'), original = item(stateFor(material));
    expect((reviewCandidateAgainstSource(original, material) as FactCandidateV3).reviewIssues).toEqual([]);
    for (const candidate of [{ ...original, start: original.start + 1 }, { ...original, sourceSha256: 'b'.repeat(64) }, { ...original, blockId: 'missing' }]) {
      const reviewed = reviewCandidateAgainstSource(candidate, material) as FactCandidateV3;
      expect(reviewed.amount).toBeNull();
      expect(reviewed.reviewIssues.map(issue => issue.code)).toContain('source_evidence_unresolved');
    }
  });
  it('is idempotent and preserves explicit human amounts and calculation authorization', () => {
    const material = source('王甲班组10人在甲公司2024年7月完整应付工资80000元。');
    let state = stateFor(material);
    for (const [field, amount] of [['due', '8000'], ['paid', '0']] as const) state = applyFactAction(state, { action: 'confirm_amount', field, amount, note: '独立核实本人工资并已处理全部候选差异', reviewedCandidateIds: [item(state).id], complete: true, verified: true }, [material], ACTOR, AT);
    const reviewed = reviewFactsAgainstSources(state, [material]);
    expect(reviewFactsAgainstSources(reviewed, [material])).toEqual(reviewed);
    expect(reviewed.confirmations).toEqual(state.confirmations);
    expect(prepareCalculation(reviewed, [material])).toEqual({ dueCents: 800000, paidCents: 0, generation: 1 });
    expect(reviewed.materials[0].raw).toBe(state.materials[0].raw);
  });
  it('never upgrades an unavailable amount, skips exclusions and blocks stale or missing source evidence', () => {
    const material = source('王甲在甲公司2024年7月完整应付工资80000元。'), original = stateFor(material);
    item(original).amount = null;
    expect(item(reviewFactsAgainstSources(original, [material])).amount).toBeNull();
    const excluded = structuredClone(original); excluded.materials[0].status = 'excluded';
    expect(reviewFactsAgainstSources(excluded, [material])).toEqual(excluded);
    const newer = { ...material, analysisRevision: 2 };
    for (const sources of [[newer], [], [{ ...material, ready: false }]]) {
      const reviewed = reviewFactsAgainstSources(stateFor(material), sources);
      expect(item(reviewed).amount).toBeNull();
      expect(item(reviewed).reviewIssues.map(issue => issue.code)).toContain('source_evidence_unresolved');
    }
  });
  it('applies source constraints to historical v2 without changing its schema or upgrading amount', () => {
    const material = source('王甲班组10人在甲公司2024年7月工资约80000元。'), candidate = entry({ quote: '80000元' });
    const raw = JSON.stringify({ schemaVersion: 2, candidates: [candidate] });
    const original = ingestV2(emptyFactState(1), material, validateV2(raw, material), 'v2', ACTOR, AT);
    const reviewed = reviewFactsAgainstSources(original, [material]), checked = reviewed.materials[0].candidates[0] as FactCandidateV3;
    expect(checked.amount).toBeNull();
    expect(checked.schemaVersion).toBe(2);
    expect(checked.reviewIssues.map(issue => issue.code)).toEqual(expect.arrayContaining(['scope_text_mismatch', 'source_amount_context_mismatch']));
    expect(Object.hasOwn(checked, 'normalization')).toBe(false);
    expect(checked.representation).toEqual(candidate);
    expect(reviewed.materials[0].raw).toBe(raw);
    expect(original.materials[0].candidates[0].amount).toBe('80000.00');
  });
  it('checks a cropped date against its source event without importing the next signing event', () => {
    const material = source('王甲2024年7月入职。2024年8月签订合同。');
    const date = (value: string): RawCandidateV3 => entry({ kind: 'date', value, quote: value, meaning: 'employment_period', period: null, completeness: 'not_applicable' });
    const batch = validateCandidateOutput(JSON.stringify({ schemaVersion: 3, candidates: [date('2024年7月'), date('2024年8月')] }), material);
    const first = reviewCandidateAgainstSource(batch.candidates[0], material) as FactCandidateV3, second = reviewCandidateAgainstSource(batch.candidates[1], material) as FactCandidateV3;
    expect(first.reviewIssues).toEqual([]);
    expect(second.reviewIssues.map(issue => issue.code)).toContain('contract_signing_as_employment');
    expect(second.representation.meaning).toBe('employment_period');
  });
  it('keeps frozen extraction output untouched when source runtime review is added', () => {
    const material = source('王甲班组10人在甲公司2024年7月完整应付工资80000元。');
    const raw = JSON.stringify({ schemaVersion: 3, candidates: [entry()] });
    const batch = validateCandidateOutput(raw, material), snapshot = JSON.stringify(batch);
    reviewCandidateAgainstSource(batch.candidates[0], material);
    expect(JSON.stringify(batch)).toBe(snapshot);
    expect(batch.candidates[0].reviewIssues).toEqual([]);
  });
});
