import { describe, expect, it } from 'vitest';
import type { FactSource, FactState } from './material-fact-types';
import type { FactCandidateV3, FactMaterialV3, RawCandidateV3 } from './material-fact-types-v3';
import { applyFactAction, buildExtractionMessages, buildFactView, emptyFactState, extractRuleCandidates, getCandidateLocalEvent, getCandidateRepresentation, getExtractionCoverage, ingestCandidates, isV3Candidate, normalizeMoneyValue, prepareCalculation, synchronizeFacts, validateCandidateOutput } from './material-facts-v3';
import { ingestCandidates as ingestV2, validateCandidateOutput as validateV2 } from './material-facts-v2';

const ACTOR = 'synthetic-owner', AT = '2026-10-17T09:00:00.000Z';
const scope = { worker: '王甲', employer: '甲公司', start: '2024-07-01', end: '2024-07-31' };
const source = (text: string): FactSource => ({ id: 'private-id', name: '不外传.pdf', sha256: 'a'.repeat(64), analysisRevision: 1, ready: true, blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] });
const money = (overrides: Partial<RawCandidateV3> = {}): RawCandidateV3 => ({ kind: 'money', value: '8000元', quote: '王甲工资共计8000元', blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'due_total', completeness: 'complete', period: null, rateUnit: null, assertion: 'narrated', ...overrides });
const date = (overrides: Partial<RawCandidateV3> = {}): RawCandidateV3 => money({ kind: 'date', value: '2024年7月', quote: '王甲2024年7月工资8000元', meaning: 'wage_period', completeness: 'not_applicable', ...overrides });
const raw = (candidates: unknown[], schemaVersion = 3) => JSON.stringify({ schemaVersion, candidates });
const ingest = (material: FactSource, candidates: RawCandidateV3[]) => ingestCandidates(emptyFactState(1), material, { raw: raw(candidates) }, 'synthetic', ACTOR, AT);
const issues = (entry: RawCandidateV3) => validateCandidateOutput(raw([entry]), source(entry.quote)).candidates[0].reviewIssues.map(issue => issue.code);

