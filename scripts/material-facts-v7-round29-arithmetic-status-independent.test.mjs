import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Five concrete post-baa8bebb findings. Only synthetic raw candidates and stored
// states are used; an accepted amount never grants calculation authority.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(ROOT, path)));
const { normalizeMoneyValueV4: money } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates: fresh } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, buildFactView } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const { assessCase } = await load('experiments/material-facts-v7/assess.mjs');
const cp = text => Array.from(text).length;
const rawFor = candidates => JSON.stringify({ schemaVersion: 3, candidates });
const sourceFor = texts => ({ id: 'round29-independent', name: 'synthetic.txt', sha256: '7'.repeat(64), analysisRevision: 29, ready: true,
  blocks: (Array.isArray(texts) ? texts : [texts]).map((text, index) => ({ id: 'b' + (index + 1), page: 1, text, bbox: null, confidence: null })) });
const entry = (value, quote = value, extra = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual',
  meaning: 'other_money', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated', ...extra });
function stateFor(source, candidates, old = false) {
  const raw = rawFor(candidates), state = (old ? legacy : fresh)(emptyFactState(29), source, { raw }, 'independent', 'synthetic', '2026-10-18T21:00:00.000Z', null);
  assert.equal(state.materials[0].raw, raw); assert.deepEqual(state.confirmations, { due: null, paid: null });
  assert.equal(state.calculation, null); assert.equal(buildFactView(state, [source]).canCalculate, false);
  return state;
}
function factFor(source, item, state) {
  assert.equal(state.materials[0].candidates.length, 1, 'Retaining a review candidate does not make its amount usable.');
  const fact = state.materials[0].candidates[0], text = source.blocks.find(block => block.id === item.blockId).text;
  const at = text.indexOf(item.quote); assert(at >= 0); assert.equal(text.indexOf(item.quote, at + 1), -1);
  assert.deepEqual(fact.representation, item); assert.equal(fact.start, cp(text.slice(0, at))); assert.equal(fact.end, fact.start + cp(item.quote));
  return fact;
}
function historical(source, item, amount, status) {
  const state = stateFor(source, [item], true), fact = factFor(source, item, state);
  fact.amount = amount;
  fact.normalization = { rawValue: item.value, status, amount, matchedText: item.value, span: { start: 0, end: cp(item.value) }, reason: 'Synthetic stored candidate, never confirmed.' };
  const before = structuredClone(state), reviewed = reviewFactsAgainstSources(state, [source]);
  assert.deepEqual(state, before); assert.equal(reviewed.materials[0].raw, rawFor([item]));
  return factFor(source, item, reviewed);
}
function moneyObservations(source, value = '4000元', extra = {}, storedAmount = '4000.00') {
  const rows = [], block = source.blocks.find(item => item.text.includes(value));
  assert(block);
  for (const quote of [value, block.text]) {
    const item = entry(value, quote, { ...extra, blockId: block.id });
    rows.push({ fresh: factFor(source, item, stateFor(source, [item])), storedExact: historical(source, item, storedAmount, 'exact'),
      storedUnavailable: historical(source, item, null, 'unsupported') });
  }
  return rows;
}
function checkMoney(rows, amount) {
  for (const row of rows) {
    assert.equal(row.fresh.amount, amount); assert.equal(row.storedExact.amount, amount);
    assert.equal(row.storedUnavailable.amount, null, 'Reviewing old unavailable money must not upgrade it.');
  }
}
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-range-review.ts', 'lib/material-fact-source-review.ts',
  'lib/material-fact-event-review.ts', 'lib/material-fact-currency-review.ts', 'experiments/material-facts-v7/assess.mjs'])
  console.log(JSON.stringify({ evidence: 'round29_implementation', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));



// Exact existing status contract: an explicit arithmetic operand is unsupported,
// even when the same x/×/* character also belongs to masked-value syntax.
test('cropped explicit operators keep unsupported arithmetic status rather than becoming an unknown amount', () => {
  for (const expression of ['×2','＊２','x2','\n×2','×\n2']) {
    const source=sourceFor('😀王甲工资4000元'+expression+'。');
    for(const quote of ['4000元',source.blocks[0].text]) {
      const item=entry('4000元',quote),fact=factFor(source,item,stateFor(source,[item]));
      assert.equal(fact.amount,null);
      assert.equal(fact.normalization.status,'unsupported',expression+' / '+quote);
    }
  }
});
