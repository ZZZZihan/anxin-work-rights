import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Two finite intersections with explicit RMB subunits. No scorer, history CLI,
// HTTP, model or build. Existing stored extractions are reviewed, not erased.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = file => import(pathToFileURL(resolve(ROOT, file)));
const { normalizeMoneyValueV4: money } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates: fresh } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, validateCandidateOutput } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources: review } = await load('lib/material-fact-source-review.ts');
const cp = value => Array.from(value).length;
const sourceFor = texts => ({ id: 'round32-angle-cross', name: 'synthetic.txt', sha256: '2'.repeat(64), analysisRevision: 32,
  ready: true, blocks: (Array.isArray(texts) ? texts : [texts]).map((text, index) => ({ id: 'b' + (index + 1), page: 1, text, bbox: null, confidence: null })) });
const candidate = (value, quote = value) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual',
  meaning: 'other_money', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' });
function ingest(source, item, old = false) {
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [item] });
  assert.equal(validateCandidateOutput(raw, source).rejected.length, 0, 'The fixture must pass the frozen structural schema.');
  const before = structuredClone(source);
  const state = (old ? legacy : fresh)(emptyFactState(32), source, { raw }, 'independent', 'synthetic', '2026-10-18T23:10:00.000Z', null);
  assert.deepEqual(source, before); assert.equal(state.materials[0].raw, raw);
  assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
  for (const fact of state.materials[0].candidates) {
    assert.deepEqual(fact.representation, item);
    const text = source.blocks.find(block => block.id === item.blockId).text;
    const at = text.indexOf(item.quote); assert(at >= 0);
    assert.equal(fact.start, cp(text.slice(0, at))); assert.equal(fact.end, fact.start + cp(item.quote));
  }
  return state;
}
function historical(source, item, amount, status) {
  const state = ingest(source, item, true); assert.equal(state.materials[0].candidates.length, 1);
  const fact = state.materials[0].candidates[0]; fact.amount = amount;
  fact.normalization = { rawValue: item.value, status, amount, matchedText: item.value,
    span: { start: 0, end: cp(item.value) }, reason: 'Synthetic stored state, never confirmed.' };
  const before = structuredClone(state), result = review(state, [source]); assert.deepEqual(state, before);
  assert.equal(result.materials[0].raw, state.materials[0].raw); return result.materials[0].candidates[0];
}
test('an explicit RMB prefix cannot turn a complete angle noun into an exact subunit amount', () => {
  const value = '人民币五角星', normalized = money(value), source = sourceFor('😀王甲画了人民币五角星。');
  const state = ingest(source, candidate(value));
  const control = money('人民币五角钱');
  console.log(JSON.stringify({ evidence: 'round32_angle_whole', normalized, state, control }));
  assert.equal(normalized.rawValue, value); assert.equal(normalized.amount, null);
  for (const fact of state.materials[0].candidates) assert.equal(fact.amount, null);
  assert.equal(control.amount, '0.50', 'The ordinary noun boundary must preserve genuine subunit money.');
});
test('cropping 星 from explicit RMB subunits cannot retain .50 through source review or stored review', () => {
  const observations = [];
  for (const source of [sourceFor('😀王甲画了人民币五角星。'), sourceFor(['😀王甲画了人民币五角', '星。'])]) {
    for (const quote of ['人民币五角', source.blocks[0].text]) {
      const item = candidate('人民币五角', quote), state = ingest(source, item);
      assert.equal(state.materials[0].candidates.length, 1);
      observations.push({ source, item, fresh: state.materials[0].candidates[0],
        storedExact: historical(source, item, '0.50', 'exact'), storedNull: historical(source, item, null, 'unsupported') });
    }
  }
  console.log(JSON.stringify({ evidence: 'round32_angle_cropped', observations }));
  for (const observed of observations) {
    assert.equal(observed.fresh.amount, null); assert.equal(observed.storedExact.amount, null);
    assert.equal(observed.storedNull.amount, null, 'A stored null must not be upgraded on read.');
  }
});
