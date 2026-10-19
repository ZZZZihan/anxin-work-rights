import { describe, expect, it } from 'vitest';
import type { FactSource, FactState } from './material-fact-types';
import type { FactCandidateV3, RawCandidateV3 } from './material-fact-types-v3';
import { reviewFactsAgainstSources } from './material-fact-source-review';
import { applyFactAction, buildFactView, emptyFactState, ingestCandidates, prepareCalculation, validateCandidateOutput } from './material-facts-v3';
import { ingestCandidates as ingestV2, validateCandidateOutput as validateV2 } from './material-facts-v2';

// Independent synthetic acceptance fixtures, kept separate from extraction-evaluation golds.
// Each intentionally wrong model output is still an exact literal substring of its source.
const ACTOR = 'independent-synthetic-owner';
const AT = '2026-10-18T00:00:00.000Z';
const material = (texts: string[]): FactSource => ({
  id: 'independent-source', name: 'PR40 独立合成验收材料', sha256: 'd'.repeat(64), analysisRevision: 1, ready: true,
  blocks: texts.map((text, index) => ({ id: `b${index + 1}`, page: index + 1, text, bbox: null, confidence: null })),
});
const candidate = (overrides: Partial<RawCandidateV3> = {}): RawCandidateV3 => ({
  kind: 'money', value: '80000元', quote: '80000元', blockId: 'b1', subject: '王甲', scope: 'individual',
  meaning: 'due_total', completeness: 'complete', period: '2024年7月', rateUnit: null, assertion: 'narrated', ...overrides,
});
const item = (state: FactState) => state.materials[0].candidates[0] as FactCandidateV3;
function stateFor(source: FactSource, rawCandidate: RawCandidateV3, worker = '王甲') {
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [rawCandidate] });
  const state = ingestCandidates(emptyFactState(1), source, { raw }, 'synthetic-independent', ACTOR, AT);
  expect(state.materials[0].rejected).toEqual([]);
  expect(state.materials[0].candidates).toHaveLength(1);
  return applyFactAction(state, {
    action: 'confirm_scope', scope: { worker, employer: '甲公司', start: '2024-07-01', end: '2024-07-31' },
    note: '合成用户已核对本人和期间；尚未确认候选金额', verified: true,
  }, [source], ACTOR, AT);
}

