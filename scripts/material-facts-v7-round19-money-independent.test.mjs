import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Finite independent contracts for ROUND19. Synthetic source text only.
// No service, frozen case, model request or confirmation is created.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(ROOT, path)));
const { normalizeMoneyValueV4: money, normalizeCandidateValueV4: normalize, classifyMonetaryExpression: classify } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates: fresh } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, buildFactView } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const { assessCase } = await load('experiments/material-facts-v7/assess.mjs');
const cp = text => Array.from(text).length;
const sourceFor = text => ({ id: 'round19-independent', name: 'synthetic-round19.txt', sha256: 'd'.repeat(64), analysisRevision: 19,
  ready: true, blocks: [{ id: 'b1', page: 1, text: '😀𠮷' + text, bbox: null, confidence: null }] });
const entry = (value, quote = value, changes = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲',
  scope: 'individual', meaning: 'due_total', completeness: 'complete', period: null, rateUnit: null, assertion: 'narrated', ...changes });
const raw = candidates => JSON.stringify({ schemaVersion: 3, candidates });
function ingest(source, candidates, historical = false) {
  const text = raw(candidates), state = (historical ? legacy : fresh)(emptyFactState(19), source, { raw: text }, 'round19-independent', 'synthetic', '2026-10-18T09:00:00.000Z', null);
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
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-arithmetic-review.ts', 'lib/material-fact-source-review.ts',
  'lib/material-fact-runtime-ingest.ts', 'experiments/material-facts-v7/assess.mjs'])
  console.log(JSON.stringify({ evidence: 'round19_implementation_hash', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));

// A source rate is not a total merely because the model cropped off 按单位.
const byUnits = [['按月', 'month'], ['按日计', 'day'], ['按天', 'day'], ['按小时', 'hour'],
  ['按件', 'piece'], ['按小時工資', 'hour'], ['按 月 計', 'month'], ['按\u200b件计', 'piece']];
for (const [phrase, rateUnit] of byUnits) {
  const text = '王甲工资' + phrase + '40000元。';
  test('source-bound 按-unit rate does not expose a due total: ' + phrase, () =>
    amountsEqual(sourceAmounts(text, '40000元', '40000.00'), null));
  test('the supported 按-unit rate remains available with its actual rate attributes: ' + phrase, () =>
    amountsEqual(sourceAmounts(text, '40000元', '40000.00',
      { meaning: 'rate', completeness: 'not_applicable', rateUnit }), '40000.00'));
}
test('a wrong declared rate unit is not silently corrected into an available number', () =>
  amountsEqual(sourceAmounts('王甲工资按月40000元。', '40000元', '40000.00',
    { meaning: 'rate', completeness: 'not_applicable', rateUnit: 'day' }), null));
for (const period of ['2024年5月', '上月', '今日'])
  test('a directly named calendar/relative wage period remains a total: ' + period, () =>
    amountsEqual(sourceAmounts('王甲' + period + '工资40000元。', '40000元', '40000.00', { period }), '40000.00'));
for (const separator of ['。', '\n'])
  test('an 按-unit rate in another worker/event does not contaminate the independent total: ' + JSON.stringify(separator), () =>
    amountsEqual(sourceAmounts('李乙工资按月30000元' + separator + '王甲工资40000元。', '40000元', '40000.00'), '40000.00'));

// These hyphens introduce a complete date/duration, not an amount operand.
for (const suffix of ['-2024年5月仍未支付', '－2024年5月仍未支付', '-2024年5月1日仍未支付',
  '-2024/05/01仍未支付', '-三个月仍未支付', '-2小时后支付', '-\n2024年5月仍未支付'])
  test('a date/duration after a presentation hyphen does not suppress the bound arrears amount: ' + JSON.stringify(suffix), () => {
    const quote = '王甲欠薪4000元' + suffix + '。', candidate = entry('4000元', quote,
      { meaning: 'arrears', completeness: 'not_applicable' });
    assert.equal(normalize(candidate).amount, '4000.00');
    amountsEqual(sourceAmounts(quote, candidate.value, '4000.00', { meaning: 'arrears', completeness: 'not_applicable' }), '4000.00');
  });
test('an explicitly continued date in the adjacent source block retains the original block quote and CP', () => {
  const source = sourceFor('王甲欠薪4000元-');
  source.blocks.push({ id: 'b2', page: 1, text: '2024年5月仍未支付。', bbox: null, confidence: null });
  const candidate = entry('4000元', '4000元', { meaning: 'arrears', completeness: 'not_applicable' });
  for (const fact of [stored(source, candidate, ingest(source, [candidate])), historicalReview(source, candidate, '4000.00')]) {
    assert.equal(fact.amount, '4000.00'); assert.equal(fact.blockId, 'b1');
  }
});
for (const suffix of ['-200元', '-2000', '-2000.05', '-50%', '减去2024年5月', '−2024年5月', '-2024-05'])
  test('a real/ambiguous subtraction is not exempted by the date presentation rule: ' + suffix, () => {
    const quote = '王甲工资4000元' + suffix + '。', candidate = entry('4000元', quote);
    assert.equal(normalize(candidate).amount, null);
    amountsEqual(sourceAmounts(quote, candidate.value, '4000.00'), null);
  });
for (const suffix of ['至2024年5月仍未支付', '—2024年5月仍未支付'])
  test('existing nonarithmetic date punctuation remains available: ' + suffix, () =>
    amountsEqual(sourceAmounts('王甲欠薪4000元' + suffix + '。', '4000元', '4000.00',
      { meaning: 'arrears', completeness: 'not_applicable' }), '4000.00'));

for (const value of ['50%', '百分之五十', '出勤率50%', '支付比例为百分之五十', '比例：５０％', '折算比例-5.5%'])
  test('a complete amount-free percentage is rejected as money while raw output remains intact: ' + value, () => {
    assert.equal(money(value).amount, null); assert.equal(classify(value).kind, 'not_monetary');
    const source = sourceFor('王甲工资资料：' + value + '。'), candidate = entry(value), state = ingest(source, [candidate]);
    assert.equal(state.materials[0].candidates.length, 0); assert.equal(state.materials[0].rejected.length, 1);
    // Historical evidence is displayed without reparsing it into a new amount.
    const old = ingest(source, [candidate], true), before = structuredClone(old);
    const reviewed = reviewFactsAgainstSources(old, [source]); assert.deepEqual(old, before);
    assert.equal(reviewed.materials[0].raw, raw([candidate]));
    assert.equal(stored(source, candidate, reviewed).amount, null);
  });
for (const value of ['四万元的50%', '40000元×50%', '人民币四万元按出勤率50%支付'])
  test('a monetary expression containing a proportion stays reviewable without an amount: ' + value, () => {
    assert.equal(classify(value).kind, 'monetary'); assert.equal(money(value).amount, null);
    const source = sourceFor('王甲工资' + value + '。'), candidate = entry(value);
    assert.equal(stored(source, candidate, ingest(source, [candidate])).amount, null);
  });
for (const value of ['出勤率待定', '工资若干'])
  test('unknown financial/ratio text remains reviewable rather than becoming definite nonmoney or zero: ' + value, () => {
    assert.notEqual(classify(value).kind, 'not_monetary');
    const source = sourceFor('王甲' + value + '。'), candidate = entry(value);
    assert.equal(stored(source, candidate, ingest(source, [candidate])).amount, null);
  });
test('new date handling does not upgrade unsupported historical parsing', () => {
  const source = sourceFor('王甲欠薪4000元-2024年5月仍未支付。'), candidate = entry('4000元');
  const old = ingest(source, [candidate], true), fact = stored(source, candidate, old);
  fact.amount = null; fact.normalization = { rawValue: candidate.value, status: 'unsupported', amount: null,
    matchedText: null, span: null, reason: 'Synthetic historical unsupported; no automatic upgrade.' };
  const before = structuredClone(old), reviewed = reviewFactsAgainstSources(old, [source]); assert.deepEqual(old, before);
  assert.equal(stored(source, candidate, reviewed).amount, null);
});
test('six scoring layers retain the raw FP for a percentage but remove it from accepted predictions', () => {
  const source = sourceFor('王甲出勤率50%。'), candidate = entry('50%'), input = { id: 'r19-ratio', source };
  const label = { id: input.id, schemaVersion: 3, label_status: 'provisional_non_expert', expected: [], events: [], expected_event_ids: [] };
  const row = assessCase(input, label, { id: input.id, finish_reason: 'stop', raw_output: raw([candidate]) });
  for (const mode of ['basic', 'relational', 'strict']) {
    assert.deepEqual([row['raw_' + mode].tp, row['raw_' + mode].fp, row['raw_' + mode].fn], [0, 1, 0]);
    assert.deepEqual([row['accepted_' + mode].tp, row['accepted_' + mode].fp, row['accepted_' + mode].fn], [0, 0, 0]);
  }
});
test('an equal base amount in a proportion event cannot borrow the separately stated payable event at any scoring layer', () => {
  const q1 = '王甲第一项工资4000元的50%。', q2 = '王甲另一项欠薪4000元。', source = sourceFor(q1 + q2);
  const candidates = [entry('4000元', q1), entry('4000元', q2)], state = ingest(source, candidates);
  assert.equal(state.materials[0].candidates.length, 2);
  assert.deepEqual(state.materials[0].candidates.map(fact => fact.amount), [null, '4000.00']);
  const text = source.blocks[0].text, index = text.indexOf(q2) + q2.indexOf('4000元');
  const anchor = { blockId: 'b1', start: cp(text.slice(0, index)), end: cp(text.slice(0, index)) + cp('4000元') };
  const input = { id: 'r19-events', source }, label = { id: input.id, schemaVersion: 3,
    label_status: 'provisional_non_expert', expected: [candidates[1]], events: [{ id: 'payable', anchors: [anchor] }], expected_event_ids: ['payable'] };
  const result = { id: input.id, finish_reason: 'stop', raw_output: raw(candidates) }, before = structuredClone({ input, label, result });
  const row = assessCase(input, label, result);
  for (const layer of ['raw', 'accepted']) for (const mode of ['basic', 'relational', 'strict'])
    assert.deepEqual([row[layer + '_' + mode].tp, row[layer + '_' + mode].fp, row[layer + '_' + mode].fn], [1, 1, 0]);
  assert.deepEqual({ input, label, result }, before); assert(row.production_defense.every(fact => !fact.calculation_authorized));
});
