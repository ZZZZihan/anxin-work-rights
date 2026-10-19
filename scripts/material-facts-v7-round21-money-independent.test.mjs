import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Finite independent contracts for ROUND21. Synthetic source text only.
// No service, frozen case, model request or confirmation is created.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(ROOT, path)));
const { normalizeMoneyValueV4: money, normalizeCandidateValueV4: normalize } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates: fresh } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, buildFactView } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const { assessCase } = await load('experiments/material-facts-v7/assess.mjs');
const cp = text => Array.from(text).length;
const sourceFor = text => ({ id: 'round21-independent', name: 'synthetic-round21.txt', sha256: 'd'.repeat(64), analysisRevision: 20,
  ready: true, blocks: [{ id: 'b1', page: 1, text: '😀𠮷。' + text, bbox: null, confidence: null }] });
const entry = (value, quote = value, changes = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲',
  scope: 'individual', meaning: 'due_total', completeness: 'complete', period: null, rateUnit: null, assertion: 'narrated', ...changes });
const raw = candidates => JSON.stringify({ schemaVersion: 3, candidates });
function ingest(source, candidates, historical = false) {
  const text = raw(candidates), state = (historical ? legacy : fresh)(emptyFactState(20), source, { raw: text }, 'round21-independent', 'synthetic', '2026-10-18T09:00:00.000Z', null);
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
  console.log(JSON.stringify({ evidence: 'round21_implementation_hash', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));


for (const suffix of ['起诉至法院', '起訴至法院', '多次催讨', '余额已付', '餘額已付', '许可另议', '許可另議'])
  test('an ordinary continuation is not an approximate suffix: ' + suffix, () => {
    assert.equal(money('四万元' + suffix).amount, '40000.00');
    assert.equal(normalize(entry('四万元', '王甲工资四万元' + suffix + '。')).amount, '40000.00');
    amountsEqual(sourceAmounts('王甲工资四万元' + suffix + '。', '四万元', '40000.00'), '40000.00');
  });
for (const suffix of ['起', '多', '余', '许'])
  test('a real isolated monetary lower/approximate suffix stays unavailable: ' + suffix, () => {
    assert.equal(money('四万元' + suffix).amount, null);
    assert.equal(normalize(entry('四万元', '王甲工资四万元' + suffix + '。')).amount, null);
    amountsEqual(sourceAmounts('王甲工资四万元' + suffix + '。', '四万元', '40000.00'), null);
  });
for (const suffix of ['起诉至法院。', '许可另议。'])
  test('an intact ordinary word in the adjacent block is not a monetary bound: ' + suffix, () => {
    const source = sourceFor('王甲工资四万元');
    source.blocks.push({ id: 'b2', page: 1, text: suffix, bbox: null, confidence: null });
    const candidate = entry('四万元');
    assert.equal(stored(source, candidate, ingest(source, [candidate])).amount, '40000.00');
    assert.equal(historicalReview(source, candidate, '40000.00').amount, '40000.00');
  });
for (const prefix of ['每周', '每季度', '按年', '每週', '按次', '每分钟'])
  test('a preposed unsupported denominator cannot be a precise due total: ' + prefix, () =>
    amountsEqual(sourceAmounts('王甲' + prefix + '工资四万元。', '四万元', '40000.00'), null));
for (const prefix of ['每\n周工资', '按\n季度工资'])
  test('an explicit unsupported denominator survives quote clipping over layout: ' + JSON.stringify(prefix), () =>
    amountsEqual(sourceAmounts('王甲' + prefix + '四万元。', '四万元', '40000.00'), null));
for (const prefix of ['每周工资', '按季度工资'])
  test('an explicit denominator in the preceding block still belongs to this amount: ' + prefix, () => {
    const source = sourceFor('王甲' + prefix);
    source.blocks.push({ id: 'b2', page: 1, text: '四万元。', bbox: null, confidence: null });
    const candidate = entry('四万元', '四万元', { blockId: 'b2' });
    const state = ingest(source, [candidate]);
    assert.equal(state.materials[0].candidates.length, 1); assert.equal(state.materials[0].candidates[0].amount, null);
    assert.deepEqual(state.materials[0].candidates[0].representation, candidate);
    const old = ingest(source, [candidate], true), fact = old.materials[0].candidates[0];
    fact.amount = '40000.00'; fact.normalization = { rawValue: candidate.value, status: 'exact', amount: '40000.00', matchedText: candidate.value,
      span: { start: 0, end: cp(candidate.value) }, reason: 'Synthetic unsafe historical exact.' };
    const before = structuredClone(old), reviewed = reviewFactsAgainstSources(old, [source]);
    assert.deepEqual(old, before); assert.equal(reviewed.materials[0].candidates[0].amount, null); assert.equal(reviewed.materials[0].raw, raw([candidate]));
  });
for (const [prefix, rateUnit] of [['每月', 'month'], ['每日', 'day'], ['每小时', 'hour']])
  test('supported rate metadata remains usable while due_total cannot hide the same rate: ' + prefix, () => {
    const text = '王甲' + prefix + '工资四万元。';
    amountsEqual(sourceAmounts(text, '四万元', '40000.00', { meaning: 'rate', completeness: 'not_applicable', rateUnit }), '40000.00');
    amountsEqual(sourceAmounts(text, '四万元', '40000.00'), null);
  });
for (const text of ['王甲工资四万元。李乙每周工资三万元。', '王甲本周工资合计四万元。'])
  test('another event or a named wage period does not become this amount denominator: ' + text, () =>
    amountsEqual(sourceAmounts(text, '四万元', '40000.00'), '40000.00'));
for (const [text, subject] of [['王甲每周工资四万元。', '王甲每周'], ['王甲按年工资四万元。', '王甲按年']])
  test('a model subject cannot absorb the explicit denominator from the source: ' + subject, () =>
    amountsEqual(sourceAmounts(text, '四万元', '40000.00', { subject }), null));
for (const purpose of ['年终奖', '年終獎', '年假补偿', '年假補償', '年假工资'])
  test('a genuine yuan amount may be followed by an explicit payment purpose: ' + purpose, () => {
    assert.equal(money('4000元' + purpose).amount, '4000.00');
    for (const value of ['4000元', '4000']) {
      assert.equal(normalize(entry(value, '王甲收到4000元' + purpose + '。', { meaning: 'payment', completeness: 'unknown' })).amount, '4000.00');
      amountsEqual(sourceAmounts('王甲收到4000元' + purpose + '。', value, '4000.00', { meaning: 'payment', completeness: 'unknown' }), '4000.00');
    }
  });
for (const word of ['元年纪事', '元月', '元件'])
  test('a genuine ordinary yuan compound still cannot lend its unit: ' + word, () => {
    assert.equal(money('4000' + word).amount, null);
    amountsEqual(sourceAmounts('王甲记载4000' + word + '。', '4000元', '4000.00'), null);
  });
for (const text of ['王甲以港币支付4000元年终奖。', '王甲收到4000元至5000元年终奖。'])
  test('a payment purpose does not remove a foreign denomination or range: ' + text, () =>
    amountsEqual(sourceAmounts(text, '4000元', '4000.00', { meaning: 'payment', completeness: 'unknown' }), null));
test('a historically unavailable amount is never upgraded merely because a purpose is now recognized', () => {
  const source = sourceFor('王甲收到4000元年终奖。'), candidate = entry('4000元', '4000元', { meaning: 'payment', completeness: 'unknown' });
  const old = ingest(source, [candidate], true), fact = stored(source, candidate, old);
  fact.amount = null; fact.normalization = { rawValue: candidate.value, status: 'unsupported', amount: null, matchedText: null, span: null, reason: 'Synthetic unavailable stored amount.' };
  const before = structuredClone(old), reviewed = reviewFactsAgainstSources(old, [source]);
  assert.deepEqual(old, before); assert.equal(reviewed.materials[0].candidates[0].amount, null); assert.equal(reviewed.materials[0].raw, raw([candidate]));
});
test('equal bonuses at two independent events remain two facts and six-layer matches', () => {
  const q1 = '王甲收到4000元年终奖。', q2 = '王甲又收到4000元年假补偿。', source = sourceFor(q1 + q2);
  const candidates = [entry('4000元', q1, { meaning: 'payment', completeness: 'unknown' }), entry('4000元', q2, { meaning: 'payment', completeness: 'unknown' })];
  const state = ingest(source, candidates); assert.equal(state.materials[0].candidates.length, 2);
  assert.deepEqual(state.materials[0].candidates.map(fact => fact.amount), ['4000.00', '4000.00']);
  const text = source.blocks[0].text, anchors = [text.indexOf('4000元'), text.lastIndexOf('4000元')].map(at => ({ blockId: 'b1', start: cp(text.slice(0, at)), end: cp(text.slice(0, at)) + cp('4000元') }));
  const input = { id: 'r21-equal-events', source }, label = { id: input.id, schemaVersion: 3, label_status: 'provisional_non_expert', expected: candidates,
    events: anchors.map((anchor, i) => ({ id: 'e' + i, anchors: [anchor] })), expected_event_ids: ['e0', 'e1'] };
  const row = assessCase(input, label, { id: input.id, finish_reason: 'stop', raw_output: raw(candidates) });
  for (const layer of ['raw', 'accepted']) for (const mode of ['basic', 'relational', 'strict'])
    assert.deepEqual([row[layer + '_' + mode].tp, row[layer + '_' + mode].fp, row[layer + '_' + mode].fn], [2, 0, 0]);
  assert(row.production_defense.every(fact => !fact.calculation_authorized));
});
