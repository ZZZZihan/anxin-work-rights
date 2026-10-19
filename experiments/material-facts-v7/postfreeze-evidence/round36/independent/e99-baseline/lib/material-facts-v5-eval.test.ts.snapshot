import { describe, expect, it } from 'vitest';
// @ts-expect-error The evaluation entry point is also directly runnable by Node.
import { assess } from '../experiments/material-facts-v5/assess.mjs';
import type { RawCandidateV2 } from './material-fact-types-v2';

const source = { id: 'synthetic', name: '合成评分回归', sha256: 'a'.repeat(64), analysisRevision: 1, ready: true,
  blocks: [{ id: 'b1', page: 1, text: '张某班组共3人欠付工资8000元。2026年1月预支张某500元。2026年1月1日签订合同，月工资3000元/月。', bbox: null, confidence: null }] };
const group: RawCandidateV2 = { kind: 'money', value: '8000元', quote: '张某班组共3人欠付工资8000元', blockId: 'b1', subject: '张某班组', scope: 'group', meaning: 'arrears', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
const input = [{ id: 'test', source }];
const result = (candidates: unknown[], finish = 'stop', fenced = false) => [{ id: 'test', finish_reason: finish, raw_output: `${fenced ? '```json\n' : ''}${JSON.stringify({ schemaVersion: 2, candidates })}${fenced ? '\n```' : ''}` }];
const labels = (expected: RawCandidateV2[]) => [{ id: 'test', expected }];

describe('independent v5 scoring safeguards', () => {
  it('retains null/non-object predictions as raw false positives instead of crashing', () => {
    const score = assess(input, labels([group]), result([null, 7, 'bad', group]));
    expect(score.metrics.raw_strict).toMatchObject({ tp: 1, fp: 3, fn: 0 });
    expect(score.metrics.accepted_strict).toMatchObject({ tp: 1, fp: 0, fn: 0 });
    expect(score.rejected_candidates).toBe(3);
  });
  it('uses bounded outer-fence compatibility formally while measuring native JSON separately', () => {
    const score = assess(input, labels([group]), result([group], 'stop', true));
    expect(score.native_json).toBe(0);
    expect(score.protocol_valid).toBe(1);
    expect(score.metrics.accepted_strict.tp).toBe(1);
  });
  it('does not let duplicates inflate recall, or an incomplete output become accepted', () => {
    expect(assess(input, labels([group]), result([group, group])).metrics.accepted_strict).toMatchObject({ tp: 1, fp: 1, fn: 0 });
    expect(assess(input, labels([group]), result([group], 'length')).metrics.accepted_strict).toMatchObject({ tp: 0, fp: 0, fn: 1 });
    expect(assess(input, labels([group]), []).metrics.accepted_strict.fn).toBe(1);
  });
  it('measures group/person and single/complete payment errors separately from literal amounts', () => {
    const payment: RawCandidateV2 = { ...group, value: '500元', quote: '2026年1月预支张某500元', subject: '张某', scope: 'individual', meaning: 'payment', completeness: 'partial', period: '2026年1月' };
    const score = assess(input, labels([group, payment]), result([{ ...group, subject: '张某', scope: 'individual' }, { ...payment, meaning: 'paid_total', completeness: 'complete' }]));
    expect(score.metrics.accepted_basic.tp).toBe(1);
    expect(score.metrics.accepted_strict.tp).toBe(0);
    expect(score.cases[0].focus_confusions.accepted.flatMap((pair: { errors: string[] }) => pair.errors)).toEqual(expect.arrayContaining(['group_as_individual', 'payment_as_paid_total']));
  });
  it('does not match signing with employment or monthly rates with daily rates', () => {
    const date: RawCandidateV2 = { ...group, kind: 'date', value: '2026年1月1日', quote: '2026年1月1日签订合同', subject: null, scope: 'unknown', meaning: 'contract_signing', completeness: 'not_applicable' };
    const rate: RawCandidateV2 = { ...group, value: '3000元/月', quote: '月工资3000元/月', subject: null, scope: 'unknown', meaning: 'rate', rateUnit: 'month', completeness: 'not_applicable' };
    const score = assess(input, labels([date, rate]), result([{ ...date, meaning: 'employment_period' }, { ...rate, rateUnit: 'day' }]));
    expect(score.metrics.raw_basic.tp).toBe(0);
    expect(score.cases[0].focus_confusions.raw[0].errors).toContain('signing_as_work_or_performance');
  });
  it('does not invent a group/person confusion from two correct facts sharing an amount', () => {
    const payment: RawCandidateV2 = { ...group, quote: '张某班组共3人欠付工资8000元', subject: '张某', scope: 'individual', meaning: 'payment', completeness: 'unknown' };
    const score = assess(input, labels([group, payment]), result([group, payment]));
    expect(score.metrics.accepted_strict).toMatchObject({ tp: 2, fp: 0, fn: 0 });
    expect(score.cases[0].focus_confusions.raw).toEqual([]);
    expect(score.cases[0].focus_confusions.accepted).toEqual([]);
  });
  it('consumes strict matches before attributing errors between same-value same-meaning subjects', () => {
    const other: RawCandidateV2 = { ...group, subject: '张某', scope: 'individual' };
    const score = assess(input, labels([group, other]), result([group, other]));
    expect(score.metrics.accepted_strict).toMatchObject({ tp: 2, fp: 0, fn: 0 });
    expect(score.cases[0].attribute_errors).toEqual([]);
  });
});
