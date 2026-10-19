import { describe, expect, it } from 'vitest';
// @ts-expect-error The evaluation entry point is also directly runnable by Node.
import { assess } from '../experiments/material-facts-v6/assess.mjs';
import type { RawCandidateV3 } from './material-fact-types-v3';

const source = { id: 'synthetic', name: '合成评分回归', sha256: 'a'.repeat(64), analysisRevision: 1, ready: true,
  blocks: [{ id: 'b1', page: 1, text: '张某班组共3人欠付工资8000元。2026年1月预支张某500元。2026年1月1日签订合同，月工资3000元/月。', bbox: null, confidence: null }] };
const group: RawCandidateV3 = { kind: 'money', value: '8000元', quote: '张某班组共3人欠付工资8000元', blockId: 'b1', subject: '张某班组', scope: 'group', meaning: 'arrears', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
const input = [{ id: 'test', source }];
const result = (candidates: unknown[], finish = 'stop', fenced = false) => [{ id: 'test', finish_reason: finish, raw_output: `${fenced ? '```json\n' : ''}${JSON.stringify({ schemaVersion: 3, candidates })}${fenced ? '\n```' : ''}` }];
const labels = (expected: RawCandidateV3[]) => [{ id: 'test', expected }];

describe('independent v6 scoring safeguards', () => {
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
    const duplicate = assess(input, labels([group]), result([group, group]));
    expect(duplicate.metrics.raw_strict).toMatchObject({ tp: 1, fp: 1, fn: 0 });
    expect(duplicate.metrics.accepted_strict).toMatchObject({ tp: 1, fp: 0, fn: 0 });
    expect(duplicate.rejected_candidates).toBe(1);
    const incomplete = assess(input, labels([group]), result([group], 'length'));
    expect(incomplete.metrics.accepted_strict).toMatchObject({ tp: 0, fp: 0, fn: 1 });
    expect(incomplete.cases[0].coverage).toBeNull();
    expect(incomplete.cases[0].normalization).toEqual([]);
    expect(assess(input, labels([group]), []).metrics.accepted_strict.fn).toBe(1);
  });
  it('measures group/person and single/complete payment errors separately from literal amounts', () => {
    const payment: RawCandidateV3 = { ...group, value: '500元', quote: '2026年1月预支张某500元', subject: '张某', scope: 'individual', meaning: 'payment', completeness: 'partial', period: '2026年1月' };
    const score = assess(input, labels([group, payment]), result([{ ...group, subject: '张某', scope: 'individual' }, { ...payment, meaning: 'paid_total', completeness: 'complete' }]));
    expect(score.metrics.accepted_basic.tp).toBe(1);
    expect(score.metrics.accepted_strict.tp).toBe(0);
    expect(score.cases[0].focus_confusions.accepted.flatMap((pair: { errors: string[] }) => pair.errors)).toEqual(expect.arrayContaining(['group_as_individual', 'payment_as_paid_total']));
  });
  it('does not match signing with employment or monthly rates with daily rates', () => {
    const date: RawCandidateV3 = { ...group, kind: 'date', value: '2026年1月1日', quote: '2026年1月1日签订合同', subject: null, scope: 'unknown', meaning: 'contract_signing', completeness: 'not_applicable' };
    const rate: RawCandidateV3 = { ...group, value: '3000元/月', quote: '月工资3000元/月', subject: null, scope: 'unknown', meaning: 'rate', rateUnit: 'month', completeness: 'not_applicable' };
    const score = assess(input, labels([date, rate]), result([{ ...date, meaning: 'employment_period' }, { ...rate, rateUnit: 'day' }]));
    expect(score.metrics.raw_basic.tp).toBe(0);
    expect(score.cases[0].focus_confusions.raw[0].errors).toContain('signing_as_work_or_performance');
  });
  it('does not invent a group/person confusion from two correct facts sharing an amount', () => {
    const payment: RawCandidateV3 = { ...group, quote: '张某班组共3人欠付工资8000元', subject: '张某', scope: 'individual', meaning: 'payment', completeness: 'unknown' };
    const score = assess(input, labels([group, payment]), result([group, payment]));
    expect(score.metrics.accepted_strict).toMatchObject({ tp: 2, fp: 0, fn: 0 });
    expect(score.cases[0].focus_confusions.raw).toEqual([]);
    expect(score.cases[0].focus_confusions.accepted).toEqual([]);
  });
  it('consumes strict matches before attributing errors between same-value same-meaning subjects', () => {
    const other: RawCandidateV3 = { ...group, subject: '张某', scope: 'individual' };
    const score = assess(input, labels([group, other]), result([group, other]));
    expect(score.metrics.accepted_strict).toMatchObject({ tp: 2, fp: 0, fn: 0 });
    expect(score.cases[0].attribute_errors).toEqual([]);
  });
  it('keeps assertion errors separate from relational correctness', () => {
    const score = assess(input, labels([group]), result([{ ...group, assertion: 'claimed' }]));
    expect(score.metrics.accepted_relational).toMatchObject({ tp: 1, fp: 0, fn: 0 });
    expect(score.metrics.accepted_strict).toMatchObject({ tp: 0, fp: 1, fn: 1 });
  });
  it('does not call a partial paid_total a complete-payment confusion', () => {
    const payment: RawCandidateV3 = { ...group, meaning:'payment', completeness:'partial' };
    const score = assess(input, labels([payment]), result([{...payment,meaning:'paid_total'}]));
    const errors = score.cases[0].focus_confusions.raw.flatMap((p: {errors:string[]})=>p.errors);
    expect(errors).toContain('payment_as_paid_total');
    expect(errors).not.toContain('partial_as_complete_paid');
  });
  it('keeps an empty extraction in recall and records the coverage warning', () => {
    const score=assess(input,labels([group]),result([]));
    expect(score.protocol_valid).toBe(1);
    expect(score.metrics.accepted_strict).toMatchObject({tp:0,fp:0,fn:1});
    expect(score.cases[0].coverage.status).toBe('empty');
  });
  it('separates same-value quote ambiguity from semantic matching', () => {
    const repeatedSource = { ...source, blocks:[{...source.blocks[0],text:'张某欠付工资8000元。经核对张某欠付工资8000元。'}] };
    const expected = {...group,scope:'individual',subject:'张某',quote:'张某欠付工资8000元'};
    const actual = {...expected,quote:repeatedSource.blocks[0].text};
    const score = assess([{id:'test',source:repeatedSource}],labels([expected as RawCandidateV3]),result([actual]));
    expect(score.metrics.accepted_strict).toMatchObject({tp:1,fp:0,fn:0});
    expect(score.cases[0].normalization[0].status).toBe('uncertain');
  });
  it('does not match an exact number to a gold amount retaining an approximate qualifier', () => {
    const approximateSource = {...source,blocks:[{...source.blocks[0],text:'张某欠付工资约8000元。'}]};
    const expected = {...group,scope:'individual',subject:'张某',value:'约8000元',quote:'张某欠付工资约8000元'};
    const score = assess([{id:'test',source:approximateSource}],labels([expected as RawCandidateV3]),result([{...expected,value:'8000元'}]));
    expect(score.metrics.accepted_basic).toMatchObject({tp:0,fp:1,fn:1});
    expect(score.cases[0].normalization[0].status).toBe('approximate');
  });

});
