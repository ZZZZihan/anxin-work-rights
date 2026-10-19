import { describe, expect, it } from 'vitest';
import {
  applyFactAction, buildFactView, emptyFactState, formatCents, ingestCandidates,
  parseAmount, prepareCalculation, synchronizeFacts, validateCandidateOutput, validateFactSource,
} from './material-facts';
import type { CandidateBatch, FactAction, FactSource, FactState, RawCandidate } from './material-fact-types';
// @ts-expect-error The independent evaluator is a native JavaScript module without declarations.
import { assess, assessCase, matchCandidates } from '../experiments/material-facts-v4/assess.mjs';

// Independently authored controlled regressions. No v4 authoring/gold/model output is read.
const ACTOR = 'independent-review-user';
const AT = '2026-10-17T08:00:00.000Z';
const source = (id = 'review-material', text = '劳动者王甲；用人单位甲公司；2026-01-01至2026-01-31完整应付工资6000.10元，完整已付工资2000.05元。'): FactSource => ({
  id, name: `${id}.txt`, sha256: 'a'.repeat(64), analysisRevision: 1, ready: true,
  blocks: [{ id: 'block-1', page: 1, text, bbox: null, confidence: null }],
});

describe('independent material fact-chain review: evaluator accounting', () => {
  it('keeps every planned document and all missing facts in the denominator', () => {
    const material = source(); const candidate = rawCandidate();
    const input = { id: 'one', source: material }, second = { id: 'two', source: material };
    const labels = [{ id: 'one', expected: [candidate] }, { id: 'two', expected: [candidate] }];
    const report = assess([input, second], labels, [{ id: 'one', raw_output: JSON.stringify({ candidates: [candidate] }), finish_reason: 'stop' }]);
    expect(report.planned_documents).toBe(2);
    expect(report.metrics.accepted_strict).toMatchObject({ tp: 1, fp: 0, fn: 1, recall: 0.5 });
    expect(report.cases[1].errors).toContain('missing_request');
  });
  it('matches duplicated candidates to each expected fact at most once', () => {
    const candidate = rawCandidate();
    const result = matchCandidates([candidate, candidate, candidate], { expected: [candidate] }, (a: RawCandidate, b: RawCandidate) => a.kind === b.kind && a.value === b.value);
    expect(result).toMatchObject({ tp: 1, fp: 2, fn: 0 });
  });
  it('does not accept parseable incomplete output as semantic success', () => {
    const candidate = rawCandidate();
    const result = assessCase({ id: 'one', source: source() }, { expected: [candidate] }, { raw_output: JSON.stringify({ candidates: [candidate] }), finish_reason: 'length' });
    expect(result.protocol).toBe(true);
    expect(result.completed).toBe(false);
    expect(result.accepted_strict).toMatchObject({ tp: 0, fp: 0, fn: 1 });
    expect(result.exact_document).toBe(false);
  });
  it('requires every strict attribute and a valid literal source reference', () => {
    const candidate = rawCandidate(); const input = { id: 'one', source: source() }, label = { expected: [candidate] };
    for (const altered of [rawCandidate({ subject: null }), rawCandidate({ period: null }), rawCandidate({ qualifier: 'net' }), rawCandidate({ assertion: 'claimed' }), rawCandidate({ quote: 'invented quote' })]) {
      const result = assessCase(input, label, { raw_output: JSON.stringify({ candidates: [altered] }), finish_reason: 'stop' });
      expect(result.accepted_strict.tp).toBe(0);
      expect(result.exact_document).toBe(false);
    }
  });
  it('counts malformed emitted entries as raw-output false positives', () => {
    const candidate = rawCandidate();
    const result = assessCase({ id: 'one', source: source() }, { expected: [candidate] }, { raw_output: JSON.stringify({ candidates: [candidate, null, { kind: 'due_total' }] }), finish_reason: 'stop' });
    expect(result.raw_count).toBe(3);
    expect(result.raw_basic).toMatchObject({ tp: 1, fp: 2, fn: 0 });
  });
  it('does not invent attribute errors when a full strict matching exists', () => {
    const gross = rawCandidate({ qualifier: 'gross' }), net = rawCandidate({ qualifier: 'net' });
    const result = assessCase({ id: 'one', source: source() }, { expected: [gross, net] }, { raw_output: JSON.stringify({ candidates: [gross, net] }), finish_reason: 'stop' });
    expect(result.accepted_strict).toMatchObject({ tp: 2, fp: 0, fn: 0 });
    expect(result.attribute_errors).toEqual([]);
  });
});
const rawCandidate = (overrides: Partial<RawCandidate> = {}): RawCandidate => ({
  kind: 'due_total', value: '6000.10元', quote: '完整应付工资6000.10元', blockId: 'block-1',
  subject: '王甲', period: '2026-01-01至2026-01-31', qualifier: 'gross', assertion: 'narrated', ...overrides,
});
const batch = (material: FactSource, entries: unknown[] = [rawCandidate()]) => validateCandidateOutput(JSON.stringify({ candidates: entries }), material);
const extracted = (material = source()) => ingestCandidates(emptyFactState(1), material, batch(material), 'controlled-review', ACTOR, AT);
const scopeAction = (overrides: Partial<{ worker: string; employer: string; start: string; end: string }> = {}): FactAction => ({
  action: 'confirm_scope', scope: { worker: '王甲', employer: '甲公司', start: '2026-01-01', end: '2026-01-31', ...overrides },
  note: '已核实劳动者、用人单位和该工资期间。', verified: true,
});
function scopeConfirmed(material = source()) { return applyFactAction(extracted(material), scopeAction(), [material], ACTOR, AT); }
function confirm(state: FactState, material: FactSource, field: 'due' | 'paid', amount: string): FactState {
  const reviewedCandidateIds = buildFactView(state, [material]).candidates.filter(c => !['worker', 'employer', 'period'].includes(c.kind)).map(c => c.id);
  return applyFactAction(state, { action: 'confirm_amount', field, amount, note: '已核实本主体本期间完整工资总额，处理了所列候选差异。', reviewedCandidateIds, complete: true, verified: true }, [material], ACTOR, AT);
}
function fullyConfirmed(material = source(), due = '6000.10', paid = '2000.05') {
  let state = scopeConfirmed(material);
  state = confirm(state, material, 'due', due);
  return confirm(state, material, 'paid', paid);
}

