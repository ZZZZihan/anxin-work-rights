import { describe, expect, it } from 'vitest';
import type { FactAction, FactSource, FactState, RawCandidate } from './material-fact-types';
import type { RawCandidateV2 } from './material-fact-types-v2';
import { applyFactAction, buildExtractionMessages, buildFactView, emptyFactState, extractRuleCandidates, getCandidateRepresentation, ingestCandidates, isV2Candidate, matchesConfirmedPeriod, normalizeCandidateValue, parseCandidateOutput, prepareCalculation, synchronizeFacts, validateCandidateOutput } from './material-facts-v2';
import { ingestCandidates as ingestLegacy, validateCandidateOutput as validateLegacy } from './material-facts';

const AT = '2026-10-17T04:00:00.000Z';
const ACTOR = 'test-owner';
const scope = { worker: '王甲', employer: '甲公司', start: '2026-01-01', end: '2026-01-31' };
const source = (text = '王甲在甲公司2026-01-01至2026-01-31完整应付工资6000元。', id = 'private-source-id'): FactSource => ({
  id, name: '不应外传的材料文件名.pdf', sha256: 'a'.repeat(64), analysisRevision: 1, ready: true, blocks: [{ id: 'block-1', page: 1, text, bbox: null, confidence: null }],
});
const candidate = (overrides: Partial<RawCandidateV2> = {}): RawCandidateV2 => ({
  kind: 'money', value: '6000元', quote: '完整应付工资6000元', blockId: 'block-1', subject: '王甲', scope: 'individual',
  meaning: 'due_total', completeness: 'complete', period: '2026-01-01至2026-01-31', rateUnit: null, assertion: 'narrated', ...overrides,
});
const raw = (candidates: unknown[]) => JSON.stringify({ schemaVersion: 2, candidates });
const ingest = (material: FactSource, entries: RawCandidateV2[]) => ingestCandidates(emptyFactState(1), material, validateCandidateOutput(raw(entries), material), 'synthetic-test', ACTOR, AT);
function confirmScope(state: FactState, material: FactSource) {
  return applyFactAction(state, { action: 'confirm_scope', scope, note: '本人已核实工资主体和期间。', verified: true }, [material], ACTOR, AT);
}
function confirmAmount(state: FactState, material: FactSource, field: 'due' | 'paid', amount: string) {
  return applyFactAction(state, { action: 'confirm_amount', field, amount, note: '本人已独立核实本主体本期间完整金额，处理全部候选差异。',
    reviewedCandidateIds: buildFactView(state, [material]).candidates.filter(item => item.kind !== 'period').map(item => item.id), complete: true, verified: true }, [material], ACTOR, AT);
}