describe('v3 exact monetary normalization preserves raw evidence', () => {
  it.each([
    ['工资共计8000元', '8000.00', '8000元'], ['税前28000元', '28000.00', '28000元'],
    ['2024年7月工资费用8000元', '8000.00', '8000元'], ['2024-07-01至2024-07-31工资8000元', '8000.00', '8000元'],
    ['2024年7月起2倍工资8000元', '8000.00', '8000元'], ['底薪0元', '0.00', '0元'],
    ['工资13,381.90元', '13381.90', '13,381.90元'], ['工资66.32万元', '663200.00', '66.32万元'],
    ['工资约定为8000元', '8000.00', '8000元'], ['月工资3000元/月', '3000.00', '3000元'],
    ['人民币贰万捌仟元整', '28000.00', '人民币贰万捌仟元整'], ['伍万伍仟肆佰肆拾陆元叁角玖分', '55446.39', '伍万伍仟肆佰肆拾陆元叁角玖分'],
    ['壹亿零叁万零伍元整', '100030005.00', '壹亿零叁万零伍元整'], ['零元整', '0.00', '零元整'], ['零元伍分', '0.05', '零元伍分'],
  ])('parses one explicit literal in %s', (value, amount, matchedText) => {
    const result = normalizeMoneyValue(value);
    expect(result).toMatchObject({ rawValue: value, status: 'exact', amount, matchedText });
    expect(Array.from(value).slice(result.span!.start, result.span!.end).join('')).toBe(matchedText);
  });
  it('reports code point spans without replacing narrative prefixes or astral characters', () => {
    const value = '😀𠮷工资共计8000元', result = normalizeMoneyValue(value);
    expect(result.span).toEqual({ start: 6, end: 11 });
    const entry = money({ value, quote: `王甲${value}` });
    const item = validateCandidateOutput(raw([entry]), source(entry.quote)).candidates[0];
    expect(item.value).toBe(value);
    expect(item.representation.value).toBe(value);
    expect(item.amount).toBe('8000.00');
    expect(item.normalization.rawValue).toBe(value);
  });
  it.each([
    ['8000元和9000元', 'multiple_amounts'], ['8000元及8000元', 'multiple_amounts'], ['工资5000元另付500', 'multiple_amounts'],
    ['一共1000元或2000', 'multiple_amounts'], ['工资1000元/月与6000', 'multiple_amounts'], ['工资1000元和贰仟', 'multiple_amounts'],
    ['一千元工资另付8000元', 'multiple_amounts'], ['1000元五角', 'multiple_amounts'], ['壹仟元，零伍分', 'multiple_amounts'],
    ['8000至9000元', 'range'], ['8000元至9000元', 'range'], ['8000-9000元', 'range'],
    ['约8000元', 'approximate'], ['约为工资8000元', 'approximate'], ['130多万元', 'approximate'], ['8000元左右', 'approximate'],
    ['不低于工资1000元', 'approximate'], ['不得少于1000元', 'approximate'], ['8000元起', 'approximate'],
    ['尚欠X元', 'masked'], ['工资未知', 'masked'], ['工资可能8000元', 'uncertain'], ['工资待核8000元', 'uncertain'],
    ['10%', 'percentage'], ['10%工资8000元', 'percentage'], ['百分之十', 'percentage'],
    ['壹仟壹元', 'unsupported'], ['壹佰佰元', 'unsupported'], ['一千元', 'unsupported'], ['12,34元', 'unsupported'], ['8000.005元', 'unsupported'],
    ['-8000元', 'unsupported'], ['- 8000元', 'unsupported'], ['负 8000元', 'unsupported'], ['－8000元', 'unsupported'], ['＋8000元', 'unsupported'], ['−8000元', 'unsupported'],
    ['USD1000元', 'unsupported'], ['$1000元', 'unsupported'], ['港币1000元', 'unsupported'], ['±1000元', 'unsupported'],
  ])('keeps %s unavailable as an exact calculation amount (%s)', (value, status) => {
    const result = normalizeMoneyValue(value);
    expect(result).toMatchObject({ rawValue: value, status, amount: null, matchedText: null, span: null });
    expect(result.reason.length).toBeGreaterThan(0);
  });
  it('keeps rate units bound to the current literal and refuses contradictory units', () => {
    const material = source('王甲月薪3000元，另按每小时20元支付加班费。日工资300元/天。');
    const entry = money({ value: '3000元', quote: material.blocks[0].text, meaning: 'rate', completeness: 'not_applicable', rateUnit: 'month' });
    const batch = validateCandidateOutput(raw([entry, { ...entry, value: '20元', rateUnit: 'hour' }, { ...entry, value: '300元/天', rateUnit: 'month' }]), material);
    expect(batch.candidates.map(item => item.amount)).toEqual(['3000.00', '20.00', null]);
    expect(batch.candidates[2].normalization.status).toBe('rate_unit_mismatch');
    expect(batch.candidates[2].reviewIssues.map(item => item.code)).toContain('rate_unit_mismatch');
    const mislabeledTotal = validateCandidateOutput(raw([money({ value: '3000元/月', quote: '王甲完整应付工资3000元/月' })]), source('王甲完整应付工资3000元/月'));
    expect(mislabeledTotal.candidates[0].amount).toBeNull();
    expect(mislabeledTotal.candidates[0].reviewIssues.map(item => item.code)).toContain('rate_unit_mismatch');
  });
  it.each([
    ['王甲工资约8000元', '8000元', 'approximate'], ['王甲工资至少8000元', '8000元', 'approximate'],
    ['王甲工资不低于人民币8000元', '8000元', 'approximate'], ['王甲工资近8000元', '8000元', 'approximate'],
    ['王甲工资8000元左右', '8000元', 'approximate'], ['王甲工资8000元/月以上', '8000元', 'approximate'],
    ['王甲工资8000元至9000元', '8000元', 'range'], ['王甲工资8000元至9000元', '9000元', 'range'],
    ['王甲工资可能8000元', '8000元', 'uncertain'], ['王甲工资8000元或9000元', '8000元', 'uncertain'],
    ['王甲工资-8000元', '8000元', 'unsupported'], ['王甲工资8000元，另一笔8000元', '8000元', 'uncertain'],
    ['王甲工资USD8000元', '8000元', 'unsupported'], ['王甲工资负数8000元', '8000元', 'unsupported'],
  ])('does not restore false exactness after value drops its source qualifier: %s', (quote, value, status) => {
    const item = validateCandidateOutput(raw([money({ quote, value })]), source(quote)).candidates[0];
    expect(item.normalization).toMatchObject({ rawValue: value, status, amount: null });
    expect(item.amount).toBeNull();
  });
  it('does not let an approximate different amount contaminate the current amount', () => {
    const quote = '王甲工资约8000元，另有明确收入9000元。';
    const item = validateCandidateOutput(raw([money({ quote, value: '9000元' })]), source(quote)).candidates[0];
    expect(item.normalization.status).toBe('exact');
    expect(item.amount).toBe('9000.00');
  });
});

