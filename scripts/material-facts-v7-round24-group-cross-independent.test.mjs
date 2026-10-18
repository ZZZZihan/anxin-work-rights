import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Four finite integration checks for newly supported traditional roles. The
// currency amount being parseable must not authenticate an individual owner.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(ROOT, path)));
const { ingestRuntimeCandidates } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, buildFactView } = await load('lib/material-facts-v3.ts');
const cp = text => Array.from(text).length;
function facts(subject, following = null) {
  const value = '四萬圓', text = '😀' + subject + '2026年1月全部應付工資合計' + value + '。';
  const source = { id: 'r24-group-cross', name: 'synthetic.txt', sha256: 'c'.repeat(64), analysisRevision: 24, ready: true,
    blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
  if (following) source.blocks.push({ id: 'b2', page: 1, text: following, bbox: null, confidence: null });
  const candidate = { kind: 'money', value, quote: value, blockId: 'b1', subject, scope: 'individual', meaning: 'due_total',
    completeness: 'complete', period: '2026年1月', rateUnit: null, assertion: 'narrated' };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [candidate] });
  const state = ingestRuntimeCandidates(emptyFactState(24), source, { raw }, 'independent', 'synthetic', '2026-10-18T14:00:00.000Z', null);
  assert.equal(state.materials[0].raw, raw); assert.equal(state.materials[0].candidates.length, 1);
  const fact = state.materials[0].candidates[0]; assert.deepEqual(fact.representation, candidate);
  assert.equal(fact.start, cp(text.slice(0, text.indexOf(value)))); assert.equal(fact.end, fact.start + cp(value));
  assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
  assert.equal(buildFactView(state, [source]).canCalculate, false);
  return fact;
}
for (const path of ['lib/material-fact-event-review.ts', 'lib/material-fact-source-review.ts'])
  console.log(JSON.stringify({ evidence: 'round24_group_cross_hash', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));
for (const subject of ['王甲班組', '某單位']) test('a model-provided collective label cannot acquire an individual complete total: ' + subject, () => {
  const fact = facts(subject);
  assert(fact.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'));
});
for (const description of ['全體工人', '多名員工']) test('traditional collective context in another block survives quote cropping: ' + description, () => {
  const fact = facts('王甲', description);
  assert(fact.reviewIssues.some(issue => issue.code === 'scope_text_mismatch'));
});