describe('v2 output boundary and source literals', () => {
  it('accepts only pure JSON or a complete single outer fence and preserves the original output', () => {
    const json = raw([candidate()]);
    for (const output of [json, ` \n${json}\n `, `\`\`\`json\n${json}\n\`\`\``, `\`\`\`\n${json}\n\`\`\``]) {
      const batch = validateCandidateOutput(output, source());
      expect(batch.raw).toBe(output);
      expect(batch.format).toBe(output.trim().startsWith('```') ? 'outer_fence' : 'json');
      expect(batch.candidates[0].representation).toEqual(candidate());
      expect(batch.candidates[0].outputFormat).toBe(batch.format);
    }
  });
  it('rejects surrounding narration, other languages, nested fences and damaged JSON without repair', () => {
    const json = raw([]);
    for (const output of [`说明${json}`, `${json}说明`, `\`\`\`javascript\n${json}\n\`\`\``, `\`\`\`json\n${json}`, `\`\`\`json\n\`\`\`json\n${json}\n\`\`\`\n\`\`\``, '{"schemaVersion":2,"candidates":[],}']) {
      expect(() => parseCandidateOutput(output)).toThrow();
    }
  });
  it('requires the exact versioned top-level envelope and bounds candidate counts', () => {
    for (const output of [JSON.stringify({ candidates: [] }), JSON.stringify({ schemaVersion: 1, candidates: [] }), JSON.stringify({ schemaVersion: 2, candidates: [], confirmed: true }), raw(Array.from({ length: 41 }, () => candidate()))]) {
      expect(() => validateCandidateOutput(output, source())).toThrow('协议');
    }
  });
  it('retains indexed rejections and refuses malformed or unauthorized attributes', () => {
    const output = raw([candidate(), { ...candidate(), authorized: true }, { ...candidate(), scope: ['individual'] }, { ...candidate(), meaning: 'employment_period' }, { ...candidate(), rateUnit: 'month' }]);
    const batch = validateCandidateOutput(output, source());
    expect(batch.raw).toBe(output);
    expect(batch.rawCount).toBe(5);
    expect(batch.candidates).toHaveLength(1);
    expect(batch.rejected.map(item => item.index)).toEqual([1, 2, 3, 4]);
  });
  it('requires a value inside an exact contiguous quote in the stated block and literal subject/period support', () => {
    const batch = validateCandidateOutput(raw([
      candidate({ value: '6000.00元' }), candidate({ quote: '完整应付工资 6000元' }), candidate({ blockId: 'invented' }),
      candidate({ subject: '王乙' }), candidate({ period: '2026年2月' }),
    ]), source());
    expect(batch.candidates).toEqual([]);
    expect(batch.rejected).toHaveLength(5);
  });
  it('does not treat a synthetic join between blocks as literal subject or period evidence', () => {
    const material = source('完整应付工资6000元；王甲');
    material.blocks.push({ id: 'block-2', page: 2, text: '王乙', bbox: null, confidence: null });
    const batch = validateCandidateOutput(raw([candidate({ subject: '王甲\n王乙', period: null })]), material);
    expect(batch.candidates).toEqual([]);
    expect(batch.rejected[0].reason).toContain('原文');
  });
  it('preserves Unicode code point positions and the full v2 representation through JSON storage and synchronization', () => {
    const material = source('😀𠮷王甲在甲公司2026-01-01至2026-01-31完整应付工资6000元。');
    const original = ingest(material, [candidate()]);
    const stored = JSON.parse(JSON.stringify(original)) as FactState;
    const next = synchronizeFacts(stored, 1, [material]);
    const item = next.materials[0].candidates[0];
    expect(isV2Candidate(item)).toBe(true);
    expect(getCandidateRepresentation(item)).toEqual(candidate());
    expect(Array.from(material.blocks[0].text).slice(item.start, item.end).join('')).toBe(item.quote);
    expect(next.materials[0].raw).toBe(raw([candidate()]));
  });
  it('revalidates raw v2 output at ingestion, ignoring forged accepted values and metadata', () => {
    const material = source();
    const batch = validateCandidateOutput(raw([candidate()]), material);
    batch.candidates[0].amount = '900000.00';
    batch.candidates[0].representation.scope = 'group';
    const state = ingestCandidates(emptyFactState(1), material, batch, 'test', ACTOR, AT);
    expect(state.materials[0].candidates[0].amount).toBe('6000.00');
    expect(getCandidateRepresentation(state.materials[0].candidates[0])?.scope).toBe('individual');
    expect(() => ingestCandidates(state, material, { raw: JSON.stringify({ candidates: [] }) }, 'test', ACTOR, AT)).toThrow('协议');
  });
  it('sends only text blocks, without filename, private source id or source hash', () => {
    const material = source();
    const messages = buildExtractionMessages(material);
    expect(JSON.parse(messages[1].content)).toEqual({ blocks: material.blocks.map(({ id, page, text }) => ({ id, page, text })) });
    expect(messages[1].content).not.toContain(material.id);
    expect(messages[1].content).not.toContain(material.name);
    expect(messages[1].content).not.toContain(material.sha256);
  });
});

