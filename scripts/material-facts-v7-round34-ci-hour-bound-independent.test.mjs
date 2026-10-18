import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = name => import(pathToFileURL(resolve(ROOT, 'lib', name)));
const { normalizeMoneyValueV4 } = await load('material-money-v4.ts');
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates, validateCandidateOutput } = await load('material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('material-fact-source-review.ts');
const cp = text => Array.from(text).length;

// Additional regression controls: these were already null in fixed 1cc. They are
// separate from the locked eight tests and are not claimed as original CI red.
for (const bound of ['以上', '以下']) test('traditional hourly denominator followed by ' + bound + ' never becomes an exact hour rate', () => {
  const expression = '4000元/小時' + bound, text = '😀王甲工资' + expression + '。';
  const source = { id: 'r34-hour-bound', name: 'synthetic.txt', sha256: 'c'.repeat(64), ready: true, analysisRevision: 34,
    blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
  const direct = normalizeMoneyValueV4(expression); assert.equal(direct.amount, null); assert.notEqual(direct.status, 'exact');
  for (const value of ['4000元', expression]) for (const quote of [value, text]) {
    const candidate = { kind: 'money', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'rate',
      completeness: 'not_applicable', period: null, rateUnit: 'hour', assertion: 'narrated' };
    const raw = JSON.stringify({ schemaVersion: 3, candidates: [candidate] });
    assert.equal(validateCandidateOutput(raw, source).rejected.length, 0);
    const states = [];
    for (const amount of [undefined, '4000.00', null]) {
      let state = (amount === undefined ? ingestRuntimeCandidates : ingestCandidates)(emptyFactState(34), source, { raw }, 'independent', 'synthetic', '2026-10-19T00:00:00.000Z', null);
      assert.equal(state.materials[0].candidates.length, 1);
      if (amount !== undefined) {
        const f = state.materials[0].candidates[0]; f.amount = amount;
        f.normalization = { rawValue: value, status: amount === null ? 'unsupported' : 'exact', amount, matchedText: value,
          span: { start: 0, end: cp(value) }, reason: 'Unconfirmed synthetic history.' };
        const supplied = state, before = structuredClone(state); state = reviewFactsAgainstSources(state, [source]); assert.deepEqual(supplied, before);
      }
      const fact = state.materials[0].candidates[0];
      assert.equal(fact.amount, null); assert.notEqual(fact.normalization.status, 'exact');
      assert.deepEqual(fact.representation, candidate); assert.equal(state.materials[0].raw, raw);
      assert.equal(fact.start, cp(text.slice(0, text.indexOf(quote)))); assert.equal(fact.end, fact.start + cp(quote));
      assert.equal(state.calculation, null); assert.deepEqual(state.confirmations, { due: null, paid: null }); states.push(fact);
    }
    console.log(JSON.stringify({ evidence: 'round34_traditional_hour_bound', source, candidate, raw, direct, states }));
  }
});
