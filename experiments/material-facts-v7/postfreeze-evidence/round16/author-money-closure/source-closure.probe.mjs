import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const base = resolve(process.env.V7_SOURCE_CLOSURE_ROOT);
const load = file => import(pathToFileURL(resolve(base, 'lib', file)).href);
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates } = await load('material-facts-v3.ts');
const { normalizeMoneyValueV4 } = await load('material-money-v4.ts');
const { reviewFactsAgainstSources } = await load('material-fact-source-review.ts');
for (const file of ['material-money-v4.ts', 'material-fact-source-review.ts'])
  console.log(JSON.stringify({ file, sha256: createHash('sha256').update(await readFile(resolve(base, 'lib', file))).digest('hex') }));
for (const texts of [['王甲工资3万元至4。'], ['王甲工资3万元至\n4。'], ['王甲工资3万元至', '约4。']]) {
  const description = JSON.stringify(texts);
  const source = { id: 'unfinished-range-author-probe', name: 'synthetic unfinished range', sha256: 'e'.repeat(64), ready: true, analysisRevision: 15,
    blocks: texts.map((text, i) => ({ id: 'b' + (i + 1), page: 1, text, bbox: null, confidence: null })) };
  const candidate = { kind: 'money', value: '3万元', quote: '3万元', blockId: 'b1', subject: '王甲', scope: 'individual',
    meaning: 'arrears', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [candidate] });
  test('fresh short quote cannot expose an incomplete range endpoint: ' + description, () => {
    const state = ingestRuntimeCandidates(emptyFactState(15), source, { raw }, 'round15-closure-author', 'synthetic', '2026-10-18T00:00:00Z');
    const amount = state.materials[0].candidates[0].amount;
    console.log(JSON.stringify({ route: 'fresh', texts, actual_amount: amount }));
    assert.equal(state.materials[0].raw, raw); assert.equal(amount, null);
  });
  test('forced exact history is downgraded without rewriting persisted raw state: ' + description, () => {
    const old = ingestCandidates(emptyFactState(15), source, { raw }, 'round15-closure-author', 'synthetic', '2026-10-18T00:00:00Z');
    Object.assign(old.materials[0].candidates[0], { amount: '30000.00', normalization: normalizeMoneyValueV4('3万元') });
    const before = structuredClone(old), reviewed = reviewFactsAgainstSources(old, [source]);
    const amount = reviewed.materials[0].candidates[0].amount;
    console.log(JSON.stringify({ route: 'history', texts, actual_amount: amount }));
    assert.deepEqual(old, before); assert.equal(reviewed.materials[0].raw, raw); assert.equal(amount, null);
  });
}