describe('v3 diagnostics target the value event rather than the whole quote', () => {
  it('does not count legal third parties or another event as a worker group', () => {
    expect(issues(money({ quote: '第三人王甲工资共计8000元' }))).not.toContain('scope_text_mismatch');
    expect(issues(money({ quote: '第三十一人王甲工资共计8000元' }))).not.toContain('scope_text_mismatch');
    expect(issues(money({ quote: '王甲工资共计8000元。另有十一名工人起诉。' }))).not.toContain('scope_text_mismatch');
  });
  it.each(['三人', '十一名工人', '二十一人', '11名劳动者', '班组十人', '一百零一名劳动者'])('still flags a real group: %s', group => {
    expect(issues(money({ quote: `王甲等${group}工资共计8000元` }))).toContain('scope_text_mismatch');
  });
  it('separates signing from employment across sentences and within a sentence', () => {
    const entry = date({ value: '上世纪八九十年代', quote: '王甲在上世纪八九十年代任职。2011年2月签订合同。', meaning: 'employment_period' });
    expect(issues(entry)).not.toContain('contract_signing_as_employment');
    expect(issues(date({ value: '2020年1月', quote: '王甲于2020年1月入职，2021年2月签订合同。', meaning: 'employment_period' }))).not.toContain('contract_signing_as_employment');
    expect(issues(date({ value: '2021年2月', quote: '王甲于2020年1月入职，2021年2月签订合同。', meaning: 'employment_period' }))).toContain('contract_signing_as_employment');
  });
  it('makes repeated-value ambiguity visible instead of selecting its first event', () => {
    const entry = date({ value: '2020年1月', quote: '王甲2020年1月入职，另于2020年1月签订合同。', meaning: 'employment_period' });
    expect(getCandidateLocalEvent(entry).text).toBeNull();
    expect(issues(entry)).toContain('local_context_ambiguous');
    expect(issues(entry)).not.toContain('contract_signing_as_employment');
  });
});

