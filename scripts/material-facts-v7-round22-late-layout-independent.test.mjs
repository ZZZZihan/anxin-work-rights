import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Independent right-endpoint checks for newly enabled literals. A quote stays
// inside one original block even when an explicit range crosses OCR layout.
const root = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(root, path)));
const { ingestRuntimeCandidates: fresh } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, buildFactView } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources: review } = await load('lib/material-fact-source-review.ts');
const { hasMoneyRange } = await load('lib/material-fact-range-review.ts');
const cp = value => Array.from(value).length;
function fixture(texts, value, extras = {}) {
  const source = { id: 'late409-layout', name: 'synthetic.txt', sha256: 'e'.repeat(64), analysisRevision: 22, ready: true,
    blocks: texts.map((text, i) => ({ id: 'b' + (i + 1), page: 1, text, bbox: null, confidence: null })) };
  const candidate = { kind: 'money', value, quote: value, blockId: 'b2', subject: '王甲', scope: 'individual', meaning: 'due_total',
    completeness: 'complete', period: null, rateUnit: null, assertion: 'narrated', ...extras };
  return { source, candidate };
}
function observed(source, candidate, stored) {
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [candidate] });
  const state = (stored ? legacy : fresh)(emptyFactState(22), source, { raw }, 'independent-layout', 'synthetic', '2026-10-18T13:00:00.000Z', null);
  assert.equal(state.materials[0].raw, raw); assert.equal(state.materials[0].candidates.length, 1);
  assert.equal(state.calculation, null); assert.deepEqual(state.confirmations, { due: null, paid: null });
  assert.equal(buildFactView(state, [source]).canCalculate, false);
  const fact = state.materials[0].candidates[0], block = source.blocks.find(item => item.id === candidate.blockId);
  const at = block.text.indexOf(candidate.quote); assert(at >= 0); assert.equal(block.text.indexOf(candidate.quote, at + 1), -1);
  assert.deepEqual(fact.representation, candidate); assert.equal(fact.start, cp(block.text.slice(0, at))); assert.equal(fact.end, fact.start + cp(candidate.quote));
  return state;
}
function check(texts, value, oldAmount, expected, extras = {}) {
  const { source, candidate } = fixture(texts, value, extras);
  const block = source.blocks.find(item => item.id === candidate.blockId);
  for (const quote of new Set([value, block.text])) {
    const rawCandidate = { ...candidate, quote };
    assert.equal(observed(source, rawCandidate, false).materials[0].candidates[0].amount, expected);
    const state = observed(source, rawCandidate, true), fact = state.materials[0].candidates[0];
    fact.amount = oldAmount; fact.normalization = { rawValue: value, status: 'exact', amount: oldAmount,
      matchedText: value, span: { start: 0, end: cp(value) }, reason: 'Synthetic stored exact amount, never authorization.' };
    const before = structuredClone(state), result = review(state, [source]);
    assert.deepEqual(state, before); assert.equal(result.materials[0].raw, state.materials[0].raw);
    assert.equal(result.materials[0].candidates[0].amount, expected);
  }
}
for (const [left, right, old] of [['人民币5角', '人民币8角', '0.80'], ['人民币2分', '8分', '0.08'], ['人民币5角', '8角', '0.80']])
  test('a right endpoint cannot become an exact amount by moving into its own block: ' + left + '至' + right, () => {
    assert.equal(hasMoneyRange(left + '至\n' + right), true);
    check(['😀𠮷。王甲工资' + left + '至', right + '。'], right, old, null);
  });
test('the traditional right endpoint remains part of the same cross-block range', () => {
  check(['😀𠮷。王甲工资三萬圓至', '兩億圓。'], '兩億圓', '200000000.00', null);
});
test('a following block can continue the same literal with another subunit', () => {
  check(['😀𠮷。王甲工资人民币5角', '2分。'], '人民币5角', '0.50', null, { blockId: 'b1' });
});
test('a complete sentence and a different owner do not form a monetary range', () => {
  assert.equal(hasMoneyRange('人民币5角。\n李乙收到人民币8角。'), false);
  check(['😀𠮷。王甲工资人民币5角。', '李乙收到人民币8角。'], '人民币8角', '0.80', '0.80', { subject: '李乙' });
});
test('an explicit duration is not a subunit range endpoint', () => {
  assert.equal(hasMoneyRange('人民币5角至\n4个月'), false);
  const { source, candidate } = fixture(['😀𠮷。', '王甲工资人民币5角至4个月后付清。'], '人民币5角');
  check(source.blocks.map(item => item.text), candidate.value, '0.50', '0.50');
});
test('an explicitly represented supported monthly rate keeps the new RMB subunit amount', () => {
  check(['😀𠮷。', '王甲工资人民币5角/月。'], '人民币5角', '0.50', '0.50', { meaning: 'rate', completeness: 'not_applicable', rateUnit: 'month' });
});