describe('v2 monetary and date meaning', () => {
  it('keeps masked/unknown amounts null and explicit zero as zero', () => {
    const material = source('完整应付工资X元；完整已付0元。');
    const batch = validateCandidateOutput(raw([
      candidate({ value: 'X元', quote: '完整应付工资X元', subject: null, period: null }),
      candidate({ meaning: 'paid_total', value: '0元', quote: '完整已付0元', subject: null, period: null }),
    ]), material);
    expect(batch.candidates.map(item => item.amount)).toEqual([null, '0.00']);
  });
  it('normalizes explicit rates while retaining the original value, independent unit and amount meaning', () => {
    const material = source('月薪3000元/月；日工资300元/天；时薪30元/小时；每件工资3元/件。');
    const entries = [
      candidate({ value: '3000元/月', quote: '月薪3000元/月', rateUnit: 'month' }),
      candidate({ value: '300元/天', quote: '日工资300元/天', rateUnit: 'day' }),
      candidate({ value: '30元/小时', quote: '时薪30元/小时', rateUnit: 'hour' }),
      candidate({ value: '3元/件', quote: '每件工资3元/件', rateUnit: 'piece' }),
    ].map(item => ({ ...item, subject: null, period: null, meaning: 'rate' as const, completeness: 'not_applicable' as const }));
    const batch = validateCandidateOutput(raw(entries), material);
    expect(batch.candidates.map(item => item.amount)).toEqual(['3000.00', '300.00', '30.00', '3.00']);
    expect(batch.candidates.map(item => item.kind)).toEqual(['monthly_rate', 'other_amount', 'other_amount', 'other_amount']);
    expect(batch.candidates.map(item => item.representation.rateUnit)).toEqual(['month', 'day', 'hour', 'piece']);
    expect(batch.candidates.map(item => item.value)).toEqual(entries.map(item => item.value));
    expect(batch.candidates.every(item => item.reviewIssues.length === 0)).toBe(true);
  });
  it('does not silently convert contradictory day/month units or unknown units', () => {
    const material = source('日工资300元/天；工资标准3000元/月。');
    const entries = [
      candidate({ value: '300元/天', quote: '日工资300元/天', rateUnit: 'month' }),
      candidate({ value: '3000元/月', quote: '工资标准3000元/月', rateUnit: 'unknown' }),
    ].map(item => ({ ...item, subject: null, period: null, meaning: 'rate' as const, completeness: 'not_applicable' as const }));
    const batch = validateCandidateOutput(raw(entries), material);
    expect(batch.candidates[0].amount).toBeNull();
    expect(batch.candidates[0].reviewIssues.map(issue => issue.code)).toContain('rate_unit_mismatch');
    expect(normalizeCandidateValue(entries[1])).toEqual({ value: '3000.00', amount: '3000.00', rateUnit: 'unknown' });
    expect(batch.candidates[1].reviewIssues.map(issue => issue.code)).toContain('rate_unit_unresolved');
  });
  it('binds a rate unit to its own literal rather than another rate in the same quote', () => {
    const material = source('王甲月薪3000元，另按每小时20元支付加班费。');
    const monthly = candidate({ value: '3000元', quote: material.blocks[0].text, meaning: 'rate', completeness: 'not_applicable', rateUnit: 'month', subject: '王甲', period: null });
    const hourly = { ...monthly, value: '20元', rateUnit: 'hour' as const };
    const batch = validateCandidateOutput(raw([monthly, hourly]), material);
    expect(batch.candidates.map(item => item.amount)).toEqual(['3000.00', '20.00']);
    expect(batch.candidates.map(item => item.reviewIssues)).toEqual([[], []]);
  });
  it('enforces date/rate not_applicable and non-rate null rate units', () => {
    const material = source('2026年1月签订合同，月薪3000元。');
    const date = candidate({ kind: 'date', value: '2026年1月', quote: '2026年1月签订合同', meaning: 'contract_signing', completeness: 'not_applicable', subject: null, period: null });
    const rate = candidate({ value: '3000元', quote: '月薪3000元', meaning: 'rate', completeness: 'not_applicable', rateUnit: 'month', subject: null, period: null });
    const batch = validateCandidateOutput(raw([date, rate, { ...date, completeness: 'complete' }, { ...date, rateUnit: 'month' }, { ...rate, completeness: 'unknown' }, { ...rate, rateUnit: null }]), material);
    expect(batch.candidates).toHaveLength(2);
    expect(batch.rejected).toHaveLength(4);
    expect(batch.candidates[0].representation.value).toBe('2026年1月');
  });
  it('applies one completeness meaning to arrears, awards, other money and payment events', () => {
    const material = source();
    const entries = [
      ...(['arrears', 'award', 'other_money'] as const).flatMap(meaning => [candidate({ meaning, completeness: 'not_applicable' }), candidate({ meaning, completeness: 'unknown' })]),
      candidate({ meaning: 'payment', completeness: 'partial' }), candidate({ meaning: 'payment', completeness: 'unknown' }),
      candidate({ meaning: 'payment', completeness: 'complete' }), candidate({ meaning: 'payment', completeness: 'not_applicable' }),
      candidate({ completeness: 'not_applicable' }),
    ];
    const batch = validateCandidateOutput(raw(entries), material);
    expect(batch.candidates.map(item => item.representation.meaning)).toEqual(['arrears', 'award', 'other_money', 'payment', 'payment']);
    expect(batch.rejected.map(item => item.index)).toEqual([1, 3, 5, 8, 9, 10]);
  });
  it('preserves contract signing versus performance and diagnoses signing mislabeled as work', () => {
    const material = source('2026年1月签订合同，约定履行期2026年2月至2027年1月。');
    const date = candidate({ kind: 'date', value: '2026年1月', quote: '2026年1月签订合同', meaning: 'contract_signing', completeness: 'not_applicable', subject: null, period: null });
    const batch = validateCandidateOutput(raw([date, { ...date, meaning: 'employment_period' }, { ...date, value: '2026年2月至2027年1月', quote: '约定履行期2026年2月至2027年1月', meaning: 'contract_performance' }]), material);
    expect(batch.candidates.map(item => item.representation.meaning)).toEqual(['contract_signing', 'employment_period', 'contract_performance']);
    expect(batch.candidates[0].qualifier).toBe('contract_period');
    expect(batch.candidates[1].reviewIssues.map(issue => issue.code)).toContain('contract_signing_as_employment');
    expect(batch.candidates[2].qualifier).toBe('contract_period');
  });
});

