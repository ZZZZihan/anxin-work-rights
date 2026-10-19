import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const { canonicalMonetaryExpression: canonical } = await import(pathToFileURL(resolve(ROOT, 'lib/material-money-v4.ts')));
const { assessCase } = await import(pathToFileURL(resolve(ROOT, 'experiments/material-facts-v7/assess.mjs')));
const { ingestRuntimeCandidates } = await import(pathToFileURL(resolve(ROOT, 'lib/material-fact-runtime-ingest.ts')));
const { emptyFactState } = await import(pathToFileURL(resolve(ROOT, 'lib/material-facts-v3.ts')));
const cp = text => Array.from(text).length;
function check(base, value, wanted) {
  const text = '😀𠮷。王甲工资' + value + '。', at = text.indexOf(base), start = cp(text.slice(0, at));
  const entry = value => ({ kind: 'money', value, quote: text, blockId: 'b1', subject: '王甲', scope: 'individual',
    meaning: 'due_total', completeness: 'complete', period: null, rateUnit: null, assertion: 'narrated' });
  const source = { id: 'round22-cross', name: 'synthetic.txt', sha256: 'f'.repeat(64), analysisRevision: 22, ready: true,
    blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
  const candidate = entry(value), input = { id: 'round22-cross', source };
  const label = { expected: [entry(base)], events: [{ id: 'e', anchors: [{ blockId: 'b1', start, end: start + cp(base) }] }], expected_event_ids: ['e'] };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [candidate] });
  const before = structuredClone({ input, label, candidate });
  const state = ingestRuntimeCandidates(emptyFactState(22), source, { raw }, 'round22-cross', 'synthetic', '2026-10-18T12:00:00.000Z', null);
  assert.equal(state.materials[0].raw, raw); assert.equal(state.materials[0].candidates.length, 1);
  const stored = state.materials[0].candidates[0]; assert.deepEqual(stored.representation, candidate);
  assert.equal(stored.start, 0); assert.equal(stored.end, cp(text)); assert.equal(stored.amount, null);
  assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
  const row = assessCase(input, label, { finish_reason: 'stop', raw_output: raw });
  for (const layer of ['raw', 'accepted']) for (const mode of ['basic', 'relational', 'strict'])
    assert.deepEqual([row[layer + '_' + mode].tp, row[layer + '_' + mode].fp, row[layer + '_' + mode].fn], wanted);
  assert(row.production_defense.every(fact => fact.amount === null && !fact.calculation_authorized));
  assert.deepEqual({ input, label, candidate }, before);
}
for (const suffix of ['工資', '勞務費', '勞動報酬']) test('a finite traditional noun preserves a qualified amount key and six-layer event match: ' + suffix, () => {
  const base = '不滿四萬元', value = base + suffix;
  assert(canonical(base)); assert.equal(canonical(value), canonical(base));
  check(base, value, [1, 0, 0]);
});
test('a postposed qualified amount retains the same key through a traditional noun wrapper', () => {
  const base = '四萬元開外', value = base + '工資';
  assert(canonical(base)); assert.equal(canonical(value), canonical(base));
  check(base, value, [1, 0, 0]);
});
test('a traditional noun prefix followed by arbitrary narrative is not a finite wrapper', () => {
  const base = '不滿四萬元', value = base + '工資明細';
  assert.notEqual(canonical(value), canonical(base));
  check(base, value, [0, 1, 1]);
});