describe('v3 coverage diagnostics are visible heuristics', () => {
  it('distinguishes empty output from all candidates rejected', () => {
    const material = source('王甲2024年7月工资8000元，约定每月15日支付。');
    const empty = validateCandidateOutput(raw([]), material);
    expect(empty.coverage).toMatchObject({ heuristic: true, status: 'empty', rawCount: 0, acceptedCount: 0 });
    expect(empty.coverage.signals.some(signal => signal.kind === 'money' && signal.text === '8000元')).toBe(true);
    const rejected = validateCandidateOutput(raw([money({ value: '9000元' })]), material);
    expect(rejected.coverage).toMatchObject({ status: 'none_accepted', rawCount: 1, acceptedCount: 0, rejectedCount: 1 });
    expect(empty.coverage.message).toContain('不能据此');
  });
  it('requires a separate wage-period date even when money.period preserves it', () => {
    const material = source('王甲2024年7月工资8000元。');
    const entry = money({ quote: material.blocks[0].text, period: '2024年7月' });
    const incomplete = validateCandidateOutput(raw([entry]), material);
    expect(incomplete.coverage.status).toBe('possible_missing');
    expect(incomplete.coverage.signals).toContainEqual(expect.objectContaining({ kind: 'wage_period', text: '2024年7月', covered: false }));
    const complete = validateCandidateOutput(raw([entry, date({ quote: material.blocks[0].text })]), material);
    expect(complete.coverage.status).toBe('no_signal');
    expect(complete.coverage.message).toContain('不证明提取完整');
    for (const signal of complete.coverage.signals) expect(Array.from(material.blocks[0].text).slice(signal.start, signal.end).join('')).toBe(signal.text);
  });
  it('flags omitted payment days without adding candidates or calculation authority', () => {
    const material = source('王甲工资8000元，每月15日支付。');
    const batch = validateCandidateOutput(raw([money({ quote: material.blocks[0].text })]), material);
    expect(batch.coverage.status).toBe('possible_missing');
    expect(batch.coverage.signals).toContainEqual(expect.objectContaining({ kind: 'date', text: '每月15日', covered: false }));
    const state = ingestCandidates(emptyFactState(1), material, batch, 'synthetic', ACTOR, AT);
    expect((state.materials[0] as FactMaterialV3).coverage).toEqual(batch.coverage);
    expect(state.materials[0].candidates).toHaveLength(1);
    expect(buildFactView(state, [material]).canCalculate).toBe(false);
  });
  it.each(['试用期', '离职前', '工作3个月'])('retains an unanchored stage %s without inventing a date gap', period => {
    const material = source(`王甲${period}工资8000元。`);
    const batch = validateCandidateOutput(raw([money({ quote: material.blocks[0].text, period })]), material);
    expect(batch.candidates[0].representation.period).toBe(period);
    expect(batch.coverage.signals.some(signal => signal.kind === 'wage_period')).toBe(false);
    expect(batch.coverage.status).toBe('no_signal');
  });
});

