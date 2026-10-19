import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Existing foreign-currency guards must survive the new layout boundary. This
// finite supplement preserves the original 26 tests and their earlier logs.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = file => import(pathToFileURL(resolve(ROOT, file)));
const { ingestRuntimeCandidates } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates, validateCandidateOutput, buildFactView } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const cp = value => Array.from(value).length;

test('a whole ending cannot selectively discard previously guarded foreign currency on the same page', () => {
  const failures = [];
  for (const currency of ['美元', '港元', 'EUR', 'JPY', 'HKD']) for (const terminal of ['整', '正']) for (const samePage of [true, false]) {
    const first = `😀王甲工资4000元${terminal}`;
    const source = { id: 'r35-currency-continuation', name: 'synthetic.txt', sha256: 'c'.repeat(64), ready: true, analysisRevision: 35,
      blocks: [{ id: 'b1', page: 1, text: first, bbox: null, confidence: null },
        { id: 'b2', page: samePage ? 1 : 2, text: currency, bbox: null, confidence: null }] };
    for (const quote of ['4000元', first]) {
      const item = { kind: 'money', value: '4000元', quote, blockId: 'b1', subject: '王甲', scope: 'individual',
        meaning: 'other_money', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
      const raw = JSON.stringify({ schemaVersion: 3, candidates: [item] });
      assert.equal(validateCandidateOutput(raw, source).rejected.length, 0);
      for (const history of [null, 'exact', 'unsupported']) {
        const initial = (history ? ingestCandidates : ingestRuntimeCandidates)(emptyFactState(35), source, { raw }, 'independent', 'synthetic', '2026-10-19T00:00:00.000Z', null);
        assert.equal(initial.materials[0].candidates.length, 1);
        if (history) {
          const fact = initial.materials[0].candidates[0], amount = history === 'exact' ? '4000.00' : null;
          fact.amount = amount; fact.normalization = { rawValue: item.value, status: history, amount,
            matchedText: item.value, span: { start: 0, end: cp(item.value) }, reason: 'Synthetic historical value.' };
        }
        const untouched = structuredClone({ initial, source });
        const state = history ? reviewFactsAgainstSources(initial, [source]) : initial;
        assert.deepEqual({ initial, source }, untouched);
        const material = state.materials[0], fact = material.candidates[0];
        assert.equal(material.raw, raw); assert.deepEqual(fact.representation, item);
        assert.equal(fact.start, cp(first.slice(0, first.indexOf(quote)))); assert.equal(fact.end, fact.start + cp(quote));
        assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
        assert.equal(buildFactView(state, [source]).canCalculate, false);
        const wanted = history === 'unsupported' || samePage ? null : '4000.00';
        const observation = { currency, terminal, samePage, quote, history: history ?? 'fresh', wanted,
          amount: fact.amount, status: fact.normalization.status, issues: fact.reviewIssues };
        console.log(JSON.stringify({ evidence: 'round35_currency_continuation', observation }));
        if (fact.amount !== wanted) failures.push(observation);
      }
    }
  }
  assert.deepEqual(failures, [], 'Same-page foreign markers deny precision; another page does not compose an amount, and old null stays null.');
});
