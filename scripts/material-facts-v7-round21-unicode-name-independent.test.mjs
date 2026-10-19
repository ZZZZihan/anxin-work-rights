import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Cross-runtime independent boundary regression: a substring of a longer name is not the supplied subject.
// Synthetic literals only; no service, model request, frozen file or confirmation.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(ROOT, path)));
const { normalizeCandidateValueV4: normalize } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates: fresh } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, buildFactView } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const cp = text => Array.from(text).length;
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-currency-review.ts', 'lib/material-fact-source-review.ts'])
  console.log(JSON.stringify({ evidence: 'round20_subject_implementation_hash', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));

function check(text, subject, expected, prefix = '😀𠮷') {
  const source = { id: 'round20-subject', name: 'synthetic.txt', sha256: 'e'.repeat(64), analysisRevision: 20,
    ready: true, blocks: [{ id: 'b1', page: 1, text: prefix + text, bbox: null, confidence: null }] };
  for (const quote of ['四万元', source.blocks[0].text]) {
    const candidate = { kind: 'money', value: '四万元', quote, blockId: 'b1', subject, scope: 'individual',
      meaning: 'due_total', completeness: 'complete', period: null, rateUnit: null, assertion: 'narrated' };
    // The candidate-only API has context when the full quote was supplied.
    if (quote === source.blocks[0].text) assert.equal(normalize(candidate).amount, expected, 'complete-quote normalizer');
    const raw = JSON.stringify({ schemaVersion: 3, candidates: [candidate] });
    const ingest = fn => fn(emptyFactState(20), source, { raw }, 'round20-subject', 'synthetic', '2026-10-18T09:00:00.000Z', null);
    const verify = state => {
      assert.equal(state.materials[0].raw, raw); assert.equal(state.materials[0].candidates.length, 1);
      const fact = state.materials[0].candidates[0]; assert.deepEqual(fact.representation, candidate);
      const at = source.blocks[0].text.indexOf(quote);
      assert.equal(fact.start, cp(source.blocks[0].text.slice(0, at))); assert.equal(fact.end, fact.start + cp(quote));
      assert.equal(fact.amount, expected); assert.equal(buildFactView(state, [source]).canCalculate, false);
      assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
    };
    verify(ingest(fresh));
    const old = ingest(legacy), fact = old.materials[0].candidates[0];
    fact.amount = '40000.00'; fact.normalization = { rawValue: candidate.value, status: 'exact', amount: '40000.00',
      matchedText: candidate.value, span: { start: 0, end: cp(candidate.value) }, reason: 'Synthetic unsafe historical exact.' };
    const before = structuredClone(old), reviewed = reviewFactsAgainstSources(old, [source]);
    assert.deepEqual(old, before); verify(reviewed);
  }
}


console.log(JSON.stringify({ evidence: 'unicode_boundary_runtime', version: process.version, icu: process.versions.icu, classEnd: /[\p{L}\p{N}]$/u.test('😀𠮷'), alternationEnd: /(?:\p{L}|\p{N})$/u.test('😀𠮷'), han: /\p{Script=Han}/u.test('𠮷') }));
for (const [subject, text] of [['王美元', '王美元工资四万元。'], ['李港元', '李港元工资四万元。']]) {
  test('a supplementary Han directly before the proposed subject makes it a longer name substring: ' + subject, () => check(text, subject, null));
  test('an explicit clause boundary preserves a complete narrow subject and code-point positions: ' + subject, () => check(text, subject, '40000.00', '😀𠮷。'));
}
