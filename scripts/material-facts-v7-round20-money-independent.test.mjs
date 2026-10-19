import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Finite independent contracts for ROUND20. Synthetic source text only.
// No service, frozen case, model request or confirmation is created.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(ROOT, path)));
const { normalizeMoneyValueV4: money, normalizeCandidateValueV4: normalize } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates: fresh } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, buildFactView } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const { assessCase } = await load('experiments/material-facts-v7/assess.mjs');
const cp = text => Array.from(text).length;
const sourceFor = text => ({ id: 'round20-independent', name: 'synthetic-round20.txt', sha256: 'd'.repeat(64), analysisRevision: 20,
  ready: true, blocks: [{ id: 'b1', page: 1, text: '😀𠮷。' + text, bbox: null, confidence: null }] });
const entry = (value, quote = value, changes = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲',
  scope: 'individual', meaning: 'due_total', completeness: 'complete', period: null, rateUnit: null, assertion: 'narrated', ...changes });
const raw = candidates => JSON.stringify({ schemaVersion: 3, candidates });
function ingest(source, candidates, historical = false) {
  const text = raw(candidates), state = (historical ? legacy : fresh)(emptyFactState(20), source, { raw: text }, 'round20-independent', 'synthetic', '2026-10-18T09:00:00.000Z', null);
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
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-arithmetic-review.ts', 'lib/material-fact-range-review.ts',
  'lib/material-fact-currency-review.ts', 'lib/material-fact-source-review.ts', 'lib/material-fact-runtime-ingest.ts', 'experiments/material-facts-v7/assess.mjs'])
  console.log(JSON.stringify({ evidence: 'round20_implementation_hash', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));

for (const suffix of ['不到', '不止', '开外', '開外', '\n不到'])
  test('a postposed boundary never becomes a precise full/cropped amount: ' + JSON.stringify(suffix), () => {
    const value = '四万元' + suffix;
    assert.equal(money(value).amount, null);
    assert.equal(normalize(entry('四万元', '王甲工资' + value + '。')).amount, null);
    amountsEqual(sourceAmounts('王甲工资' + value + '。', '四万元', '40000.00'), null);
  });
for (const suffix of ['不到', '不止', '开外'])
  test('an explicit postposed boundary in the adjacent block cannot be removed by clipping the quote: ' + suffix, () => {
    const source = sourceFor('王甲工资四万元');
    source.blocks.push({ id: 'b2', page: 1, text: suffix + '。', bbox: null, confidence: null });
    const candidate = entry('四万元');
    assert.equal(stored(source, candidate, ingest(source, [candidate])).amount, null);
    assert.equal(historicalReview(source, candidate, '40000.00').amount, null);
  });
for (const text of ['王甲工资四万元。李乙到岗不到三个月。', '王甲工资四万元，李乙工资不止三万元。',
  '王甲工资四万元。开外另计费用。'])
  test('another event or sentence with a boundary word does not taint an independently stated exact amount: ' + text, () =>
    amountsEqual(sourceAmounts(text, '四万元', '40000.00'), '40000.00'));

for (const operand of ['提成比例', '社保缴费比例', '奖金系数', '奖\n金系数'])
  test('an explicit operator with a bounded named proportion/coefficient is not a result amount: ' + JSON.stringify(operand), () => {
    const expression = '四万元乘以' + operand;
    assert.equal(money(expression).amount, null); assert.equal(normalize(entry('四万元', expression)).amount, null);
    amountsEqual(sourceAmounts('王甲工资' + expression + '。', '四万元', '40000.00'), null);
  });
for (const operator of ['×', '除以', '加上'])
  test('equivalent explicit operators do not expose a base next to an unlisted coefficient: ' + operator, () =>
    amountsEqual(sourceAmounts('王甲工资四万元' + operator + '奖金系数。', '四万元', '40000.00'), null));
for (const text of ['王甲工资四万元。李乙乘以提成比例核算。', '王甲工资四万元，按奖金系数另核算。'])
  test('independent prose about a named coefficient cannot attach across punctuation: ' + text, () =>
    amountsEqual(sourceAmounts(text, '四万元', '40000.00'), '40000.00'));

for (const [value, amount] of [['人民幣四萬圓', '40000.00'], ['四萬元', '40000.00'], ['肆萬圓', '40000.00'], ['五萬元5角', '50000.50']])
  test('traditional 萬 parses only on a detection/parsing copy with untouched literal and CP evidence: ' + value, () => {
    const normalized = money(value); assert.equal(normalized.status, 'exact'); assert.equal(normalized.amount, amount);
    assert.equal(normalized.rawValue, value); assert(normalized.span);
    assert.equal(Array.from(value).slice(normalized.span.start, normalized.span.end).join(''), normalized.matchedText);
    amountsEqual(sourceAmounts('王甲工資' + value + '。', value, amount), amount);
  });
test('traditional 萬 with an explicit foreign currency is still not converted to RMB', () =>
  amountsEqual(sourceAmounts('王甲港幣工資四萬圓。', '四萬圓', '40000.00'), null));
test('traditional 萬 does not make an omitted lower place or cropped subunit available', () =>
  amountsEqual(sourceAmounts('王甲工資四萬五千圓。', '四萬', '40000.00'), null));
test('new traditional numeral parsing does not upgrade old unsupported history', () => {
  const source = sourceFor('王甲工資四萬圓。'), candidate = entry('四萬圓'), old = ingest(source, [candidate], true);
  const fact = stored(source, candidate, old); fact.amount = null;
  fact.normalization = { rawValue: candidate.value, status: 'unsupported', amount: null, matchedText: null, span: null, reason: 'Historical unsupported remains unchanged until re-extraction.' };
  const before = structuredClone(old), reviewed = reviewFactsAgainstSources(old, [source]); assert.deepEqual(old, before);
  assert.equal(stored(source, candidate, reviewed).amount, null);
});

for (const [whole, crop] of [['二元论', '二元'], ['二元論', '二元'], ['三元催化器', '三元']]) {
  test('an ordinary yuan compound has no exact amount in its complete value: ' + whole, () => {
    assert.equal(money(whole).amount, null);
    const source = sourceFor('王甲资料记载' + whole + '。'), candidate = entry(whole), state = ingest(source, [candidate]);
    assert(state.materials[0].candidates.every(fact => fact.amount === null));
  });
  test('cropping a yuan compound cannot invent a currency unit in source/history: ' + whole, () =>
    amountsEqual(sourceAmounts('王甲资料记载' + whole + '。', crop, crop.startsWith('二') ? '2.00' : '3.00'), null));
}
test('an ordinary yuan compound continued in the next block still guards the clipped token', () => {
  const source = sourceFor('王甲资料记载三元');
  source.blocks.push({ id: 'b2', page: 1, text: '催化器。', bbox: null, confidence: null });
  const candidate = entry('三元');
  assert.equal(stored(source, candidate, ingest(source, [candidate])).amount, null);
  assert.equal(historicalReview(source, candidate, '3.00').amount, null);
});
for (const text of ['王甲工资二元。', '王甲工资三元。', '王甲组装费五元。'])
  test('a genuine yuan amount remains exact beside ordinary wage/payment nouns: ' + text, () => {
    const value = text.includes('二元') ? '二元' : text.includes('三元') ? '三元' : '五元';
    const amount = value === '二元' ? '2.00' : value === '三元' ? '3.00' : '5.00';
    amountsEqual(sourceAmounts(text, value, amount), amount);
  });
for (const [subject, text] of [['王美元', '王美元工资四万元。'], ['李港元', '李港元工资四万元。'],
  ['王美元', '王美元工資人民幣四萬元。']])
  test('a uniquely anchored subject name is not the foreign denomination of its wage: ' + subject + ' / ' + text, () => {
    const value = text.includes('四萬元') ? '四萬元' : '四万元';
    amountsEqual(sourceAmounts(text, value, '40000.00', { subject }), '40000.00');
  });
for (const [subject, text] of [['王美元', '王美元工资以港币支付四万元。'], ['李港元', '李港元美元工资四万元。']])
  test('excluding the subject cannot remove a separate actual foreign denomination: ' + text, () =>
    amountsEqual(sourceAmounts(text, '四万元', '40000.00', { subject }), null));
test('another subject ending in a currency word does not taint the current worker amount', () =>
  amountsEqual(sourceAmounts('李港元工资三万元。王甲工资四万元。', '四万元', '40000.00'), '40000.00'));

test('traditional and simplified equal monetary values at two source events remain two accepted facts and two matches', () => {
  const q1 = '王甲第一笔工資四萬圓。', q2 = '王甲第二笔工资四万元。', source = sourceFor(q1 + q2), candidates = [entry('四萬圓', q1), entry('四万元', q2)];
  const state = ingest(source, candidates); assert.equal(state.materials[0].candidates.length, 2);
  assert.deepEqual(state.materials[0].candidates.map(fact => fact.amount), ['40000.00', '40000.00']);
  const text = source.blocks[0].text, anchors = candidates.map(candidate => { const at = text.indexOf(candidate.value); return { blockId: 'b1', start: cp(text.slice(0, at)), end: cp(text.slice(0, at)) + cp(candidate.value) }; });
  const input = { id: 'r20-equal-events', source }, label = { id: input.id, schemaVersion: 3, label_status: 'provisional_non_expert', expected: candidates,
    events: anchors.map((anchor, i) => ({ id: 'e' + i, anchors: [anchor] })), expected_event_ids: ['e0', 'e1'] };
  const row = assessCase(input, label, { id: input.id, finish_reason: 'stop', raw_output: raw(candidates) });
  for (const layer of ['raw', 'accepted']) for (const mode of ['basic', 'relational', 'strict'])
    assert.deepEqual([row[layer + '_' + mode].tp, row[layer + '_' + mode].fp, row[layer + '_' + mode].fn], [2, 0, 0]);
  assert(row.production_defense.every(fact => !fact.calculation_authorized));
});
