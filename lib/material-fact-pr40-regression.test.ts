import { describe, expect, it } from 'vitest';
import type { FactSource } from './material-fact-types';
import type { FactCandidateV3, RawCandidateV3 } from './material-fact-types-v3';
import { applyFactAction, buildFactView, emptyFactState, ingestCandidates } from './material-facts-v3';
import { reviewFactsAgainstSources } from './material-fact-source-review';

const rawCandidate = (patch: Partial<RawCandidateV3> = {}): RawCandidateV3 => ({ kind: 'money', value: '8000元', quote: '8000元', blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'due_total', completeness: 'complete', period: '2024年7月', rateUnit: null, assertion: 'narrated', ...patch });
function fixture(text: string, patch: Partial<RawCandidateV3> = {}) {
  const source: FactSource = { id: 'pr40', name: '合成安全回归', sha256: 'a'.repeat(64), ready: true, analysisRevision: 1, blocks: [{ id: 'b1', text, page: 1, bbox: null, confidence: null }] };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [rawCandidate(patch)] });
  let state = ingestCandidates(emptyFactState(1), source, { raw }, 'synthetic', 'owner', '2026-10-18T00:00:00Z');
  expect(state.materials[0].candidates).toHaveLength(1);
  state = applyFactAction(state, { action: 'confirm_scope', scope: { worker: '王甲', employer: '甲公司', start: '2024-07-01', end: '2024-07-31' }, note: '合成主体核对', verified: true }, [source], 'owner', '2026-10-18T00:00:00Z');
  const original = structuredClone(state);
  const reviewed = reviewFactsAgainstSources(state, [source]);
  expect(state).toEqual(original);
  expect(reviewed.materials[0].raw).toBe(raw);
  expect((reviewed.materials[0].candidates[0] as FactCandidateV3).representation).toEqual(rawCandidate(patch));
  return { source, original, reviewed, view: buildFactView(reviewed, [source]) };
}

describe('PR40 anchored relationship and completeness regression', () => {
  it.each([
    '王甲2024年7月在甲公司工作。李乙2024年8月完整应付工资8000元。',
    '王甲2024年8月完整应付工资8000元。2024年7月另案处理。',
    '王甲2024年7月负责登记李乙完整应付工资8000元。',
    '王甲代表李乙2024年7月完整应付工资8000元。',
    '王甲2024年7月完整应付工资6000元和李乙2024年8月完整应付工资8000元。',
    '王甲2024年7月及2024年8月完整应付工资8000元。',
    '王甲乙2024年7月完整应付工资8000元。另记王甲。',
    '王甲2024年7月至2024年8月完整应付工资8000元。',
  ])('refuses a spliced or ambiguous subject-period-amount relationship: %s', text => {
    const { view } = fixture(text);
    expect(view.fields.due.values).toEqual([]);
    expect(view.fields.due.status).toBe('unknown');
    expect(view.canCalculate).toBe(false);
  });
  it.each(['，', '\n', '；', '。'])('cannot lose a governing group cue across %s', separator => {
    const { view } = fixture(`王甲班组共10人${separator}2024年7月完整应付工资8000元。`);
    expect(view.fields.due.values).toEqual([]);
  });
  it.each(['以下金额均为班组汇总。', '以下金额仅含基本工资。'])('retains a governing header beyond a different worker row: %s', header => {
    const { view } = fixture(`${header}李乙2024年8月完整应付工资9000元。王甲2024年7月完整应付工资8000元。`);
    expect(view.fields.due.values).toEqual([]);
  });
  it.each(['部分', '仅部分', '本次', '此次', '暂计', '首批', '第一笔'])('does not promote a source %s due amount to a complete total', cue => {
    const { view } = fixture(`王甲2024年7月${cue}应付工资8000元。`);
    expect(view.fields.due.values).toEqual([]);
  });
  it.each(['，仅为部分应付', '，以上为班组合计', '\n该金额为部分应付'])('checks following qualification outside a cropped quote: %s', tail => {
    const { view } = fixture(`王甲2024年7月完整应付工资8000元${tail}。`);
    expect(view.fields.due.values).toEqual([]);
  });
  it.each(['王甲2024年7月完整应付工资8000元。', '王甲在甲公司2024年7月应付工资合计8000元。', '王甲一人2024年7月应付工资总额8000元。'])('retains an explicitly associated complete personal total: %s', text => {
    const { view } = fixture(text);
    expect(view.fields.due.values).toEqual(['8000.00']);
    expect(view.canCalculate).toBe(false);
  });
  it('does not turn a plain payment or arrears into a complete due total', () => {
    for (const role of ['支付', '拖欠', '欠付', '赔偿', '月薪', '拟支付']) {
      const { view } = fixture(`王甲2024年7月${role}8000元。`);
      expect(view.fields.due.values).toEqual([]);
    }
  });
});