describe('v2 personal total suggestions and human confirmation', () => {
  it('shows all candidates but has no personal total suggestion until scope is confirmed', () => {
    const material = source();
    const state = ingest(material, [candidate()]);
    expect(buildFactView(state, [material]).candidates).toHaveLength(1);
    expect(buildFactView(state, [material]).fields.due).toMatchObject({ status: 'unknown', values: [] });
    const withoutAttestation = structuredClone(state);
    withoutAttestation.scope = scope;
    expect(buildFactView(withoutAttestation, [material]).fields.due.values).toEqual([]);
    const view = buildFactView(confirmScope(state, material), [material]);
    expect(view.fields.due).toMatchObject({ status: 'candidate', values: ['6000.00'] });
    expect(view.canCalculate).toBe(false);
  });
  it('requires an explicit individual, matching subject, complete amount and exactly matching wage period', () => {
    const material = source('王甲、王乙在甲公司2026-01-01至2026-01-31完整应付工资6000元；另有2026年2月和1月工资。');
    const entries = [candidate({ scope: 'group' }), candidate({ scope: 'organization' }), candidate({ scope: 'unknown' }), candidate({ subject: null }), candidate({ subject: '王乙' }),
      candidate({ completeness: 'partial' }), candidate({ completeness: 'unknown' }), candidate({ period: null }), candidate({ period: '2026年2月' }), candidate({ period: '1月' })];
    const state = confirmScope(ingest(material, entries), material);
    const view = buildFactView(state, [material]);
    expect(view.candidates).toHaveLength(entries.length);
    expect(view.fields.due.values).toEqual([]);
    expect(view.canCalculate).toBe(false);
  });
  it('diagnoses obvious group text mislabeled individual and refuses that total suggestion', () => {
    const material = source('王甲班组10人2026-01-01至2026-01-31完整应付工资80000元。');
    const entry = candidate({ value: '80000元', quote: material.blocks[0].text });
    const state = confirmScope(ingest(material, [entry]), material);
    const view = buildFactView(state, [material]);
    expect(view.candidates).toHaveLength(1);
    expect(getCandidateRepresentation(view.candidates[0])?.scope).toBe('individual');
    expect((view.candidates[0] as ReturnType<typeof validateCandidateOutput>['candidates'][number]).reviewIssues.map(issue => issue.code)).toContain('scope_text_mismatch');
    expect(view.fields.due.values).toEqual([]);
  });
  it('recognizes common Chinese group counts without treating one worker as a group', () => {
    for (const count of ['十一人', '二十一人', '一百零一名劳动者', '两名劳动者', '11人']) {
      const material = source(`王甲等${count}在2026-01-01至2026-01-31完整应付工资80000元。`);
      const batch = validateCandidateOutput(raw([candidate({ value: '80000元', quote: material.blocks[0].text })]), material);
      expect(batch.candidates[0].reviewIssues.map(issue => issue.code)).toContain('scope_text_mismatch');
    }
    const material = source('王甲一人在2026-01-01至2026-01-31完整应付工资6000元。');
    expect(validateCandidateOutput(raw([candidate({ quote: material.blocks[0].text })]), material).candidates[0].reviewIssues).toEqual([]);
  });
  it('never treats a partial payment or a complete payment event as complete paid wages', () => {
    const material = source('王甲在甲公司2026-01-01至2026-01-31，本次单笔支付1000元，累计已付2000元。');
    const entries = [
      candidate({ meaning: 'paid_total', value: '1000元', quote: '本次单笔支付1000元', completeness: 'complete' }),
      candidate({ meaning: 'paid_total', value: '2000元', quote: '累计已付2000元', completeness: 'partial' }),
      candidate({ meaning: 'payment', value: '1000元', quote: '本次单笔支付1000元', completeness: 'complete' }),
    ];
    const view = buildFactView(confirmScope(ingest(material, entries), material), [material]);
    expect(view.candidates).toHaveLength(2);
    expect(stateRejections(ingest(material, entries))).toHaveLength(1);
    expect(view.fields.paid).toMatchObject({ status: 'unknown', values: [] });
    expect(view.canCalculate).toBe(false);
  });
  it('flags explicit wage advances mislabeled complete paid totals', () => {
    const material = source('王甲在2026-01-01至2026-01-31期间预支工资5000元。');
    const state = confirmScope(ingest(material, [candidate({ meaning: 'paid_total', value: '5000元', quote: '预支工资5000元' })]), material);
    const view = buildFactView(state, [material]);
    expect(view.fields.paid.values).toEqual([]);
    expect(isV2Candidate(view.candidates[0]) && view.candidates[0].reviewIssues.map(issue => issue.code)).toContain('partial_paid_total');
  });
  it('does not infer personal scope for a legacy candidate and keeps an existing human attestation', () => {
    const material = source();
    const legacy: RawCandidate = { kind: 'due_total', value: '6000元', quote: '完整应付工资6000元', blockId: 'block-1', subject: null, period: null, qualifier: 'unknown', assertion: 'narrated' };
    let state = ingestLegacy(emptyFactState(1), material, validateLegacy(JSON.stringify({ candidates: [legacy] }), material), 'legacy', ACTOR, AT);
    state = confirmScope(state, material);
    expect(getCandidateRepresentation(state.materials[0].candidates[0])).toBeNull();
    expect(buildFactView(state, [material]).fields.due.values).toEqual([]);
    state = confirmAmount(state, material, 'due', '6000');
    state = confirmAmount(state, material, 'paid', '0');
    expect(buildFactView(state, [material]).fields.due.status).toBe('confirmed');
    expect(prepareCalculation(state, [material])).toEqual({ dueCents: 600000, paidCents: 0, generation: 1 });
    expect(state.confirmations.due?.mode).toBe('user_attested');
  });
  it('uses user-confirmed totals after reviewing all v2 money, even when no candidate can suggest them', () => {
    const material = source('王甲班组10人2026-01-01至2026-01-31完整应付工资80000元。');
    let state = confirmScope(ingest(material, [candidate({ scope: 'group', value: '80000元', quote: material.blocks[0].text })]), material);
    state = confirmAmount(state, material, 'due', '8000');
    state = confirmAmount(state, material, 'paid', '2000');
    expect(buildFactView(state, [material]).fields.due.values).toEqual([]);
    expect(prepareCalculation(state, [material])).toEqual({ dueCents: 800000, paidCents: 200000, generation: 1 });
    expect(state.materials[0].candidates[0].amount).toBe('80000.00');
    const revoked = applyFactAction(state, { action: 'revoke', field: 'paid' } as FactAction, [material], ACTOR, AT);
    expect(() => prepareCalculation(revoked, [material])).toThrow('已付');
    expect(synchronizeFacts(state, 2, [material]).confirmations).toEqual({ due: null, paid: null });
  });
  it('retains conflict suggestions only for eligible individual complete totals, including explicit zero', () => {
    const material = source('王甲2026年1月完整应付工资6000元；王甲2026年1月完整应付工资7000元；王甲2026年1月完整已付0元。');
    const state = confirmScope(ingest(material, [candidate({ period: '2026年1月' }), candidate({ value: '7000元', quote: '完整应付工资7000元', period: '2026年1月' }), candidate({ meaning: 'paid_total', value: '0元', quote: '完整已付0元', period: '2026年1月' })]), material);
    const view = buildFactView(state, [material]);
    expect(view.fields.due).toMatchObject({ status: 'conflict', values: ['6000.00', '7000.00'] });
    expect(view.fields.paid).toMatchObject({ status: 'candidate', values: ['0.00'] });
  });
  it('matches explicit period precision without filling missing years or accepting invalid dates', () => {
    for (const period of ['2026-01-01至2026-01-31', '2026年1月1日至2026年1月31日', '2026年1月', '2026-01']) expect(matchesConfirmedPeriod(period, scope)).toBe(true);
    for (const period of [null, '1月', '1月1日至31日', '2026年1月1日至31日', '2026年1', '2026-1', '2026-01-01', '2026-01-01至2026-02-31', '2026年2月']) expect(matchesConfirmedPeriod(period, scope)).toBe(false);
  });
  it('rule baseline emits v2 roles and units without inferring personal attribution or a full period total', () => {
    const material = source('月薪3000元/月；日工资300元/天；单笔支付1000元；完整应付工资X元；累计已付0元。');
    const batch = validateCandidateOutput(extractRuleCandidates(material), material);
    expect(batch.rejected).toEqual([]);
    expect(batch.candidates).toHaveLength(5);
    expect(batch.candidates.every(item => item.representation.scope === 'unknown' && item.subject === null && item.period === null)).toBe(true);
    expect(batch.candidates.find(item => item.representation.rateUnit === 'day')?.kind).toBe('other_amount');
    const state = confirmScope(ingestCandidates(emptyFactState(1), material, batch, 'rules', ACTOR, AT), material);
    expect(buildFactView(state, [material]).fields.due.values).toEqual([]);
    expect(buildFactView(state, [material]).fields.paid.values).toEqual([]);
  });
});

function stateRejections(state: FactState) { return state.materials.flatMap(material => material.rejected); }
