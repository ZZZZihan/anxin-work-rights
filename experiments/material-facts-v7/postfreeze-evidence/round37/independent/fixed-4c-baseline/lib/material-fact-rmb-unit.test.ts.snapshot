import { describe, expect, it } from 'vitest';
import type { FactSource } from './material-fact-types';
import type { FactCandidateV3, RawCandidateV3 } from './material-fact-types-v3';
import { reviewFactsAgainstSources } from './material-fact-source-review';
import { applyFactAction, buildFactView, emptyFactState, ingestCandidates } from './material-facts-v3';

const actor = 'synthetic-unit-review', at = '2026-10-18T02:30:00.000Z';
function fixture(literal: string, value: string, meaning: 'due_total' | 'paid_total' | 'rate' | 'other_money' = 'due_total', prefix = '') {
  const role = { due_total: '完整应付工资合计', paid_total: '完整已付工资合计', rate: '月薪', other_money: '交通补贴' }[meaning];
  const year = value === '0' ? '1999' : '2024', period = `${year}年7月`;
  const source: FactSource = { id: 'unit-source', name: '合成币种缺失材料', sha256: 'd'.repeat(64), analysisRevision: 1, ready: true,
    blocks: [{ id: 'b1', page: 1, text: `${prefix}😀王甲${period}${role}${literal}。`, bbox: null, confidence: null }] };
  const representation: RawCandidateV3 = { kind: 'money', value, quote: value, blockId: 'b1', subject: '王甲', scope: 'individual', meaning,
    completeness: meaning.endsWith('_total') ? 'complete' : 'not_applicable', period, rateUnit: meaning === 'rate' ? 'month' : null, assertion: 'narrated' };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [representation] });
  let state = ingestCandidates(emptyFactState(1), source, { raw }, 'synthetic', actor, at);
  state = applyFactAction(state, { action: 'confirm_scope', scope: { worker: '王甲', employer: '合成单位', start: `${year}-07-01`, end: `${year}-07-31` }, note: '独立核实范围', verified: true }, [source], actor, at);
  expect(state.materials[0].candidates).toHaveLength(1);
  expect(state.materials[0].candidates[0].amount).not.toBeNull();
  return { source, state, raw, representation };
}

describe('explicit RMB evidence at the anchored runtime amount', () => {
  it.each(['8000', '0', '8,000.00', '8000万'])('does not turn a unitless literal %s into an RMB total', value => {
    const { source, state, raw, representation } = fixture(value, value);
    expect(buildFactView(state, [source]).fields.due.values).toHaveLength(1);
    const reviewed = reviewFactsAgainstSources(state, [source]);
    const candidate = reviewed.materials[0].candidates[0] as FactCandidateV3;
    expect(candidate.amount).toBeNull();
    expect(candidate.normalization.status).toBe('unsupported');
    expect(candidate.normalization.reason).toContain('人民币');
    expect(candidate.representation).toEqual(representation);
    expect(reviewed.materials[0].raw).toBe(raw);
    expect(buildFactView(reviewed, [source]).fields.due.values).toEqual([]);
    expect(reviewFactsAgainstSources(reviewed, [source])).toEqual(reviewed);
  });

  it.each(['paid_total', 'rate', 'other_money'] as const)('also withholds precision for unitless %s', meaning => {
    const { source, state } = fixture('8000', '8000', meaning);
    expect(reviewFactsAgainstSources(state, [source]).materials[0].candidates[0].amount).toBeNull();
  });

  it.each(['金额单位：人民币。', '另一工人本次工资100元，', '币种RMB\n'])('does not borrow a currency declaration from another clause: %s', prefix => {
    const { source, state } = fixture('8000', '8000', 'due_total', prefix);
    expect(reviewFactsAgainstSources(state, [source]).materials[0].candidates[0].amount).toBeNull();
  });

  it.each([
    ['8000元', '8000'], ['8000圆', '8000'], ['人民币8000', '8000'], ['¥8000', '8000'], ['￥8000', '8000'],
    ['CNY8000', '8000'], ['8000 RMB', '8000'], ['8000ＲＭＢ', '8000'], ['8000人民币', '8000'],
    ['人民币8000元', '人民币8000元'], ['¥8000', '¥8000'], ['捌仟元整', '捌仟元整'],
  ])('retains exact precision with an attached RMB marker: %s / %s', (literal, value) => {
    const { source, state } = fixture(literal, value);
    const reviewed = reviewFactsAgainstSources(state, [source]);
    expect(reviewed.materials[0].candidates[0].amount).toBe('8000.00');
    expect(buildFactView(reviewed, [source]).fields.due.values).toEqual(['8000.00']);
  });

  it.each(['JP¥8000', 'J.P.¥8000', 'JP￥8000'])('does not mistake a cropped regional yen symbol for RMB: %s', literal => {
    const value = literal.slice(literal.indexOf(literal.includes('￥') ? '￥' : '¥'));
    const { source, state } = fixture(literal, value);
    expect(reviewFactsAgainstSources(state, [source]).materials[0].candidates[0].amount).toBeNull();
  });

  it.each([
    ['USD\u200B¥8000', '¥8000'], ['JP\u200B¥8000', '¥8000'], ['JP\u2060¥8000', '¥8000'],
    ['JP\u200F¥8000', '¥8000'], ['8000\u200BUSD', '8000'], ['8000元\u200B港币', '8000元'],
    ['US\u200DD¥8000', '¥8000'], ['JP\uFEFF￥8000', '￥8000'],
  ])('does not let invisible format characters hide a foreign currency: %s', (literal, value) => {
    const { source, state } = fixture(literal, value);
    const candidate = reviewFactsAgainstSources(state, [source]).materials[0].candidates[0] as FactCandidateV3;
    expect(candidate.amount).toBeNull();
    expect(candidate.normalization.status).toBe('unsupported');
  });

  it.each(['元旦', '元宵', '元年', '元月', '元素', '元件', '元音', '圆满'].flatMap(word => ['8000', `8000${word[0]}`].map(value => ({ word, value }))))('does not borrow a unit from the word $word with value=$value', ({ word, value }) => {
    const { source, state } = fixture(`8000${word}发放`, value);
    expect(reviewFactsAgainstSources(state, [source]).materials[0].candidates[0].amount).toBeNull();
  });
});
