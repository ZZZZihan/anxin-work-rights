import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Independent synthetic contracts. No frozen case, service, or model is run.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(ROOT, path)));
const { normalizeMoneyValueV4: money, normalizeCandidateValueV4: normalize, classifyMonetaryExpression: classify } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates: fresh } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, buildFactView } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const { assessCase } = await load('experiments/material-facts-v7/assess.mjs');
const cp = text => Array.from(text).length;
const sourceFor = blocks => ({ id: 'round17-independent', name: 'synthetic-round17.txt', sha256: 'd'.repeat(64), analysisRevision: 17,
  ready: true, blocks: (Array.isArray(blocks) ? blocks : [blocks]).map((text, i) => ({ id: 'b' + (i + 1), page: 1, text, bbox: null, confidence: null })) });
const entry = (value, quote = value, changes = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲',
  scope: 'individual', meaning: 'due_total', completeness: 'complete', period: null, rateUnit: null, assertion: 'narrated', ...changes });
const raw = candidates => JSON.stringify({ schemaVersion: 3, candidates });
function ingest(source, candidates, historical = false) {
  const text = raw(candidates), state = (historical ? legacy : fresh)(emptyFactState(17), source, { raw: text }, 'round17-independent', 'synthetic', '2026-10-18T08:00:00.000Z', null);
  assert.equal(state.materials[0].raw, text); assert.deepEqual(JSON.parse(text).candidates, candidates);
  assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
  assert.equal(buildFactView(state, [source]).canCalculate, false);
  return state;
}
function stored(source, candidate, state) {
  assert.equal(state.materials[0].candidates.length, 1);
  const fact = state.materials[0].candidates[0]; assert.deepEqual(fact.representation, candidate);
  const text = source.blocks.find(block => block.id === candidate.blockId).text, at = text.indexOf(candidate.quote);
  assert(at >= 0); assert.equal(text.indexOf(candidate.quote, at + 1), -1);
  assert.equal(fact.start, cp(text.slice(0, at))); assert.equal(fact.end, cp(text.slice(0, at)) + cp(candidate.quote));
  return fact;
}
function historyAmount(source, candidate, amount) {
  const old = ingest(source, [candidate], true), fact = stored(source, candidate, old);
  fact.amount = amount; fact.normalization = { rawValue: candidate.value, status: 'exact', amount, matchedText: candidate.value,
    span: { start: 0, end: cp(candidate.value) }, reason: 'Synthetic unsafe exact history.' };
  const before = structuredClone(old), reviewed = reviewFactsAgainstSources(old, [source]);
  assert.deepEqual(old, before); assert.equal(reviewed.materials[0].raw, raw([candidate]));
  return stored(source, candidate, reviewed).amount;
}
function sourceAmounts(source, value, amount, changes = {}) {
  const block = source.blocks.find(item => item.id === (changes.blockId ?? 'b1'));
  const result = {};
  for (const [name, quote] of [['short', value], ['full', block.text]]) {
    const candidate = entry(value, quote, changes);
    result['fresh_' + name] = stored(source, candidate, ingest(source, [candidate])).amount;
    result['history_' + name] = historyAmount(source, candidate, amount);
  }
  return result;
}
function allAmounts(result, amount) { assert.deepEqual(result, Object.fromEntries(Object.keys(result).map(key => [key, amount]))); }
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-currency-review.ts', 'lib/material-fact-source-review.ts',
  'lib/material-fact-runtime-ingest.ts', 'experiments/material-facts-v7/assess.mjs'])
  console.log(JSON.stringify({ evidence: 'round17_implementation_hash', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));

for (const text of ['王甲的工资以港币折合四万元。', '王甲的工资以港幣折合四万元。',
  '王甲工资四万元以港币折合。', '王甲工资四万元折合港幣。'])
  test('foreign 折合 attribution survives cropped value/quote and historical display: ' + text, () => {
    const source = sourceFor('😀𠮷' + text), value = '四万元', result = sourceAmounts(source, value, '40000.00');
    result.quote_full = normalize(entry(value, source.blocks[0].text)).amount;
    allAmounts(result, null);
  });
for (const text of ['王甲工资折合人民币四万元。', '李乙工资以港币折合三万元。王甲工资四万元。',
  '王甲工资四万元。李乙工资以港币折合三万元。'])
  test('explicit RMB result and other events keep their own amount: ' + text,
    () => allAmounts(sourceAmounts(sourceFor('😀' + text), '四万元', '40000.00'), '40000.00'));

for (const [expression, value, amount] of [['三元组', '三元', '3.00'], ['五圆桌', '五圆', '5.00'],
  ['十元宝', '十元', '10.00'], ['三圆柱', '三圆', '3.00']]) {
  test('whole ordinary compound has no precise currency amount: ' + expression, () => assert.equal(money(expression).amount, null));
  test('a cropped unit in an ordinary compound remains unavailable in source/history: ' + expression,
    () => allAmounts(sourceAmounts(sourceFor('😀王甲记录' + expression + '。'), value, amount), null));
}
for (const [blocks, value, amount] of [[['😀王甲记录三元', '组。'], '三元', '3.00'], [['😀王甲记录五圆', '桌。'], '五圆', '5.00']])
  test('ordinary compound continuation across source blocks cannot become a currency: ' + JSON.stringify(blocks), () => {
    allAmounts(sourceAmounts(sourceFor(blocks), value, amount), null);
  });
for (const [text, value, amount] of [['王甲工资5元组装费。', '5元', '5.00'], ['王甲工资五元。', '五元', '5.00'],
  ['王甲工资五圆整。', '五圆整', '5.00']])
  test('a real amount followed by 组装费 or a terminator remains exact: ' + text,
    () => allAmounts(sourceAmounts(sourceFor('😀' + text), value, amount), amount));

for (const value of ['拖欠工资', '欠付工资', '未付工资', '本期应付工资'])
  test('definite amount-free wage label rejects the candidate but preserves raw: ' + value, () => {
    const source = sourceFor('😀王甲' + value + '。'), candidate = entry(value), state = ingest(source, [candidate]);
    const observed = { classification: classify(value).kind, accepted: state.materials[0].candidates.length, rejected: state.materials[0].rejected.length };
    assert.deepEqual(observed, { classification: 'not_monetary', accepted: 0, rejected: 1 });
  });
for (const value of ['拖欠工资不详', '欠付工资若干', '未付工资四万元', '三万分红'])
  test('an unknown or explicit amount is not rejected merely for wage/financial wording: ' + value, () => {
    const source = sourceFor('😀王甲' + value + '。'), candidate = entry(value), state = ingest(source, [candidate]);
    assert.notEqual(classify(value).kind, 'not_monetary'); assert.equal(state.materials[0].candidates.length, 1);
    assert.equal(state.materials[0].candidates[0].amount, value.includes('四万元') ? '40000.00' : null);
  });

for (const subject of ['王一', '李三', '赵十']) {
  test('numeral-ending subject cannot hide a monthly rate behind a false total: ' + subject, () => {
    const source = sourceFor('😀' + subject + '月工资四万元。');
    allAmounts(sourceAmounts(source, '四万元', '40000.00', { subject }), null);
  });
  test('correct monthly rate attributes retain the exact rate: ' + subject, () => {
    const source = sourceFor('😀' + subject + '月工资四万元。');
    allAmounts(sourceAmounts(source, '四万元', '40000.00', { subject, meaning: 'rate', completeness: 'not_applicable', rateUnit: 'month' }), '40000.00');
  });
  test('a calendar month after the complete subject remains an exact wage total: ' + subject, () => {
    const source = sourceFor('😀' + subject + '2024年3月工资四万元。');
    allAmounts(sourceAmounts(source, '四万元', '40000.00', { subject, period: '2024年3月' }), '40000.00');
  });
}

function anchor(source, value, from = 0) {
  const text = source.blocks[0].text, at = text.indexOf(value, from); assert(at >= 0);
  return { blockId: 'b1', start: cp(text.slice(0, at)), end: cp(text.slice(0, at + value.length)) };
}
function score(source, expected, anchors, candidates, rawCounts, acceptedCounts) {
  const input = { id: 'round17-score', source }, label = { id: input.id, schemaVersion: 3, label_status: 'provisional_non_expert', expected,
    events: anchors.map((a, i) => ({ id: 'e' + i, anchors: [a] })), expected_event_ids: expected.map((_, i) => 'e' + i), acceptable_alternatives: [] };
  const result = { id: input.id, finish_reason: 'stop', raw_output: raw(candidates) }, before = structuredClone({ input, label, result });
  const row = assessCase(input, label, result);
  for (const layer of ['raw', 'accepted']) for (const mode of ['basic', 'relational', 'strict']) {
    const metric = row[layer + '_' + mode]; assert.deepEqual([metric.tp, metric.fp, metric.fn], layer === 'raw' ? rawCounts : acceptedCounts, layer + '_' + mode);
  }
  assert.deepEqual({ input, label, result }, before); assert(row.production_defense.every(item => item.calculation_authorized === false));
}
for (const reverse of [false, true])
  test('traditional RMB wrappers at one unique event deduplicate in either order, with raw FP preserved: ' + reverse, () => {
    const quote = '王甲工资人民幣四万元。', source = sourceFor('😀' + quote), candidates = [entry('人民幣四万元', quote), entry('四万元', quote)];
    if (reverse) candidates.reverse();
    const state = ingest(source, candidates); assert.equal(state.materials[0].candidates.length, 1); assert.equal(state.materials[0].rejected.length, 1);
    score(source, [entry('四万元', quote)], [anchor(source, '四万元')], candidates, [1, 1, 0], [1, 0, 0]);
  });
test('the same traditional RMB amount in two distinct events remains two accepted facts', () => {
  const q1 = '王甲第一笔工资人民幣四万元。', q2 = '王甲第二笔工资四万元。', source = sourceFor('😀' + q1 + q2);
  const candidates = [entry('人民幣四万元', q1), entry('四万元', q2)], state = ingest(source, candidates);
  assert.equal(state.materials[0].candidates.length, 2); assert.equal(state.materials[0].rejected.length, 0);
  const last = source.blocks[0].text.lastIndexOf('四万元');
  score(source, [entry('四万元', q1), entry('四万元', q2)], [anchor(source, '四万元'), anchor(source, '四万元', last)], candidates, [2, 0, 0], [2, 0, 0]);
});