type UnsafeFixture = { name: string; texts: string[]; overrides?: Partial<RawCandidateV3> };
const unsafeFixtures: UnsafeFixture[] = [
  { name: 'group / comma separates the omitted group owner from the total', texts: ['王甲班组十名工人，2024年7月应付工资合计80000元。'] },
  { name: 'group / newline separates the omitted group owner from the total', texts: ['王甲等十名工人\n2024年7月应付工资合计80000元。'] },
  { name: 'group / group header and total occupy different blocks', texts: ['王甲班组十名工人2024年7月工资表', '应付工资合计80000元。'], overrides: { blockId: 'b2' } },
  { name: 'group / parentheses and a comma crop the collective owner', texts: ['王甲（含其他九名工人），2024年7月应付工资合计80000元。'] },
  { name: 'group / later clarification identifies the amount as a group total', texts: ['王甲2024年7月应付工资合计80000元，实际为班组十名工人工资。'] },
  { name: 'group / later representative wording identifies joint beneficiaries', texts: ['王甲2024年7月应付工资合计80000元，代表班组十名工人领取。'] },
  { name: 'group / same owner and period later clarify group representation', texts: ['王甲2024年7月应付工资合计80000元，王甲2024年7月系代表班组领取。'] },
  { name: 'group / following sentence refers to the same group amount', texts: ['王甲2024年7月应付工资合计80000元。上述金额为班组十名工人工资。'] },
  { name: 'group / preceding header explicitly makes following rows group totals', texts: ['以下金额均为十名工人工资汇总。\n王甲2024年7月应付工资合计80000元。'] },
  { name: 'group / preceding OCR block governs an otherwise explicit personal-looking row', texts: ['以下金额均为十名工人工资汇总。', '王甲2024年7月应付工资合计80000元。'], overrides: { blockId: 'b2' } },
  { name: 'group / dated collective header is not another named worker event', texts: ['全组2024年7月应付工资汇总如下。', '王甲2024年7月应付工资合计80000元。'], overrides: { blockId: 'b2' } },
  { name: 'group / next OCR block refers to this same group amount', texts: ['王甲2024年7月应付工资合计80000元。', '上述金额为班组十名工人工资。'] },
  { name: 'subject / another sentence merely mentions the claimed worker', texts: ['王甲在甲公司2024年7月工资已经结清。李乙在甲公司2024年7月完整应付工资80000元。'] },
  { name: 'period / another sentence merely mentions the claimed period', texts: ['王甲2024年6月完整应付工资80000元。王甲2024年7月尚未结算。'] },
  { name: 'subject and period / another block contains both claimed labels', texts: ['王甲2024年7月的工资尚未结算。', '李乙2024年8月完整应付工资80000元。'], overrides: { blockId: 'b2' } },
  { name: 'subject and period / one clause contains two owners, periods and values', texts: ['王甲2024年7月完整应付工资5000元及李乙2024年8月完整应付工资80000元。'] },
  { name: 'period / one clause contains two amounts for the same worker', texts: ['王甲2024年7月完整应付工资5000元而2024年8月完整应付工资80000元。'] },
  { name: 'subject / different amounts share the claimed month in one clause', texts: ['王甲2024年7月完整应付工资5000元与李乙2024年7月完整应付工资80000元。'] },
  { name: 'period / current block has a different worker-month association', texts: ['2024年7月李乙完整应付工资5000元，王甲2024年8月完整应付工资80000元。'] },
  { name: 'subject / claimed worker is only a prefix of another full name', texts: ['王甲乙2024年7月完整应付工资80000元。'] },
  { name: 'period / claimed month is only a prefix of a two-month total', texts: ['王甲2024年7月至8月完整应付工资80000元。'] },
  { name: 'period / claimed month is only part of an explicit date interval', texts: ['王甲2024年7月1日至8月31日完整应付工资80000元。'] },
  { name: 'subject / claimed worker is the speaker rather than wage beneficiary', texts: ['王甲称李乙2024年7月完整应付工资80000元。'] },
  { name: 'subject / named joint beneficiaries are not an individual total', texts: ['王甲和李乙2024年7月应付工资合计80000元。'] },
  { name: 'due / partial qualifier omitted from the quote', texts: ['王甲2024年7月部分应付工资80000元。'] },
  { name: 'due / only basic salary is included', texts: ['王甲2024年7月应付工资80000元（仅含基本工资）。'] },
  { name: 'due / suffix explicitly excludes overtime pay', texts: ['王甲2024年7月应付工资80000元，不含加班工资。'] },
  { name: 'due / first installment is not the complete monthly amount', texts: ['王甲2024年7月第一笔应付工资80000元。'] },
  { name: 'due / comma separates the partial qualifier from amount', texts: ['王甲2024年7月部分应付工资，计80000元。'] },
  { name: 'due / trailing wage component remains separately payable', texts: ['王甲2024年7月应付工资合计80000元，加班工资另计。'] },
  { name: 'due / trailing supplementary amount is not included', texts: ['王甲2024年7月应付工资合计80000元，另有加班工资未计入。'] },
  { name: 'due / same owner and month still have separately payable overtime', texts: ['王甲2024年7月应付工资合计80000元，王甲2024年7月加班工资另计。'] },
  { name: 'due / following sentence refers to incomplete wage components', texts: ['王甲2024年7月应付工资合计80000元。上述金额仅含基本工资。'] },
  { name: 'due / semicolon does not detach an explicit same-amount qualifier', texts: ['王甲2024年7月应付工资合计80000元；上述金额不含加班工资。'] },
  { name: 'due / ASCII semicolon does not detach a same-amount qualifier', texts: ['王甲2024年7月应付工资合计80000元;上述金额不含加班工资。'] },
  { name: 'due / preceding header explicitly excludes overtime from following amounts', texts: ['以下金额仅含基本工资：\n王甲2024年7月应付工资合计80000元。'] },
  { name: 'due / preceding OCR block limits wage components of an explicit row', texts: ['以下金额仅含基本工资：', '王甲2024年7月应付工资合计80000元。'], overrides: { blockId: 'b2' } },
  { name: 'due / following OCR block limits the same amount', texts: ['王甲2024年7月应付工资合计80000元。', '上述金额仅含基本工资。'] },
  { name: 'currency / USD suffix is outside a bare-number quote', texts: ['王甲2024年7月完整应付工资80000美元。'], overrides: { value: '80000', quote: '80000' } },
  { name: 'currency / alphabetic USD suffix is outside a bare-number quote', texts: ['王甲2024年7月完整应付工资80000 USD。'], overrides: { value: '80000', quote: '80000' } },
  { name: 'currency / HKD suffix is outside a bare-number quote', texts: ['王甲2024年7月完整应付工资80000港元。'], overrides: { value: '80000', quote: '80000' } },
  { name: 'currency / parenthesized currency suffix is outside quote', texts: ['王甲2024年7月完整应付工资80000（USD）。'], overrides: { value: '80000', quote: '80000' } },
  { name: 'currency / JPY suffix is outside a bare-number quote', texts: ['王甲2024年7月完整应付工资80000日元。'], overrides: { value: '80000', quote: '80000' } },
];

