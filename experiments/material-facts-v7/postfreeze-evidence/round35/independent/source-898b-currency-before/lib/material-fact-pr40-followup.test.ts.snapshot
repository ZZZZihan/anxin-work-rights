import { describe, expect, it } from 'vitest';
import type { FactMaterial, FactSource, FactState } from './material-fact-types';
import type { ExtractionCoverage, FactCandidateV3, RawCandidateV3 } from './material-fact-types-v3';
import { reviewFactsAgainstSources } from './material-fact-source-review';
import { applyFactAction, buildFactView, emptyFactState, getExtractionCoverage, ingestCandidates } from './material-facts-v3';
import { ingestCandidates as ingestV2, validateCandidateOutput as validateV2 } from './material-facts-v2';

// Independent follow-up fixtures for review 2b14693. The original 63-case record stays frozen.
const AT = '2026-10-18T06:00:00.000Z';
const sourceFor = (texts: string[]): FactSource => ({
  id: 'followup-source', name: 'PR40 后续独立合成材料', sha256: 'f'.repeat(64), analysisRevision: 1, ready: true,
  blocks: texts.map((text, index) => ({ id: `b${index + 1}`, page: 1, text, bbox: null, confidence: null })),
});
const entry = (overrides: Partial<RawCandidateV3> = {}): RawCandidateV3 => ({
  kind: 'money', value: '8000元', quote: '8000元', blockId: 'b2', subject: '王甲', scope: 'individual',
  meaning: 'due_total', completeness: 'complete', period: '2024年7月', rateUnit: null, assertion: 'narrated', ...overrides,
});
const candidate = (state: FactState) => state.materials[0].candidates[0] as FactCandidateV3;
function stateFor(source: FactSource, rawCandidate: RawCandidateV3, version: 2 | 3 = 3, extra: RawCandidateV3[] = []) {
  const raw = JSON.stringify({ schemaVersion: version, candidates: [rawCandidate, ...extra] });
  return version === 3
    ? ingestCandidates(emptyFactState(1), source, { raw }, 'synthetic-followup', 'independent-owner', AT)
    : ingestV2(emptyFactState(1), source, validateV2(raw, source), 'synthetic-followup-v2', 'independent-owner', AT);
}

type MoneyRole = { name: string; event: string; overrides: Partial<RawCandidateV3> };
const moneyRoles: MoneyRole[] = [
  { name: 'rate', event: '月薪8000元', overrides: { meaning: 'rate', completeness: 'not_applicable', rateUnit: 'month' } },
  { name: 'payment / partial', event: '收到一笔工资8000元', overrides: { meaning: 'payment', completeness: 'partial' } },
  { name: 'payment / unknown', event: '收到工资8000元', overrides: { meaning: 'payment', completeness: 'unknown' } },
  { name: 'arrears', event: '欠付工资8000元', overrides: { meaning: 'arrears', completeness: 'not_applicable' } },
  { name: 'award', event: '裁决给付工资8000元', overrides: { meaning: 'award', completeness: 'not_applicable' } },
  { name: 'other_money', event: '应得补贴8000元', overrides: { meaning: 'other_money', completeness: 'not_applicable' } },
  ...(['due_total', 'paid_total'] as const).flatMap(meaning => (['complete', 'partial', 'unknown'] as const).map(completeness => ({
    name: `${meaning} / ${completeness}`, event: `${meaning === 'due_total' ? '完整应付' : '完整已付'}工资8000元`, overrides: { meaning, completeness },
  }))),
  ...(['group', 'organization', 'unknown'] as const).flatMap(scope => (['due_total', 'paid_total'] as const).map(meaning => ({
    name: `${meaning} / ${scope}`, event: `${meaning === 'due_total' ? '完整应付' : '完整已付'}工资8000元`, overrides: { meaning, scope },
  }))),
  { name: 'rate / group', event: '月薪8000元', overrides: { meaning: 'rate', completeness: 'not_applicable', rateUnit: 'month', scope: 'group' } },
  { name: 'award / organization', event: '裁决给付工资8000元', overrides: { meaning: 'award', completeness: 'not_applicable', scope: 'organization' } },
  { name: 'arrears / unknown', event: '欠付工资8000元', overrides: { meaning: 'arrears', completeness: 'not_applicable', scope: 'unknown' } },
];
const mismatches = [
  { name: 'subject from another block', owner: '李乙', period: '2024年7月' },
  { name: 'period from another block', owner: '王甲', period: '2024年8月' },
  { name: 'subject and period from another block', owner: '李乙', period: '2024年8月' },
];

