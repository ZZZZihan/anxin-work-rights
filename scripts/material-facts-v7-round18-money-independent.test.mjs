import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Finite independent contracts for ROUND18. Synthetic source text only.
// No service, frozen case, model request or confirmation is created.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(ROOT, path)));
const { normalizeMoneyValueV4: money, normalizeCandidateValueV4: normalize } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates: fresh } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, buildFactView } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const { assessCase } = await load('experiments/material-facts-v7/assess.mjs');
const cp = text => Array.from(text).length;
const sourceFor = text => ({ id: 'round18-independent', name: 'synthetic-round18.txt', sha256: 'd'.repeat(64), analysisRevision: 18,
  ready: true, blocks: [{ id: 'b1', page: 1, text: '😀𠮷' + text, bbox: null, confidence: null }] });
const entry = (value, quote = value, changes = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲',
  scope: 'individual', meaning: 'due_total', completeness: 'complete', period: null, rateUnit: null, assertion: 'narrated', ...changes });
const raw = candidates => JSON.stringify({ schemaVersion: 3, candidates });
function ingest(source, candidates, historical = false) {
  const text = raw(candidates), state = (historical ? legacy : fresh)(emptyFactState(18), source, { raw: text }, 'round18-independent', 'synthetic', '2026-10-18T09:00:00.000Z', null);
  assert.equal(state.materials[0].raw, text); assert.deepEqual(JSON.parse(text).candidates, candidates);
  assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
  assert.equal(buildFactView(state, [source]).canCalculate, false);
  return state;
}
function stored(source, candidate, state) {
  assert.equal(state.materials[0].candidates.length, 1, 'Candidate accepted is distinct from its amount being available.');
  const fact = state.materials[0].candidates[0]; assert.deepEqual(fact.representation, candidate);
  const text = source.blocks[0].text, at = text.indexOf(candidate.quote);
  assert(at >= 0); assert.equal(text.indexOf(candidate.quote, at + 1), -1);
  assert.equal(fact.start, cp(text.slice(0, at))); assert.equal(fact.end, cp(text.slice(0, at)) + cp(candidate.quote));
  return fact;
}
function historicalReview(source, candidate, amount) {
  const old = ingest(source, [candidate], true), fact = stored(source, candidate, old);
  fact.amount = amount; fact.normalization = { rawValue: candidate.value, status: 'exact', amount, matchedText: candidate.value,
    span: { start: 0, end: cp(candidate.value) }, reason: 'Synthetic unsafe exact historical amount.' };
  const before = structuredClone(old), reviewed = reviewFactsAgainstSources(old, [source]);
  assert.deepEqual(old, before); assert.equal(reviewed.materials[0].raw, raw([candidate]));
  return stored(source, candidate, reviewed);
}
function sourceAmounts(text, value, historicalAmount, changes = {}) {
  const source = sourceFor(text), result = {};
  for (const [name, quote] of [['short', value], ['full', source.blocks[0].text]]) {
    const candidate = entry(value, quote, changes);
    result['fresh_' + name] = stored(source, candidate, ingest(source, [candidate])).amount;
    result['history_' + name] = historicalReview(source, candidate, historicalAmount).amount;
  }
  return result;
}
const amountsEqual = (observed, expected) => assert.deepEqual(observed, Object.fromEntries(Object.keys(observed).map(key => [key, expected])));
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-currency-review.ts', 'lib/material-fact-source-review.ts',
  'lib/material-fact-runtime-ingest.ts', 'experiments/material-facts-v7/assess.mjs'])
  console.log(JSON.stringify({ evidence: 'round18_implementation_hash', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));

for (const text of ['王甲港幣工資40000圓。', '王甲港幣薪資40000圓。', '王甲港幣勞動報酬40000圓。',
  '王甲港幣工 資40000圓。', '王甲工資40000圓以港幣支付。', '王甲工資40000圓按港幣計價。'])
  test('traditional foreign currency remains unavailable after quote/value cropping and historical display: ' + text,
    () => amountsEqual(sourceAmounts(text, '40000圓', '40000.00'), null));
for (const text of ['王甲工資人民幣40000圓。', '李乙港幣工資30000圓。王甲工資40000圓。',
  '王甲工資40000圓。李乙港幣工資30000圓。', '李乙港幣工資30000圓\n王甲工資40000圓。'])
  test('RMB and separate traditional wage events retain their own exact amount: ' + text,
    () => amountsEqual(sourceAmounts(text, '40000圓', '40000.00'), '40000.00'));

const ratePrefixes = [['月工資', 'month'], ['每月工資', 'month'], ['月薪標準', 'month'], ['日工資標準', 'day'],
  ['每小時工資', 'hour'], ['小時工資', 'hour'], ['時薪標準', 'hour'], ['每日基本工資', 'day']];
for (const [prefix, unit] of ratePrefixes) {
  test('traditional wage rate cannot be represented by an exact due_total: ' + prefix,
    () => amountsEqual(sourceAmounts('王甲' + prefix + '40000圓。', '40000圓', '40000.00'), null));
  test('the same traditional wage rate with correct attributes stays available: ' + prefix,
    () => amountsEqual(sourceAmounts('王甲' + prefix + '40000圓。', '40000圓', '40000.00',
      { meaning: 'rate', completeness: 'not_applicable', rateUnit: unit }), '40000.00'));
}
for (const [text, changes] of [['王甲2024年3月工資40000圓。', { period: '2024年3月' }],
  ['王甲本月工資40000圓。', { period: '本月' }], ['王甲當日工資合計40000圓。', { period: '當日' }]])
  test('a traditional calendar or relative period remains a wage total: ' + text,
    () => amountsEqual(sourceAmounts(text, '40000圓', '40000.00', changes), '40000.00'));
test('traditional subject spelling cannot masquerade as a relative calendar prefix', () =>
  amountsEqual(sourceAmounts('王當月工資40000圓。', '40000圓', '40000.00', { subject: '王當' }), null));

for (const [value, amount] of [['五元5角', '5.50'], ['五元5角2分', '5.52'], ['五元五角2分', '5.52'],
  ['五元零5分', '5.05'], ['十二元5角2分', '12.52'], ['伍元5角2分', '5.52']])
  test('explicit Chinese yuan with single Arabic subunit digits parses without altering raw evidence: ' + value, () => {
    const parsed = money(value); assert.equal(parsed.amount, amount); assert.equal(parsed.status, 'exact');
    amountsEqual(sourceAmounts('王甲工資' + value + '。', value, amount), amount);
  });
for (const [value, amount] of [['五元五角二分', '5.52'], ['5元5角2分', '5.52'], ['五元5角工资', '5.50']])
  test('existing all-Chinese/all-Arabic and a real wage noun remain exact: ' + value,
    () => assert.equal(money(value).amount, amount));
for (const value of ['五元55角', '五元5角22分', '五元0.5角'])
  test('unsupported precision is not silently truncated to a single subunit: ' + value,
    () => assert.equal(money(value).amount, null));
test('cropping Chinese yuan out of mixed subunits cannot discard the omitted cents', () =>
  amountsEqual(sourceAmounts('王甲工資五元5角2分。', '五元', '5.00'), null));
test('a genuine mixed fen amount followed by 之后 remains exact', () =>
  amountsEqual(sourceAmounts('王甲工資五元5分之后支付。', '五元5分', '5.05'), '5.05'));
test('new parsing never upgrades an unsupported historical extraction', () => {
  const source = sourceFor('王甲工資五元5角。'), candidate = entry('五元5角'), old = ingest(source, [candidate], true);
  const fact = stored(source, candidate, old); fact.amount = null;
  fact.normalization = { rawValue: candidate.value, status: 'unsupported', amount: null, matchedText: null, span: null, reason: 'Synthetic historical unsupported.' };
  const before = structuredClone(old), reviewed = reviewFactsAgainstSources(old, [source]);
  assert.deepEqual(old, before); assert.equal(stored(source, candidate, reviewed).amount, null);
});

for (const unit of ['年', '周', '週', '季度', '次']) {
  test('an unsupported explicit /unit cannot expose its rate operand as due_total: ' + unit, () => {
    const candidate = entry('40000圓', '王甲工資40000圓/' + unit + '。');
    const observed = { quote: normalize(candidate).amount, ...sourceAmounts(candidate.quote, candidate.value, '40000.00') };
    amountsEqual(observed, null);
  });
  test('rate/unknown does not pretend that the unsupported /unit is represented: ' + unit, () =>
    amountsEqual(sourceAmounts('王甲工資40000圓/' + unit + '。', '40000圓', '40000.00',
      { meaning: 'rate', completeness: 'not_applicable', rateUnit: 'unknown' }), null));
}
for (const [unit, rateUnit] of [['月', 'month'], ['日', 'day'], ['小时', 'hour'], ['件', 'piece']])
  test('supported suffix rates still distinguish a wrong total from the correct rate: ' + unit, () => {
    amountsEqual(sourceAmounts('王甲工资40000元/' + unit + '。', '40000元', '40000.00'), null);
    amountsEqual(sourceAmounts('王甲工资40000元/' + unit + '。', '40000元', '40000.00',
      { meaning: 'rate', completeness: 'not_applicable', rateUnit }), '40000.00');
  });
test('another event with a yearly rate does not taint an independently stated wage total', () =>
  amountsEqual(sourceAmounts('李乙工資30000圓/年。王甲工資40000圓。', '40000圓', '40000.00'), '40000.00'));

test('equal mixed-subunit amounts at two source events remain two facts and two TPs at all six layers', () => {
  const q1 = '王甲第一笔工資五元5角。', q2 = '王甲第二笔工資5元五角。', source = sourceFor(q1 + q2);
  const candidates = [entry('五元5角', q1), entry('5元五角', q2)], state = ingest(source, candidates);
  assert.equal(state.materials[0].candidates.length, 2); assert.equal(state.materials[0].rejected.length, 0);
  assert.deepEqual(state.materials[0].candidates.map(fact => fact.amount), ['5.50', '5.50']);
  const expected = candidates.map(candidate => ({ ...candidate })), text = source.blocks[0].text;
  const anchors = candidates.map(candidate => { const at = text.indexOf(candidate.value); return { blockId: 'b1', start: cp(text.slice(0, at)), end: cp(text.slice(0, at)) + cp(candidate.value) }; });
  const input = { id: 'round18-score', source }, label = { id: input.id, schemaVersion: 3, label_status: 'provisional_non_expert', expected,
    events: anchors.map((anchor, i) => ({ id: 'e' + i, anchors: [anchor] })), expected_event_ids: ['e0', 'e1'], acceptable_alternatives: [] };
  const result = { id: input.id, finish_reason: 'stop', raw_output: raw(candidates) }, before = structuredClone({ input, label, result });
  const row = assessCase(input, label, result);
  for (const layer of ['raw', 'accepted']) for (const mode of ['basic', 'relational', 'strict']) {
    const metric = row[layer + '_' + mode]; assert.deepEqual([metric.tp, metric.fp, metric.fn], [2, 0, 0]);
  }
  assert.deepEqual({ input, label, result }, before); assert(row.production_defense.every(item => item.calculation_authorized === false));
});
