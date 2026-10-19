import { describe, expect, it } from 'vitest';
import type { FactSource } from './material-fact-types';
import type { DateMeaning, FactCandidateV3, RawCandidateV3 } from './material-fact-types-v3';
import { ingestRuntimeCandidates } from './material-fact-runtime-ingest';
import { reviewFactsAgainstSources } from './material-fact-source-review';
import { applyFactAction, buildFactView, emptyFactState, validateCandidateOutput } from './material-facts-v3';

// Independent regressions first executed on 2d37c6b. Frozen parsing is observed
// separately; only the current source-aware runtime availability must change.
// All people, documents, outputs and confirmations in this file are synthetic.
const AT = '2026-10-18T12:00:00.000Z';
const scope = { worker: '王甲', employer: '合成测试单位', start: '2024-07-01', end: '2024-07-31' };
const sourceFor = (texts: string[]): FactSource => ({
  id: 'currency-date-independent', name: '币种及日期独立合成材料', sha256: 'b'.repeat(64), analysisRevision: 1, ready: true,
  blocks: texts.map((text, index) => ({ id: `b${index + 1}`, page: 1, text, bbox: null, confidence: null })),
});
const money = (overrides: Partial<RawCandidateV3> = {}): RawCandidateV3 => ({
  kind: 'money', value: '8000', quote: '8000', blockId: 'b1', subject: '王甲', scope: 'individual',
  meaning: 'due_total', completeness: 'complete', period: '2024年7月', rateUnit: null, assertion: 'narrated', ...overrides,
});
function exercise(texts: string[], representation: RawCandidateV3) {
  const source = sourceFor(texts), raw = JSON.stringify({ schemaVersion: 3, candidates: [representation] });
  const sourceBefore = structuredClone(source), frozen = validateCandidateOutput(raw, source);
  expect(frozen.rejected).toEqual([]);
  expect(frozen.candidates).toHaveLength(1);
  const ingested = ingestRuntimeCandidates(emptyFactState(1), source, { raw }, 'synthetic-independent', 'synthetic-owner', AT);
  const ingestedBefore = structuredClone(ingested);
  const scoped = applyFactAction(ingested, { action: 'confirm_scope', scope, verified: true,
    note: '合成独立验收：只核对劳动者及期间，金额尚未由人工确认。' }, [source], 'synthetic-owner', AT);
  const reviewed = reviewFactsAgainstSources(scoped, [source]), view = buildFactView(reviewed, [source]);
  const candidate = reviewed.materials[0].candidates[0] as FactCandidateV3;
  expect(candidate.representation).toEqual(representation);
  expect(reviewed.materials[0].raw).toBe(raw);
  expect(reviewed.materials[0].rejected).toEqual([]);
  expect(reviewed.confirmations).toEqual({ due: null, paid: null });
  expect(view.canCalculate).toBe(false);
  expect(source).toEqual(sourceBefore);
  expect(ingested).toEqual(ingestedBefore);
  expect(reviewFactsAgainstSources(reviewed, [source])).toEqual(reviewed);
  return { source, raw, frozen, candidate, reviewed, view };
}

const roles = [
  { meaning: 'due_total', text: '完整应付工资合计', completeness: 'complete', rateUnit: null },
  { meaning: 'paid_total', text: '完整已付工资合计', completeness: 'complete', rateUnit: null },
  { meaning: 'rate', text: '月薪', completeness: 'not_applicable', rateUnit: 'month' },
  { meaning: 'other_money', text: '应得补贴', completeness: 'not_applicable', rateUnit: null },
] as const;

