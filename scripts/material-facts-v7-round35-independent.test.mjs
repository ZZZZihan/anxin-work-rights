import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// ROUND35 only: unrelated layout guards and complete currency-only labels.
// Synthetic module/runtime/source review; no scorer, historical CLI or service.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(ROOT, path)));
const { classifyMonetaryExpression } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates, validateCandidateOutput } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const cp = text => Array.from(text).length;
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-source-review.ts'])
  console.log(JSON.stringify({ evidence: 'round35_product', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));

const sourceFor = (texts, pages = texts.map(() => 1)) => ({ id: 'r35-independent', name: 'synthetic.txt', sha256: '5'.repeat(64), ready: true, analysisRevision: 35,
  blocks: texts.map((text, i) => ({ id: 'b' + (i + 1), page: pages[i], text, bbox: null, confidence: null })) });
const candidateFor = (value, quote = value, blockId = 'b1') => ({ kind: 'money', value, quote, blockId, subject: '王甲', scope: 'individual',
  meaning: 'other_money', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' });
function stateFor(source, candidate, historical = false) {
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [candidate] });
  assert.equal(validateCandidateOutput(raw, source).rejected.length, 0, 'The input must pass the real schema before semantic classification.');
  const before = structuredClone(source);
  const state = (historical ? ingestCandidates : ingestRuntimeCandidates)(emptyFactState(35), source, { raw }, 'independent', 'synthetic', '2026-10-19T00:00:00.000Z', null);
  assert.deepEqual(source, before); assert.equal(state.materials[0].raw, raw);
  assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
  return state;
}
function factFor(source, candidate, state) {
  assert.equal(state.materials[0].candidates.length, 1, 'An accepted candidate is distinct from a usable amount.');
  const fact = state.materials[0].candidates[0], text = source.blocks.find(b => b.id === candidate.blockId).text;
  const at = text.indexOf(candidate.quote); assert(at >= 0); assert.equal(text.indexOf(candidate.quote, at + 1), -1);
  assert.deepEqual(fact.representation, candidate); assert.equal(fact.start, cp(text.slice(0, at))); assert.equal(fact.end, fact.start + cp(candidate.quote));
  return fact;
}
function historic(source, candidate, amount) {
  const state = stateFor(source, candidate, true), fact = factFor(source, candidate, state);
  fact.amount = amount; fact.normalization = { rawValue: candidate.value, status: amount === null ? 'unsupported' : 'exact', amount,
    matchedText: candidate.value, span: { start: 0, end: cp(candidate.value) }, reason: 'Unconfirmed synthetic historical state.' };
  const supplied = structuredClone(state), reviewed = reviewFactsAgainstSources(state, [source]);
  assert.deepEqual(state, supplied); assert.equal(reviewed.materials[0].raw, state.materials[0].raw);
  assert.deepEqual(reviewed.confirmations, { due: null, paid: null }); assert.equal(reviewed.calculation, null);
  return factFor(source, candidate, reviewed);
}
function checkAmount(source, candidate, wanted, original = '4000.00') {
  const fresh = factFor(source, candidate, stateFor(source, candidate)), oldExact = historic(source, candidate, original), oldNull = historic(source, candidate, null);
  console.log(JSON.stringify({ evidence: 'round35_layout', source, candidate, fresh, oldExact, oldNull }));
  assert.equal(fresh.amount, wanted); assert.equal(oldExact.amount, wanted); assert.equal(oldNull.amount, null, 'Stored null is never upgraded by source review.');
  // No assertion here equates an exact derived value or candidate acceptance
  // with a proven relationship, confirmation, or calculation authority.
}

for (const text of ['以上事实无争议', '至5000元为李乙工资', '×2是附件编号']) test('an unrelated page cannot append a guard to the first-page wage: ' + text, () => {
  const source = sourceFor(['😀王甲收到工资4000元', text], [1, 2]);
  for (const quote of ['4000元', source.blocks[0].text]) checkAmount(source, candidateFor('4000元', quote), '4000.00');
});
for (const suffix of ['至5000元', '×2', '以上']) test('a genuinely adjacent same-page OCR continuation remains unavailable: ' + suffix, () => {
  const source = sourceFor(['😀王甲收到工资4000元', suffix]);
  checkAmount(source, candidateFor('4000元'), null);
});
for (const value of ['人民币工资', '人民币薪资', '人民幣金额', '￥工资']) test('a complete currency-plus-empty-label is rejected while raw remains: ' + value, () => {
  const classification = classifyMonetaryExpression(value), source = sourceFor(['😀王甲材料：' + value + '。']), candidate = candidateFor(value);
  const state = stateFor(source, candidate);
  console.log(JSON.stringify({ evidence: 'round35_no_amount_label', classification, candidate, material: state.materials[0] }));
  assert.equal(classification.kind, 'not_monetary'); assert.equal(state.materials[0].candidates.length, 0);
  assert.equal(state.materials[0].rejected.length, 1); assert.match(state.materials[0].rejected[0].reason, /没有金额|未表述金额|无金额/u);
});
for (const value of ['人民币工资待定', '人民币金额***']) test('unknown or masked money survives the label gate without a precise amount: ' + value, () => {
  const source = sourceFor(['😀王甲材料：' + value + '。']), candidate = candidateFor(value), state = stateFor(source, candidate);
  const fact = factFor(source, candidate, state); console.log(JSON.stringify({ evidence: 'round35_unknown', source, candidate, fact }));
  assert.notEqual(classifyMonetaryExpression(value).kind, 'not_monetary'); assert.equal(fact.amount, null);
});
test('an explicit currency amount remains accepted with exact original positions', () => {
  const source = sourceFor(['😀王甲收到人民币4000元。']), candidate = candidateFor('人民币4000元');
  checkAmount(source, candidate, '4000.00');
});
test('unstructured subject prose is not forced into a definite no-money label', () => {
  const value = '王甲人民币工资', source = sourceFor(['😀' + value + '。']), candidate = candidateFor(value);
  const fact = factFor(source, candidate, stateFor(source, candidate));
  assert.equal(fact.amount, null); assert.notEqual(classifyMonetaryExpression(value).kind, 'not_monetary');
});