describe('v3 protocol, persistence and confirmation lifecycle', () => {
  it('keeps eleven model fields, requires null date.period, and refuses extra authority fields', () => {
    const material = source('王甲2024年7月工资8000元。');
    expect(validateCandidateOutput(raw([date(), date({ period: '2024年7月' }), { ...date(), normalization: {} }, { ...date(), confirmed: true }]), material).rejected.map(item => item.index)).toEqual([1, 2, 3]);
    expect(() => validateCandidateOutput(raw([], 2), material)).toThrow('schemaVersion:3');
    expect(() => validateCandidateOutput(JSON.stringify({ schemaVersion: 3, candidates: [], coverage: {} }), material)).toThrow('协议');
    const messages = buildExtractionMessages(material);
    expect(JSON.parse(messages[1].content)).toEqual({ blocks: material.blocks.map(({ id, page, text }) => ({ id, page, text })) });
    expect(messages[1].content).not.toContain(material.name);
    expect(messages[1].content).not.toContain(material.sha256);
  });
  it('deduplicates the same normalized fact and assertion while retaining explicit different assertions and roles', () => {
    const material = source('王甲工资共计8000元。王甲主张欠付8000元。王甲承认8000元。');
    const first = money({ quote: '王甲工资共计8000元', value: '工资共计8000元' });
    const batch = validateCandidateOutput(raw([first, { ...first, value: '8000元', quote: '王甲承认8000元' }, { ...first, assertion: 'claimed' }, { ...first, assertion: 'admitted' }, { ...first, meaning: 'arrears', completeness: 'not_applicable' }]), material);
    expect(batch.candidates).toHaveLength(4);
    expect(batch.rejected).toEqual([{ index: 1, reason: expect.stringContaining('重复') }]);
    expect(batch.candidates.map(item => item.representation.assertion)).toEqual(['narrated', 'claimed', 'admitted', 'narrated']);
  });
  it('revalidates raw output at ingestion instead of trusting forged normalization or coverage', () => {
    const material = source('王甲工资共计8000元。'), batch = validateCandidateOutput(raw([money()]), material);
    batch.candidates[0].amount = '999999.00'; batch.candidates[0].normalization.amount = '999999.00'; batch.coverage.status = 'empty';
    const state = ingestCandidates(emptyFactState(1), material, batch, 'synthetic', ACTOR, AT), item = state.materials[0].candidates[0] as FactCandidateV3;
    expect(item.amount).toBe('8000.00');
    expect(item.normalization.amount).toBe('8000.00');
    expect((state.materials[0] as FactMaterialV3).coverage.status).toBe('no_signal');
  });
  it('reads v2 without upgrading old amounts or rewriting stored metadata', () => {
    const material = source('王甲在甲公司2024年7月工资共计8000元。');
    const entry = money({ value: '工资共计8000元', quote: material.blocks[0].text, period: '2024年7月' });
    let state = ingestV2(emptyFactState(1), material, validateV2(raw([entry], 2), material), 'v2', ACTOR, AT);
    state = applyFactAction(state, { action: 'confirm_scope', scope, note: '本人核实主体期间', verified: true }, [material], ACTOR, AT);
    const snapshot = JSON.stringify(state), candidate = state.materials[0].candidates[0];
    expect(candidate.amount).toBeNull();
    expect(getCandidateRepresentation(candidate)).toEqual(entry);
    expect(buildFactView(state, [material]).fields.due.values).toEqual([]);
    expect(getExtractionCoverage(state.materials[0], material)?.status).toBe('possible_missing');
    expect(JSON.stringify(state)).toBe(snapshot);
  });
  it('persists derived v3 evidence and preserves explicit human confirmation as the sole calculation input', () => {
    const material = source('王甲在甲公司2024年7月工资共计8000元。');
    let state = ingest(material, [money({ quote: material.blocks[0].text, period: '2024年7月' })]);
    state = synchronizeFacts(JSON.parse(JSON.stringify(state)) as FactState, 1, [material]);
    expect(isV3Candidate(state.materials[0].candidates[0])).toBe(true);
    expect(getExtractionCoverage(state.materials[0])?.status).toBe('possible_missing');
    expect(buildFactView(state, [material]).fields.due.values).toEqual([]);
    state = applyFactAction(state, { action: 'confirm_scope', scope, note: '本人核实主体期间', verified: true }, [material], ACTOR, AT);
    expect(buildFactView(state, [material]).fields.due.values).toEqual(['8000.00']);
    expect(() => prepareCalculation(state, [material])).toThrow();
    for (const [field, amount] of [['due', '7500'], ['paid', '0']] as const) state = applyFactAction(state, { action: 'confirm_amount', field, amount, note: '本人独立核实本主体本期完整金额并处理全部差异', reviewedCandidateIds: state.materials[0].candidates.map(item => item.id), complete: true, verified: true }, [material], ACTOR, AT);
    expect(prepareCalculation(state, [material])).toEqual({ dueCents: 750000, paidCents: 0, generation: 1 });
    const revoked = applyFactAction(state, { action: 'revoke', field: 'paid' }, [material], ACTOR, AT);
    expect(() => prepareCalculation(revoked, [material])).toThrow();
    expect(synchronizeFacts(state, 2, [material]).confirmations).toEqual({ due: null, paid: null });
  });
  it('keeps the rule baseline conservative and v3-versioned', () => {
    const material = source('月薪3000元/月；完整应付工资X元；累计已付0元。');
    const batch = validateCandidateOutput(extractRuleCandidates(material), material);
    expect(batch.rejected).toEqual([]);
    expect(batch.candidates.find(item => item.representation.meaning === 'rate')?.amount).toBe('3000.00');
    expect(batch.candidates.find(item => item.representation.meaning === 'due_total')?.amount).toBeNull();
    expect(batch.candidates.find(item => item.representation.meaning === 'paid_total')?.amount).toBe('0.00');
    expect(batch.candidates.every(item => item.representation.scope === 'unknown' && item.representation.subject === null)).toBe(true);
  });
  it('deduplicates the same fact independently of repeated-value quote ambiguity', () => {
    const material = source('王甲工资共计8000元。再次记录王甲工资共计8000元。');
    const narrow = money({quote:'王甲工资共计8000元'});
    const wide = {...narrow,quote:material.blocks[0].text};
    for (const entries of [[narrow,wide],[wide,narrow]]) {
      const batch = validateCandidateOutput(JSON.stringify({schemaVersion:3,candidates:entries}),material);
      expect(batch.candidates).toHaveLength(1);
      expect(batch.rejected).toHaveLength(1);
      expect(batch.rejected[0].reason).toContain('重复');
    }
  });
});