describe('independent material fact-chain review: strict source and candidate boundary', () => {
  it('does not interpret missing, unknown, negative, range or non-string amounts as zero', () => {
    for (const value of [undefined, null, true, false, 0, [], {}, '', ' ', '未知', 'X元', '6000-7000元', '-1', '+1', '1e3', 'NaN', 'Infinity']) expect(parseAmount(value)).toBeNull();
  });
  it('normalizes explicit decimal and unit amounts exactly without rounding', () => {
    expect(parseAmount('0')).toEqual({ cents: 0, amount: '0.00' });
    expect(parseAmount('人民币￥6,000.10元')).toEqual({ cents: 600010, amount: '6000.10' });
    expect(parseAmount('0.000001万元')).toEqual({ cents: 1, amount: '0.01' });
    expect(parseAmount('0.001元')).toBeNull();
    expect(parseAmount('999999999999.99')).toEqual({ cents: 99999999999999, amount: '999999999999.99' });
    expect(parseAmount('1000000000000')).toBeNull();
    expect(formatCents(-123)).toBe('-1.23');
  });
  it('rejects excessive source text and duplicate block ids without truncating', () => {
    const over = source('over', '字'.repeat(24001));
    expect(() => validateFactSource(over)).toThrow('24000');
    const repeated = source(); repeated.blocks.push({ ...repeated.blocks[0] });
    expect(() => validateFactSource(repeated)).toThrow('文本块');
  });
  it('rejects candidate authorization keys while preserving raw rejection evidence', () => {
    const material = source();
    const raw = JSON.stringify({ candidates: [{ ...rawCandidate(), confirmed: true }] });
    const checked = validateCandidateOutput(raw, material);
    expect(checked.raw).toBe(raw);
    expect(checked.rawCount).toBe(1);
    expect(checked.candidates).toHaveLength(0);
    expect(checked.rejected).toHaveLength(1);
  });
  it('rejects invented quote, block, subject and period references', () => {
    const material = source();
    const checked = batch(material, [rawCandidate({ quote: '完整应付工资9000元', value: '9000元' }), rawCandidate({ blockId: 'invented' }), rawCandidate({ subject: '别的材料里的人' }), rawCandidate({ period: '2026-12-01至2026-12-31' })]);
    expect(checked.candidates).toHaveLength(0);
    expect(checked.rejected).toHaveLength(4);
  });
  it('computes Unicode code point quote positions with astral prefixes', () => {
    const material = source('unicode', '😀𠮷甲完整应付工资6000.10元。');
    const checked = batch(material, [rawCandidate({ subject: null, period: null })]);
    const item = checked.candidates[0];
    expect(item.start).toBe(3);
    expect(Array.from(material.blocks[0].text).slice(item.start, item.end).join('')).toBe(item.quote);
  });
  it('keeps obscured monetary literals as unknown candidates, never zero', () => {
    const material = source('unknown', '完整应付工资X元。');
    const checked = batch(material, [rawCandidate({ value: 'X元', quote: '完整应付工资X元', subject: null, period: null })]);
    expect(checked.candidates[0].amount).toBeNull();
  });
  it('requires enum strings, rejecting arrays that stringify to a valid kind', () => {
    const material = source();
    const checked = batch(material, [{ ...rawCandidate(), kind: ['due_total'] }]);
    expect(checked.candidates).toHaveLength(0);
    expect(checked.rejected).toHaveLength(1);
  });
  it('requires assertion enum strings, rejecting arrays that stringify to admitted', () => {
    const material = source();
    const checked = batch(material, [{ ...rawCandidate(), assertion: ['admitted'] }]);
    expect(checked.candidates).toHaveLength(0);
    expect(checked.rejected).toHaveLength(1);
  });
  it('revalidates ingestion from raw output instead of trusting caller-supplied accepted fields', () => {
    const material = source();
    const forged: CandidateBatch = { ...batch(material), candidates: [{ ...batch(material).candidates[0], amount: '900000.00' }] };
    const state = ingestCandidates(emptyFactState(1), material, forged, 'controlled-review', ACTOR, AT);
    expect(state.materials[0].candidates[0].amount).toBe('6000.10');
    expect(state.confirmations.due).toBeNull();
  });
});

