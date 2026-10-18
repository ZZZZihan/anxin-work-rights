import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Keep a post-amount monetary bound distinct from the next duration/count.
// This supplements the locked ROUND20 suites without changing their contracts.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(ROOT, path)));
const { normalizeCandidateValueV4: normalize } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates: fresh } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const cp = text => Array.from(text).length;
for (const path of ['lib/material-fact-range-review.ts', 'lib/material-money-v4.ts', 'lib/material-fact-source-review.ts'])
  console.log(JSON.stringify({ evidence: 'round20_bound_duration_hash', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));

function check(tail, expected) {
  const text = '😀𠮷王甲工资四万元' + tail + '。';
  const source = { id: 'round20-bound-duration', name: 'synthetic.txt', sha256: 'f'.repeat(64), analysisRevision: 20,
    ready: true, blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
  for (const quote of ['四万元', text]) {
    const candidate = { kind: 'money', value: '四万元', quote, blockId: 'b1', subject: '王甲', scope: 'individual',
      meaning: 'due_total', completeness: 'complete', period: null, rateUnit: null, assertion: 'narrated' };
    if (quote === text) assert.equal(normalize(candidate).amount, expected, 'full-quote candidate normalizer');
    const raw = JSON.stringify({ schemaVersion: 3, candidates: [candidate] });
    const ingest = fn => fn(emptyFactState(20), source, { raw }, 'independent-bound-duration', 'synthetic', '2026-10-18T09:00:00.000Z', null);
    const verify = state => {
      assert.equal(state.materials[0].raw, raw); assert.equal(state.materials[0].candidates.length, 1);
      const fact = state.materials[0].candidates[0]; assert.deepEqual(fact.representation, candidate);
      const at = text.indexOf(quote); assert.equal(fact.start, cp(text.slice(0, at))); assert.equal(fact.end, fact.start + cp(quote));
      assert.equal(fact.amount, expected); assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
    };
    verify(ingest(fresh));
    const old = ingest(legacy), fact = old.materials[0].candidates[0];
    fact.amount = '40000.00'; fact.normalization = { rawValue: '四万元', status: 'exact', amount: '40000.00', matchedText: '四万元', span: { start: 0, end: 3 }, reason: 'Synthetic prior exact.' };
    const before = structuredClone(old), reviewed = reviewFactsAgainstSources(old, [source]);
    assert.deepEqual(old, before); verify(reviewed);
  }
}

for (const tail of ['不到三天付清', '未满三个月已付清', '不止一次催讨'])
  test('a bound on the next duration/count does not qualify the preceding wage amount: ' + tail, () => check(tail, '40000.00'));
for (const tail of ['不到', '不止', '开外'])
  test('a monetary post-bound without a following time/count still blocks precision: ' + tail, () => check(tail, null));