describe('PR40 follow-up: attribution warnings apply beyond complete individual totals', () => {
  it.each(moneyRoles.flatMap(role => mismatches.map(mismatch => ({ ...role, mismatch, name: `${role.name} / ${mismatch.name}` }))))('$name', ({ event, overrides, mismatch }) => {
    const source = sourceFor(['王甲2024年7月信息待核。', `${mismatch.owner}${mismatch.period}${event}。`]);
    const rawCandidate = entry(overrides), state = stateFor(source, rawCandidate), snapshot = structuredClone(state);
    expect(state.materials[0].rejected).toEqual([]);
    expect(state.materials[0].candidates).toHaveLength(1);
    const reviewed = reviewFactsAgainstSources(state, [source]), view = buildFactView(reviewed, [source]);
    expect(view.candidates).toHaveLength(1);
    const shown = view.candidates[0] as FactCandidateV3;
    expect(shown.reviewIssues.map(issue => issue.code), JSON.stringify({ rawCandidate, text: source.blocks[1].text })).toContain('source_relation_unresolved');
    expect(shown.value).toBe(rawCandidate.value);
    expect(shown.quote).toBe(rawCandidate.quote);
    expect(shown.representation).toEqual(rawCandidate);
    expect(reviewed.materials[0].raw).toBe(state.materials[0].raw);
    expect(reviewed.confirmations).toEqual({ due: null, paid: null });
    expect(state).toEqual(snapshot);
    expect(reviewFactsAgainstSources(reviewed, [source])).toEqual(reviewed);
  });

  it.each(['rate', 'payment', 'arrears', 'award', 'other_money'] as const)('historical v2 / %s also warns about borrowed owner and period', meaning => {
    const role = moneyRoles.find(role => role.overrides.meaning === meaning)!;
    const source = sourceFor(['王甲2024年7月信息待核。', `李乙2024年8月${role.event}。`]);
    const rawCandidate = entry(role.overrides), state = stateFor(source, rawCandidate, 2);
    expect(state.materials[0].rejected).toEqual([]);
    const reviewed = reviewFactsAgainstSources(state, [source]), shown = buildFactView(reviewed, [source]).candidates[0] as FactCandidateV3;
    expect(shown.reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
    expect(shown).toMatchObject({ schemaVersion: 2, representation: rawCandidate });
    expect(Object.hasOwn(shown, 'normalization')).toBe(false);
    expect(reviewed.materials[0].raw).toBe(state.materials[0].raw);
  });

  const distinctMoneyRoles = moneyRoles.filter((role, index, roles) => roles.findIndex(other => other.overrides.meaning === role.overrides.meaning) === index);
  it.each(distinctMoneyRoles)('$name does not infer ownership from co-occurrence in a two-event clause', ({ event, overrides }) => {
    const source = sourceFor([`王甲2024年7月${event.replace('8000元', '5000元')}及李乙2024年8月${event}。`]);
    const rawCandidate = entry({ ...overrides, blockId: 'b1' }), state = stateFor(source, rawCandidate);
    expect(state.materials[0].rejected).toEqual([]);
    const shown = buildFactView(reviewFactsAgainstSources(state, [source]), [source]).candidates[0] as FactCandidateV3;
    expect(shown.reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
    expect(shown.representation).toEqual(rawCandidate);
  });
  it.each(distinctMoneyRoles)('$name does not treat the speaker as the wage beneficiary', ({ event, overrides }) => {
    const source = sourceFor([`王甲称李乙2024年7月${event}。`]);
    const rawCandidate = entry({ ...overrides, blockId: 'b1' }), state = stateFor(source, rawCandidate);
    expect(state.materials[0].rejected).toEqual([]);
    const shown = buildFactView(reviewFactsAgainstSources(state, [source]), [source]).candidates[0] as FactCandidateV3;
    expect(shown.reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
  });
  it.each([...distinctMoneyRoles, moneyRoles.find(role => role.name === 'payment / unknown')!])('$name does not silently treat a company actor as the wage recipient', ({ event, overrides }) => {
    const source = sourceFor([`甲公司2024年7月${event.replace('收到', '支付')}。`]);
    const rawCandidate = entry({ ...overrides, blockId: 'b1', subject: '甲公司', scope: 'organization' });
    const state = stateFor(source, rawCandidate);
    expect(state.materials[0].rejected).toEqual([]);
    const shown = buildFactView(reviewFactsAgainstSources(state, [source]), [source]).candidates[0] as FactCandidateV3;
    expect(shown.reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
    expect(shown.representation).toEqual(rawCandidate);
  });
  it.each([
    { subject: '王甲', scope: 'individual' },
    { subject: '王甲班组', scope: 'group' },
    { subject: '王甲', scope: 'unknown' },
  ] as const)('payment / unknown / $scope needs a recipient rather than the paying actor', ({ subject, scope }) => {
    const source = sourceFor([`${subject}2024年7月支付工资8000元。`]);
    const rawCandidate = entry({ blockId: 'b1', subject, scope, meaning: 'payment', completeness: 'unknown' });
    const state = stateFor(source, rawCandidate);
    expect(state.materials[0].rejected).toEqual([]);
    const shown = buildFactView(reviewFactsAgainstSources(state, [source]), [source]).candidates[0] as FactCandidateV3;
    expect(shown.reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
    expect(shown.representation).toEqual(rawCandidate);
  });
  it.each(distinctMoneyRoles.filter(role => ['rate', 'arrears', 'award', 'other_money'].includes(role.overrides.meaning!)))('$name cannot bypass payer review by changing the model money role', ({ overrides }) => {
    const source = sourceFor(['王甲2024年7月支付工资8000元。']);
    const rawCandidate = entry({ ...overrides, blockId: 'b1' }), state = stateFor(source, rawCandidate);
    expect(state.materials[0].rejected).toEqual([]);
    const shown = buildFactView(reviewFactsAgainstSources(state, [source]), [source]).candidates[0] as FactCandidateV3;
    expect(shown.reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
    expect(shown.representation).toEqual(rawCandidate);
  });

  it.each([
    '另一工人的工资也计入上述总额。',
    '另一班组的工资也包含在上述总额中。',
    '李乙2024年8月应付9000元也计入上述总额。',
  ])('does not discard another-worker clause referring back to this total: %s', suffix => {
    const source = sourceFor([`王甲2024年7月完整应付工资8000元。${suffix}`]);
    const rawCandidate = entry({ blockId: 'b1' }), ingested = stateFor(source, rawCandidate);
    expect(ingested.materials[0].rejected).toEqual([]);
    const state = applyFactAction(ingested, {
      action: 'confirm_scope', scope: { worker: '王甲', employer: '甲公司', start: '2024-07-01', end: '2024-07-31' },
      note: '合成用户已核对本人和期间，尚未确认金额', verified: true,
    }, [source], 'independent-owner', AT);
    expect(buildFactView(state, [source]).fields.due.values).toEqual(['8000.00']);
    const snapshot = structuredClone(state), reviewed = reviewFactsAgainstSources(state, [source]);
    const view = buildFactView(reviewed, [source]), shown = view.candidates[0] as FactCandidateV3;
    expect(shown.reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
    expect(view.fields.due.values).toEqual([]);
    expect(view.fields.due.status).toBe('unknown');
    expect(shown.representation).toEqual(rawCandidate);
    expect(reviewed.materials[0].raw).toBe(state.materials[0].raw);
    expect(reviewed.scope).toEqual(state.scope);
    expect(reviewed.scopeReview).toEqual(state.scopeReview);
    expect(reviewed.confirmations).toEqual(state.confirmations);
    expect(state).toEqual(snapshot);
  });

  const dateRoles = [
    { meaning: 'employment_period', event: '入职' }, { meaning: 'wage_period', event: '工资所属期间' },
    { meaning: 'contract_signing', event: '签订合同' }, { meaning: 'contract_performance', event: '合同履行期间' },
    { meaning: 'payment_date', event: '支付工资' }, { meaning: 'other_date', event: '发生工伤' },
  ] as const;
  it.each(dateRoles.flatMap(role => (['individual', 'group', 'organization', 'unknown'] as const).map(scope => ({ ...role, scope }))))('$meaning / $scope cannot borrow a date from another worker', ({ meaning, event, scope }) => {
    const source = sourceFor(['王甲2024年7月信息待核。', `李乙2024年8月${event}。`]);
    const rawCandidate = entry({ kind: 'date', meaning, scope, value: '2024年8月', quote: '2024年8月', period: null, completeness: 'not_applicable' });
    const state = stateFor(source, rawCandidate);
    expect(state.materials[0].rejected).toEqual([]);
    const reviewed = reviewFactsAgainstSources(state, [source]), shown = buildFactView(reviewed, [source]).candidates[0] as FactCandidateV3;
    expect(shown.reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
    expect(shown.representation).toEqual(rawCandidate);
    expect(shown.value).toBe('2024年8月');
    expect(shown.quote).toBe('2024年8月');
  });
  it.each(dateRoles)('$meaning does not join another worker date in the same clause', ({ meaning, event }) => {
    const source = sourceFor([`王甲2024年7月${event}而李乙2024年8月${event}。`]);
    const rawCandidate = entry({ blockId: 'b1', kind: 'date', meaning, value: '2024年8月', quote: '2024年8月', period: null, completeness: 'not_applicable' });
    const state = stateFor(source, rawCandidate);
    expect(state.materials[0].rejected).toEqual([]);
    const shown = buildFactView(reviewFactsAgainstSources(state, [source]), [source]).candidates[0] as FactCandidateV3;
    expect(shown.reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
  });
  it.each([
    { subject: '王甲', scope: 'individual' },
    { subject: '甲公司', scope: 'organization' },
  ] as const)('payment_date does not treat $subject paying wages as the recipient', ({ subject, scope }) => {
    const source = sourceFor([`${subject}2024年8月支付工资。`]);
    const rawCandidate = entry({ blockId: 'b1', kind: 'date', meaning: 'payment_date', subject, scope,
      value: '2024年8月', quote: '2024年8月', period: null, completeness: 'not_applicable' });
    const state = stateFor(source, rawCandidate);
    expect(state.materials[0].rejected).toEqual([]);
    const shown = buildFactView(reviewFactsAgainstSources(state, [source]), [source]).candidates[0] as FactCandidateV3;
    expect(shown.reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
    expect(shown.representation).toEqual(rawCandidate);
  });
  it.each(dateRoles.filter(role => role.meaning !== 'payment_date'))('$meaning cannot bypass payer review by changing the model date role', ({ meaning }) => {
    const source = sourceFor(['王甲2024年8月支付工资。']);
    const rawCandidate = entry({ blockId: 'b1', kind: 'date', meaning,
      value: '2024年8月', quote: '2024年8月', period: null, completeness: 'not_applicable' });
    const state = stateFor(source, rawCandidate);
    expect(state.materials[0].rejected).toEqual([]);
    const shown = buildFactView(reviewFactsAgainstSources(state, [source]), [source]).candidates[0] as FactCandidateV3;
    expect(shown.reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
    expect(shown.representation).toEqual(rawCandidate);
  });

  it.each(moneyRoles.slice(0, 6))('keeps explicit matching $name attribution free of relation warnings', ({ event, overrides }) => {
    const recipientEvent = overrides.meaning === 'award' ? event.replace('给付', '应得') : event;
    const source = sourceFor([`王甲2024年7月${recipientEvent}。`]), rawCandidate = entry({ ...overrides, blockId: 'b1' });
    const state = stateFor(source, rawCandidate), reviewed = reviewFactsAgainstSources(state, [source]);
    expect(candidate(reviewed).reviewIssues.map(issue => issue.code)).not.toContain('source_relation_unresolved');
  });
  it.each(dateRoles)('keeps matching $meaning attribution free of relation warnings', ({ meaning, event }) => {
    const source = sourceFor([`王甲2024年8月${meaning === 'payment_date' ? '收到工资' : event}。`]);
    const state = stateFor(source, entry({ blockId: 'b1', kind: 'date', meaning, value: '2024年8月', quote: '2024年8月', period: null, completeness: 'not_applicable' }));
    expect(candidate(reviewFactsAgainstSources(state, [source])).reviewIssues.map(issue => issue.code)).not.toContain('source_relation_unresolved');
  });
});

type MaterialWithRuntimeCoverage = FactMaterial & { sourceCoverage?: ExtractionCoverage | null };
const runtimeCoverage = (state: FactState) => (state.materials[0] as MaterialWithRuntimeCoverage).sourceCoverage;
const coverageSource = () => sourceFor(['王甲2024年7月完整应付工资8000元。李乙2024年8月完整应付工资9000元。']);
const legacyState = (source: FactSource) => stateFor(source, entry({ blockId: 'b1' }), 2);

describe('PR40 follow-up: nonempty legacy coverage reaches source-less client material', () => {
  it('server review attaches an ephemeral possible-missing diagnostic while preserving legacy schema and raw', () => {
    const source = coverageSource(), state = legacyState(source), snapshot = structuredClone(state);
    expect(state.materials[0].candidates).toHaveLength(1);
    expect(getExtractionCoverage(state.materials[0])).toBeNull();
    const expected = getExtractionCoverage(state.materials[0], source);
    expect(expected?.status).toBe('possible_missing');
    expect(expected?.signals.some(signal => !signal.covered && signal.text === '9000元')).toBe(true);
    const reviewed = reviewFactsAgainstSources(state, [source]);
    expect(runtimeCoverage(reviewed)).toEqual(expected);
    expect((reviewed.materials[0] as FactMaterial & { schemaVersion: number }).schemaVersion).toBe(2);
    expect(reviewed.materials[0].candidates[0]).toMatchObject({ schemaVersion: 2 });
    expect(reviewed.materials[0].raw).toBe(state.materials[0].raw);
    expect(state).toEqual(snapshot);
    expect(reviewFactsAgainstSources(reviewed, [source])).toEqual(reviewed);
  });

  it('keeps rawCount and rejected counts when some old candidates were rejected', () => {
    const source = coverageSource(), first = entry({ blockId: 'b1' });
    const rejected = entry({ blockId: 'b1', value: '9000元', quote: '不存在的引文9000元', subject: '李乙', period: '2024年8月' });
    const state = stateFor(source, first, 2, [rejected]);
    expect(state.materials[0].candidates).toHaveLength(1);
    expect(state.materials[0].rejected).toHaveLength(1);
    const reviewed = reviewFactsAgainstSources(state, [source]);
    expect(runtimeCoverage(reviewed)).toMatchObject({ heuristic: true, status: 'possible_missing', rawCount: 2, acceptedCount: 1, rejectedCount: 1 });
    expect(reviewed.materials[0].rejected).toEqual(state.materials[0].rejected);
    expect(reviewed.materials[0].raw).toBe(state.materials[0].raw);
  });

  it('does not repair malformed historical raw in order to show a coverage warning', () => {
    const source = coverageSource(), state = legacyState(source);
    state.materials[0].raw = '{historical truncated output';
    const reviewed = reviewFactsAgainstSources(state, [source]);
    expect(runtimeCoverage(reviewed)).toMatchObject({ status: 'possible_missing', rawCount: 1, acceptedCount: 1 });
    expect(reviewed.materials[0].raw).toBe('{historical truncated output');
  });

  it.each(['missing', 'stale_revision', 'unready', 'different_sha'] as const)('does not reuse an old runtime diagnostic against %s source evidence', unavailable => {
    const source = coverageSource(), reviewed = reviewFactsAgainstSources(legacyState(source), [source]);
    expect(runtimeCoverage(reviewed)).toBeTruthy();
    const sources = unavailable === 'missing' ? [] : [{ ...source,
      ...(unavailable === 'stale_revision' ? { analysisRevision: 2 } : {}),
      ...(unavailable === 'unready' ? { ready: false } : {}),
      ...(unavailable === 'different_sha' ? { sha256: 'e'.repeat(64) } : {}),
    }];
    expect(runtimeCoverage(reviewFactsAgainstSources(reviewed, sources)) ?? null).toBeNull();
  });
});