describe('independent material fact-chain review: user confirmation and invalidation', () => {
  it('does not automatically promote monthly rate, arrears, award or payment to confirmed totals', () => {
    const material = source('meanings', '月薪6000元；欠薪2000元；判付3000元；单笔支付1000元。');
    const entries = [
      rawCandidate({ kind: 'monthly_rate', value: '6000元', quote: '月薪6000元', subject: null, period: null }),
      rawCandidate({ kind: 'arrears', value: '2000元', quote: '欠薪2000元', subject: null, period: null }),
      rawCandidate({ kind: 'award', value: '3000元', quote: '判付3000元', subject: null, period: null, assertion: 'decided' }),
      rawCandidate({ kind: 'payment', value: '1000元', quote: '单笔支付1000元', subject: null, period: null, qualifier: 'partial' }),
    ];
    const state = ingestCandidates(emptyFactState(1), material, batch(material, entries), 'controlled-review', ACTOR, AT);
    expect(buildFactView(state, [material]).fields.due.status).toBe('unknown');
    expect(buildFactView(state, [material]).fields.paid.status).toBe('unknown');
    expect(() => prepareCalculation(state, [material])).toThrow();
  });
  it('requires explicit scope confirmation and rejects amount before scope', () => {
    const material = source();
    expect(() => confirm(extracted(material), material, 'due', '6000.10')).toThrow('先确认');
    expect(() => applyFactAction(extracted(material), { ...scopeAction(), verified: false } as unknown as FactAction, [material], ACTOR, AT)).toThrow();
  });
  it('rejects year zero as a v3-incompatible invalid civil date', () => {
    const material = source();
    expect(() => applyFactAction(extracted(material), scopeAction({ start: '0000-01-01', end: '0000-01-31' }), [material], ACTOR, AT)).toThrow();
  });
  it('requires all current monetary candidates and a nonblank basis to confirm totals', () => {
    const material = source(); const state = scopeConfirmed(material);
    expect(() => applyFactAction(state, { action: 'confirm_amount', field: 'due', amount: '6000.10', note: '核实', reviewedCandidateIds: [], complete: true, verified: true }, [material], ACTOR, AT)).toThrow('逐一');
    const ids = state.materials[0].candidates.map(c => c.id);
    expect(() => applyFactAction(state, { action: 'confirm_amount', field: 'due', amount: '6000.10', note: ' ', reviewedCandidateIds: ids, complete: true, verified: true }, [material], ACTOR, AT)).toThrow();
  });
  it('does not accept client-supplied actor or final status fields on actions', () => {
    const material = source();
    expect(() => applyFactAction(extracted(material), { ...scopeAction(), actor: 'forged', status: 'confirmed' } as unknown as FactAction, [material], ACTOR, AT)).toThrow();
  });
  it('permits explicit zero and paid greater than due after complete confirmation', () => {
    const material = source();
    expect(prepareCalculation(fullyConfirmed(material, '0', '10.01'), [material])).toEqual({ dueCents: 0, paidCents: 1001, generation: 1 });
    expect(prepareCalculation(fullyConfirmed(material, '6000.10', '0'), [material])).toEqual({ dueCents: 600010, paidCents: 0, generation: 1 });
  });
  it('uses actor supplied by the trusted boundary, not candidate content', () => {
    const material = source(); const state = fullyConfirmed(material);
    expect(state.confirmations.due?.actor).toBe(ACTOR);
    expect(state.confirmations.paid?.actor).toBe(ACTOR);
  });
  it('does not merge an explicitly different worker into the selected worker field view', () => {
    const material = source('workers', '王甲完整应付工资6000元；王乙完整应付工资7000元。');
    let state = ingestCandidates(emptyFactState(1), material, batch(material, [rawCandidate({ value: '6000元', quote: '王甲完整应付工资6000元', subject: '王甲', period: null }), rawCandidate({ value: '7000元', quote: '王乙完整应付工资7000元', subject: '王乙', period: null })]), 'controlled-review', ACTOR, AT);
    state = applyFactAction(state, scopeAction(), [material], ACTOR, AT);
    expect(buildFactView(state, [material]).fields.due.values).toEqual(['6000.00']);
    expect(buildFactView(state, [material]).canCalculate).toBe(false);
  });
  it('requires every admitted source to be extracted or explicitly excluded', () => {
    const material = source(); const state = fullyConfirmed(material);
    const extra = { ...source('new-unprocessed'), ready: false, blocks: [] };
    expect(buildFactView(state, [material, extra]).canCalculate).toBe(false);
    expect(() => prepareCalculation(state, [material, extra])).toThrow('尚未完成');
  });
  it('revokes the selected amount and prevents old calculation planning', () => {
    const material = source(); const previous = fullyConfirmed(material);
    const revoked = applyFactAction(previous, { action: 'revoke', field: 'paid' }, [material], ACTOR, AT);
    expect(revoked.confirmations.paid).toBeNull();
    expect(revoked.confirmations.due).not.toBeNull();
    expect(() => prepareCalculation(revoked, [material])).toThrow('已付');
    expect(previous.confirmations.paid).not.toBeNull();
  });
  it('invalidates all amount confirmations when scope changes', () => {
    const material = source(); const changed = applyFactAction(fullyConfirmed(material), scopeAction({ start: '2026-02-01', end: '2026-02-28' }), [material], ACTOR, AT);
    expect(changed.confirmations).toEqual({ due: null, paid: null });
    expect(buildFactView(changed, [material]).canCalculate).toBe(false);
  });
  it('invalidates the current authorization whenever material generation changes', () => {
    const material = source(); const next = synchronizeFacts(fullyConfirmed(material), 2, [material]);
    expect(next.generation).toBe(2);
    expect(next.scope).toBeNull();
    expect(next.confirmations).toEqual({ due: null, paid: null });
    expect(buildFactView(next, [material]).canCalculate).toBe(false);
  });
  it('invalidates even at a repeated generation if a previously accepted source disappears or revises', () => {
    const material = source(); const state = fullyConfirmed(material);
    expect(synchronizeFacts(state, 1, []).confirmations).toEqual({ due: null, paid: null });
    const revised = { ...material, analysisRevision: 2 };
    const next = synchronizeFacts(state, 1, [revised]);
    expect(next.materials).toHaveLength(0);
    expect(next.scope).toBeNull();
  });
  it('reextracting the same material invalidates old confirmation instead of silently replacing it', () => {
    const material = source(); const state = fullyConfirmed(material);
    const next = ingestCandidates(state, material, batch(material), 'controlled-review', ACTOR, AT);
    expect(next.confirmations).toEqual({ due: null, paid: null });
    expect(state.confirmations.due).not.toBeNull();
  });
  it('cannot retain authorization by excluding a material after confirmation', () => {
    const material = source();
    const state = applyFactAction(fullyConfirmed(material), { action: 'exclude_source', evidenceId: material.id, reason: '明确与本次工资核算无关' }, [material], ACTOR, AT);
    expect(state.materials[0].status).toBe('excluded');
    expect(state.confirmations).toEqual({ due: null, paid: null });
    expect(() => prepareCalculation(state, [material])).toThrow();
  });
});
