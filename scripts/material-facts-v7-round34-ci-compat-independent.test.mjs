import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// CI compatibility only: the separate original ROUND34 18-test script stays frozen.
// No scorer, historical CLI, HTTP, build or model is invoked.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(ROOT, path)));
const { ingestRuntimeCandidates } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates, validateCandidateOutput } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const cp = text => Array.from(text).length;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-source-review.ts'])
  console.log(JSON.stringify({ evidence: 'round34_ci_compat_product', path, sha256: sha(await readFile(resolve(ROOT, path))) }));

function fixture(suffix, rate = false) {
  const text = '😀王甲2026年1月完整应付工资合计4000元' + suffix;
  const source = { id: 'r34-ci-compat', name: 'synthetic.txt', sha256: 'b'.repeat(64), analysisRevision: 34, ready: true,
    blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
  const candidate = { kind: 'money', value: '4000元', quote: '4000元', blockId: 'b1', subject: '王甲', scope: 'individual',
    meaning: rate ? 'rate' : 'due_total', completeness: rate ? 'not_applicable' : 'complete',
    period: rate ? null : '2026年1月', rateUnit: rate ? 'month' : null, assertion: 'narrated' };
  return { source, candidate, raw: JSON.stringify({ schemaVersion: 3, candidates: [candidate] }) };
}
function derive(f, oldAmount) {
  const beforeSource = structuredClone(f.source), checked = validateCandidateOutput(f.raw, f.source);
  assert.equal(checked.rejected.length, 0, 'All fixtures must pass the real structural contract.');
  let state = (oldAmount === undefined ? ingestRuntimeCandidates : ingestCandidates)(emptyFactState(34), f.source,
    { raw: f.raw }, 'independent', 'synthetic', '2026-10-19T00:00:00.000Z', null);
  assert.equal(state.materials[0].candidates.length, 1, 'Acceptance does not establish a usable amount.');
  if (oldAmount !== undefined) {
    const stored = state.materials[0].candidates[0]; stored.amount = oldAmount;
    stored.normalization = { rawValue: f.candidate.value, status: oldAmount === null ? 'unsupported' : 'exact', amount: oldAmount,
      matchedText: f.candidate.value, span: { start: 0, end: cp(f.candidate.value) }, reason: 'Unconfirmed synthetic stored state.' };
    const suppliedState = state, beforeState = structuredClone(state); state = reviewFactsAgainstSources(state, [f.source]);
    assert.deepEqual(suppliedState, beforeState, 'Source review must not mutate the stored input state.');
  }
  assert.deepEqual(f.source, beforeSource); assert.equal(state.materials[0].raw, f.raw);
  assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
  const fact = state.materials[0].candidates[0], at = f.source.blocks[0].text.indexOf(f.candidate.quote);
  assert.deepEqual(fact.representation, f.candidate); assert.equal(fact.start, cp(f.source.blocks[0].text.slice(0, at)));
  assert.equal(fact.end, fact.start + cp(f.candidate.quote)); return fact;
}
function pipeline(suffix, rate, wanted, status = null, relationRequired = false) {
  const f = fixture(suffix, rate), fresh = derive(f), oldExact = derive(f, '4000.00'), oldNull = derive(f, null);
  console.log(JSON.stringify({ evidence: 'round34_ci_compat_case', source: f.source, candidate: f.candidate, raw: f.raw,
    fresh, oldExact, oldNull }));
  for (const fact of [fresh, oldExact]) {
    assert.equal(fact.amount, wanted);
    if (status) assert.equal(fact.normalization.status, status);
    if (wanted === null) assert.notEqual(fact.normalization.status, 'exact');
    if (relationRequired) assert(fact.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), 'The newline fragment remains unresolved and cannot authorize a usable fact.');
  }
  assert.equal(oldNull.amount, null, 'Read-only review never upgrades a stored null.');
}

test('a bare 每月 on the next line does not become the preceding total rate, and keeps a relation warning', () => {
  pipeline('\n每月', false, '4000.00', 'exact', true);
});
test('a slash explicitly continued onto the next line makes a total role mismatch', () => {
  pipeline('/\n月。', false, null, 'rate_unit_mismatch');
});
test('the same explicit slash continuation permits the declared month rate only', () => {
  pipeline('/\n月。', true, '4000.00');
});
test('a next-line 月亮 cannot borrow 月 for the total role', () => {
  pipeline('/\n月亮。', false, null);
});
test('a next-line 月亮 cannot borrow the declared month rate enum', () => {
  pipeline('/\n月亮。', true, null);
});
test('a finite bound after a supported slash denominator still identifies the total rate mismatch', () => {
  pipeline('/月以上。', false, null, 'rate_unit_mismatch');
});
test('a finite bound after a supported slash denominator cannot become an exact month rate', () => {
  pipeline('/月以上。', true, null);
});
test('same-line 每月 remains an explicit rate and cannot become a total', () => {
  pipeline('每月。', false, null, 'rate_unit_mismatch');
  pipeline('每月。', true, '4000.00');
});
