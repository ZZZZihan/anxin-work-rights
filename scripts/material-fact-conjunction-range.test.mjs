import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMoneyValueV4, normalizeCandidateValueV4 } from '../lib/material-money-v4.ts';
import { ingestRuntimeCandidates } from '../lib/material-fact-runtime-ingest.ts';
import { emptyFactState, buildFactView } from '../lib/material-facts-v3.ts';
import { reviewFactsAgainstSources } from '../lib/material-fact-source-review.ts';

const source = text => ({ id: 'range-source', name: 'synthetic.txt', sha256: 'a'.repeat(64), analysisRevision: 1, ready: true,
  blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] });
const entry = (value, quote) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual',
  meaning: 'due_total', completeness: 'complete', period: '2024年7月', rateUnit: null, assertion: 'narrated' });
const ingest = (src, candidate) => {
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [candidate] });
  const state = ingestRuntimeCandidates(emptyFactState(1), src, { raw }, 'synthetic', 'owner', '2026-10-18T00:00:00Z', null);
  assert.equal(state.materials[0].raw, raw); assert.deepEqual(state.materials[0].candidates[0].representation, candidate);
  return state;
};
const expressions = [
  ['在3万元和4万元之间', ['3万元', '4万元']], ['介于3万元与4万元', ['3万元', '4万元']],
  ['三万元与四万元之间', ['三万元', '四万元']], ['介于人民币30000元和人民币40000元之间', ['30000元', '40000元']],
  ['在3万和4万元之间', ['4万元']], ['在3万元和4万元之内', ['3万元', '4万元']], ['介于3万元及4万元之间', ['3万元', '4万元']],
  ['在3万元\n和4万元之间', ['3万元', '4万元']], ['介于3万元与\n4万元之间', ['3万元', '4万元']],
  ['在3万元和\u200d4万元之\u200d间', ['3万元', '4万元']], ['介于30000元与４万元之间', ['30000元']],
];
for (const [expression, values] of expressions) {
  test(`whole range cannot select an endpoint: ${expression}`, () => {
    const parsed = normalizeMoneyValueV4(expression); assert.equal(parsed.amount, null); assert.equal(parsed.status, 'range');
    assert.equal(parsed.rawValue, expression);
  });
  for (const value of values) {
    test(`source endpoint stays unavailable after both crops: ${expression} / ${value}`, () => {
      const text = `😀王甲2024年7月完整应付工资${expression}。`, src = source(text), candidate = entry(value, value);
      const state = ingest(src, candidate), actual = state.materials[0].candidates[0];
      assert.equal(actual.amount, null); assert.notEqual(actual.normalization.status, 'exact');
      assert.equal(actual.start, Array.from(text.slice(0, text.indexOf(value))).length);
      assert.equal(buildFactView(state, [src]).canCalculate, false);
      assert.equal(normalizeCandidateValueV4(entry(value, text)).amount, null);
    });
    test(`persisted exact endpoint is downgraded without rewriting evidence: ${expression} / ${value}`, () => {
      const text = `王甲2024年7月完整应付工资${expression}。`, src = source(text), state = ingest(src, entry(value, value));
      const actual = state.materials[0].candidates[0]; actual.amount = '30000.00';
      actual.normalization = { rawValue: value, status: 'exact', amount: '30000.00', matchedText: value, span: { start: 0, end: Array.from(value).length }, reason: 'Synthetic old exact state' };
      const before = structuredClone(state), reviewed = reviewFactsAgainstSources(state, [src]);
      assert.equal(reviewed.materials[0].candidates[0].amount, null); assert.deepEqual(state, before);
      assert.equal(reviewed.materials[0].raw, before.materials[0].raw);
    });
  }
}
for (const tail of ['和李乙的4万元', '和4万元分别支付', '。另一项介于5万元与6万元之间', '\n李乙工资在4万元和5万元之间']) {
  test(`an independent amount/list cannot lend a range to this wage: ${tail}`, () => {
    const text = `王甲2024年7月应付工资3万元${tail}。`, src = source(text);
    assert.equal(ingest(src, entry('3万元', '3万元')).materials[0].candidates[0].amount, '30000.00');
  });
}
test('a range split over adjacent OCR blocks retains the endpoint guard', () => {
  const src = source('王甲2024年7月应付工资在3万元');
  src.blocks.push({ id: 'b2', page: 1, text: '和4万元之间', bbox: null, confidence: null });
  assert.equal(ingest(src, entry('3万元', '3万元')).materials[0].candidates[0].amount, null);
});
