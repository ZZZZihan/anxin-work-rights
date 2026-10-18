import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The existing assessor's public synthetic blocks omit optional layout metadata.
// Exercise the same runtime path directly; do not run a scorer or reinterpret a
// swallowed source-review exception as a reduced accepted false-positive count.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const { validateRuntimeCandidateOutput } = await import(pathToFileURL(resolve(ROOT, 'lib/material-fact-runtime-ingest.ts')));
test('absent OCR boxes do not turn a valid wrong-event candidate into a protocol exception', () => {
  const quote = '发放105.7万元。';
  const source = { id: 'r35-optional-layout', name: 'synthetic.txt', sha256: '8'.repeat(64), ready: true, analysisRevision: 35,
    blocks: [{ id: 'b1', page: 1, text: '第一笔：' + quote }, { id: 'b2', page: 1, text: '第二笔：' + quote }] };
  const candidate = { kind: 'money', value: '105.7万元', quote, blockId: 'b1', subject: null, scope: 'unknown',
    meaning: 'payment', completeness: 'partial', period: null, rateUnit: null, assertion: 'narrated' };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [candidate] }), before = structuredClone(source);
  const batch = validateRuntimeCandidateOutput(raw, source);
  assert.deepEqual(source, before); assert.equal(batch.candidates.length, 1); assert.equal(batch.rejected.length, 0);
  const fact = batch.candidates[0]; assert.deepEqual(fact.representation, candidate);
  assert.equal(fact.blockId, 'b1'); assert.equal(fact.start, Array.from('第一笔：').length);
  assert.equal(fact.end - fact.start, Array.from(quote).length);
  console.log(JSON.stringify({ evidence: 'round35_optional_layout', source, candidate, fact }));
});
