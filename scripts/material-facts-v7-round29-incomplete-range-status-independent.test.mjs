import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(root, path)));
const { ingestRuntimeCandidates } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');

test('the existing incomplete -2000 endpoint keeps uncertain status, including source and historical display', () => {
  const text = '测试王甲工资4000元-2000。';
  const source = { id: 'round29-incomplete-range', name: 'synthetic.txt', sha256: '7'.repeat(64), analysisRevision: 29, ready: true,
    blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
  for (const quote of ['4000元', text]) {
    const candidate = { kind: 'money', value: '4000元', quote, blockId: 'b1', subject: '测试王甲', scope: 'individual', meaning: 'due_total',
      completeness: 'complete', period: null, rateUnit: null, assertion: 'narrated' };
    const raw = JSON.stringify({ schemaVersion: 3, candidates: [candidate] });
    const get = state => {
      assert.equal(state.materials[0].raw, raw); assert.equal(state.materials[0].candidates.length, 1);
      const fact = state.materials[0].candidates[0]; assert.deepEqual(fact.representation, candidate);
      assert.equal(fact.start, Array.from(text.slice(0, text.indexOf(quote))).length);
      assert.equal(fact.end, fact.start + Array.from(quote).length);
      assert.equal(state.calculation, null); assert.deepEqual(state.confirmations, { due: null, paid: null });
      return fact;
    };
    const fresh = ingestRuntimeCandidates(emptyFactState(29), source, { raw }, 'independent', 'synthetic', '2026-10-18T22:00:00.000Z', null);
    assert.equal(get(fresh).amount, null); assert.equal(get(fresh).normalization.status, 'uncertain', quote);
    for (const stored of [{ amount: '4000.00', status: 'exact' }, { amount: null, status: 'unsupported' }]) {
      const old = ingestCandidates(emptyFactState(29), source, { raw }, 'independent', 'synthetic', '2026-10-18T22:00:00.000Z', null);
      const fact = get(old); fact.amount = stored.amount;
      fact.normalization = { rawValue: candidate.value, amount: stored.amount, status: stored.status, matchedText: candidate.value,
        span: { start: 0, end: Array.from(candidate.value).length }, reason: 'Synthetic unconfirmed stored value.' };
      const before = structuredClone(old), reviewed = reviewFactsAgainstSources(old, [source]); assert.deepEqual(old, before);
      assert.equal(get(reviewed).amount, null);
      assert.equal(get(reviewed).normalization.status, stored.amount === null ? 'unsupported' : 'uncertain');
    }
  }
});