describe('PR40 independent source-review acceptance, outside frozen extraction scoring', () => {
  it.each(unsafeFixtures)('$name cannot become an available personal complete total', ({ texts, overrides }) => {
    const source = material(texts), rawCandidate = candidate(overrides), state = stateFor(source, rawCandidate);
    const original = structuredClone(state), before = buildFactView(state, [source]);
    // Demonstrate the actual reachable v3 protocol boundary rather than injecting an invalid state.
    expect(item(state).reviewIssues).toEqual([]);
    expect(item(state).amount).toBe('80000.00');
    expect(before.fields.due.values).toEqual(['80000.00']);
    expect(before.canCalculate).toBe(false);

    const reviewed = reviewFactsAgainstSources(state, [source]), view = buildFactView(reviewed, [source]);
    // Evidence and human-authored state must survive even if availability decreases.
    expect(state).toEqual(original);
    expect(item(reviewed).value).toBe(rawCandidate.value);
    expect(item(reviewed).quote).toBe(rawCandidate.quote);
    expect(item(reviewed).representation).toEqual(rawCandidate);
    expect(reviewed.materials[0].raw).toBe(state.materials[0].raw);
    expect(reviewed.scope).toEqual(state.scope);
    expect(reviewed.scopeReview).toEqual(state.scopeReview);
    expect(reviewed.confirmations).toEqual(state.confirmations);
    expect(view.fields.due.values, JSON.stringify({ texts, rawCandidate, candidate: item(reviewed) })).toEqual([]);
    expect(view.fields.due.status).toBe('unknown');
    expect(view.canCalculate).toBe(false);
    expect(reviewFactsAgainstSources(reviewed, [source])).toEqual(reviewed);
  });

  const positiveCases: Array<{ name: string; text: string; overrides?: Partial<RawCandidateV3> }> = [
    { name: 'explicit individual complete monthly total', text: '王甲2024年7月完整应付工资80000元。' },
    { name: 'unrelated group is followed by an explicit individual event', text: '另一班组十名工人另案处理，王甲2024年7月完整应付工资80000元。' },
    { name: 'unrelated partial amount is followed by an explicit complete event', text: '李乙2024年6月部分应付工资90000元，王甲2024年7月完整应付工资80000元。' },
    { name: 'the complete amount precedes a separately owned partial event', text: '王甲2024年7月完整应付工资80000元，李乙2024年6月部分应付工资90000元。' },
    { name: 'payment frequency accompanies a complete period total', text: '王甲2024年7月按月支付本期累计应付工资80000元。' },
    { name: 'explicit RMB suffix is a supported CNY amount', text: '王甲2024年7月完整应付工资80000元人民币。' },
    { name: 'explicit CNY suffix is a supported CNY amount', text: '王甲2024年7月完整应付工资80000 CNY。', overrides: { value: '80000', quote: '80000' } },
    { name: 'ordinary exact zero remains exact', text: '王甲2024年7月完整应付工资0元。', overrides: { value: '0元', quote: '0元' } },
  ];
  it.each(positiveCases)('keeps $name available', ({ text, overrides }) => {
    const source = material([text]), state = stateFor(source, candidate(overrides));
    const reviewed = reviewFactsAgainstSources(state, [source]);
    expect(item(reviewed).reviewIssues).toEqual([]);
    expect(buildFactView(reviewed, [source]).fields.due.values).toEqual([overrides?.value === '0元' ? '0.00' : '80000.00']);
  });

  it.each(['王甲和李乙', '王甲及李乙', '王甲与李乙', '王甲、李乙', '王甲等', '王甲等人'])('does not accept joint or unspecified beneficiary %s as an individual even when scope repeats it', subject => {
    const source = material([`${subject}2024年7月完整应付工资80000元。`]);
    const rawCandidate = candidate({ subject }), state = stateFor(source, rawCandidate, subject);
    expect(item(state).reviewIssues).toEqual([]);
    expect(buildFactView(state, [source]).fields.due.values).toEqual(['80000.00']);
    const reviewed = reviewFactsAgainstSources(state, [source]);
    expect(buildFactView(reviewed, [source]).fields.due.values).toEqual([]);
    expect(item(reviewed).representation).toEqual(rawCandidate);
    expect(reviewed.materials[0].raw).toBe(state.materials[0].raw);
  });

  it('leaves direct frozen validation output unchanged after reviewing against source', () => {
    const source = material(['王甲班组十名工人，2024年7月应付工资合计80000元。']);
    const raw = JSON.stringify({ schemaVersion: 3, candidates: [candidate()] });
    const batch = validateCandidateOutput(raw, source), snapshot = structuredClone(batch);
    expect(batch.rejected).toEqual([]);
    expect(batch.candidates[0].amount).toBe('80000.00');
    const state = stateFor(source, candidate());
    reviewFactsAgainstSources(state, [source]);
    expect(batch).toEqual(snapshot);
  });

  it.each([
    unsafeFixtures.find(fixture => fixture.name.startsWith('group / comma'))!,
    unsafeFixtures.find(fixture => fixture.name.startsWith('subject / another sentence'))!,
    unsafeFixtures.find(fixture => fixture.name.startsWith('due / partial qualifier'))!,
    unsafeFixtures.find(fixture => fixture.name.startsWith('currency / USD suffix'))!,
  ])('historical v2 / $name fails closed at the runtime boundary', ({ texts, overrides }) => {
    const source = material(texts), rawCandidate = candidate(overrides);
    const raw = JSON.stringify({ schemaVersion: 2, candidates: [rawCandidate] });
    const batch = validateV2(raw, source);
    expect(batch.rejected).toEqual([]);
    expect(batch.candidates).toHaveLength(1);
    let state = ingestV2(emptyFactState(1), source, batch, 'synthetic-independent-v2', ACTOR, AT);
    state = applyFactAction(state, { action: 'confirm_scope', scope: {
      worker: '王甲', employer: '甲公司', start: '2024-07-01', end: '2024-07-31',
    }, note: '合成用户核对本人和期间', verified: true }, [source], ACTOR, AT);
    expect(buildFactView(state, [source]).fields.due.values).toEqual(['80000.00']);
    const reviewed = reviewFactsAgainstSources(state, [source]);
    expect(buildFactView(reviewed, [source]).fields.due.values).toEqual([]);
    expect(reviewed.materials[0].candidates[0]).toMatchObject({ schemaVersion: 2, value: rawCandidate.value, quote: rawCandidate.quote, representation: rawCandidate });
    expect(Object.hasOwn(reviewed.materials[0].candidates[0], 'normalization')).toBe(false);
    expect(reviewed.materials[0].raw).toBe(raw);
  });

  it('preserves independently attested human amounts after unsafe model candidate is blocked', () => {
    const source = material(['王甲班组十名工人，2024年7月应付工资合计80000元。']);
    let state = stateFor(source, candidate());
    for (const [field, amount] of [['due', '8000'], ['paid', '0']] as const) {
      state = applyFactAction(state, { action: 'confirm_amount', field, amount,
        note: '人工独立核实王甲个人全部工资，班组80000元不作为本人金额；已核对全部候选',
        reviewedCandidateIds: [item(state).id], complete: true, verified: true }, [source], ACTOR, AT);
    }
    const reviewed = reviewFactsAgainstSources(state, [source]), view = buildFactView(reviewed, [source]);
    expect(view.fields.due.values).toEqual([]);
    expect(view.fields.due.confirmation?.amount).toBe('8000.00');
    expect(view.fields.paid.confirmation?.amount).toBe('0.00');
    expect(reviewed.confirmations).toEqual(state.confirmations);
    expect(prepareCalculation(reviewed, [source])).toEqual({ dueCents: 800000, paidCents: 0, generation: 1 });
  });
});