describe('PR40 independent: source currency must be attached to this amount', () => {
  it.each(roles.flatMap(role => [false, true].map(full => ({ ...role, full }))))('$meaning bare number, fullQuote=$full', role => {
    const text = `王甲2024年7月${role.text}8000。`;
    const raw = money({ meaning: role.meaning, completeness: role.completeness, rateUnit: role.rateUnit, quote: role.full ? text : '8000' });
    const result = exercise([text], raw);
    // Explicitly retain the frozen parser's numerical compatibility contract.
    expect(result.frozen.candidates[0].amount).toBe('8000.00');
    expect(result.candidate.amount).toBeNull();
    expect(result.candidate.normalization.status).not.toBe('exact');
    expect(result.candidate.reviewIssues.length).toBeGreaterThan(0);
    expect(result.view.fields.due.values).toEqual([]);
    expect(result.view.fields.paid.values).toEqual([]);
  });

  const elsewhere = [
    { name: 'currency in preceding block header', texts: ['币种：人民币。', '王甲2024年7月完整应付工资合计8000。'], blockId: 'b2' },
    { name: 'currency in following block header', texts: ['王甲2024年7月完整应付工资合计8000。', '金额单位：元。'], blockId: 'b1' },
    { name: 'currency in same-block separate header', texts: ['金额单位：人民币。王甲2024年7月完整应付工资合计8000。'], blockId: 'b1' },
    { name: 'currency on another worker event', texts: ['李乙2024年8月完整应付工资9000元。王甲2024年7月完整应付工资合计8000。'], blockId: 'b1' },
    { name: 'currency across comma', texts: ['王甲2024年7月完整应付工资合计8000，单位元。'], blockId: 'b1' },
    { name: 'currency across newline', texts: ['王甲2024年7月完整应付工资合计8000\n元。'], blockId: 'b1' },
  ];
  it.each(elsewhere)('$name cannot turn an unmarked local token into exact RMB', ({ texts, blockId }) => {
    const result = exercise(texts, money({ blockId }));
    expect(result.candidate.amount).toBeNull();
    expect(result.candidate.normalization.status).not.toBe('exact');
    expect(result.view.fields.due.values).toEqual([]);
  });

  const attached = [
    { marker: '元 suffix', rendered: '8000元' },
    { marker: '人民币 prefix', rendered: '人民币8000' },
    { marker: '人民币 suffix', rendered: '8000人民币' },
    { marker: '¥ prefix', rendered: '¥8000' },
    { marker: '￥ prefix', rendered: '￥8000' },
    { marker: 'RMB prefix', rendered: 'RMB 8000' },
    { marker: 'CNY suffix', rendered: '8000 CNY' },
  ];
  it.each(attached)('$marker outside the cropped quote retains exact money', ({ rendered }) => {
    const result = exercise([`王甲2024年7月完整应付工资合计${rendered}。`], money());
    expect(result.candidate.amount).toBe('8000.00');
    expect(result.candidate.normalization.status).toBe('exact');
    expect(result.candidate.reviewIssues).toEqual([]);
    expect(result.view.fields.due.values).toEqual(['8000.00']);
    expect(result.view.fields.due.status).toBe('candidate');
  });

  it.each(roles)('$meaning with a directly attached 元 remains exact', role => {
    const result = exercise([`王甲2024年7月${role.text}8000元。`], money({ meaning: role.meaning,
      completeness: role.completeness, rateUnit: role.rateUnit, value: '8000元', quote: '8000元' }));
    expect(result.candidate.amount).toBe('8000.00');
    expect(result.candidate.normalization.status).toBe('exact');
    expect(result.candidate.reviewIssues).toEqual([]);
  });
});

const dateEvents: { meaning: DateMeaning; event: string }[] = [
  { meaning: 'employment_period', event: '入职' },
  { meaning: 'wage_period', event: '工资所属期间' },
  { meaning: 'contract_signing', event: '签订合同' },
  { meaning: 'contract_performance', event: '合同履行期间' },
  { meaning: 'payment_date', event: '收到工资' },
  { meaning: 'other_date', event: '发生工伤' },
];
const dateEntry = (meaning: DateMeaning): RawCandidateV3 => money({ kind: 'date', value: '2024年7月', quote: '2024年7月',
  meaning, period: null, completeness: 'not_applicable' });

describe('PR40 independent: date ownership includes the source event role', () => {
  it.each(dateEvents.flatMap(source => dateEvents.filter(label => label.meaning !== source.meaning).map(label => ({
    event: source.event, sourceMeaning: source.meaning, label: label.meaning,
  }))))('$sourceMeaning mislabeled $label requires review', ({ event, label }) => {
    const result = exercise([`王甲于2024年7月${event}。`], dateEntry(label));
    expect(result.candidate.amount).toBeNull();
    expect(result.candidate.reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
    expect(result.view.candidates[0]).toMatchObject({ representation: { meaning: label },
      reviewIssues: expect.arrayContaining([expect.objectContaining({ code: 'source_relation_unresolved' })]) });
  });

  it.each(dateEvents)('$meaning keeps the explicitly matching event', ({ meaning, event }) => {
    const result = exercise([`王甲于2024年7月${event}。`], dateEntry(meaning));
    expect(result.candidate.reviewIssues).toEqual([]);
    expect(result.candidate.representation.meaning).toBe(meaning);
  });

  it.each(dateEvents)('payer date is not a beneficiary date even when mislabeled $meaning', ({ meaning }) => {
    const result = exercise(['王甲于2024年7月支付工资。'], dateEntry(meaning));
    expect(result.candidate.reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
  });
});
