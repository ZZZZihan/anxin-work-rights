import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Late-409 finite boundary and capability integration contracts. No service,
// model, frozen case or calculation is created by this independent test.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(ROOT, path)));
const { normalizeMoneyValueV4: money, canonicalMonetaryExpression: canonical, classifyMonetaryExpression: classify } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates: fresh } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, buildFactView } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const { assessCase } = await load('experiments/material-facts-v7/assess.mjs');
const cp = text => Array.from(text).length;
const entry = (value, quote = value, extra = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual',
  meaning: 'due_total', completeness: 'complete', period: null, rateUnit: null, assertion: 'narrated', ...extra });
const sourceFor = text => ({ id: 'late409-independent', name: 'synthetic.txt', sha256: 'f'.repeat(64), analysisRevision: 22, ready: true,
  blocks: [{ id: 'b1', page: 1, text: '😀𠮷。' + text, bbox: null, confidence: null }] });
const rawFor = candidates => JSON.stringify({ schemaVersion: 3, candidates });
function ingest(source, candidates, historical = false) {
  const raw = rawFor(candidates), state = (historical ? legacy : fresh)(emptyFactState(22), source, { raw }, 'late409-independent', 'synthetic', '2026-10-18T13:00:00.000Z', null);
  assert.equal(state.materials[0].raw, raw); assert.deepEqual(state.confirmations, { due: null, paid: null });
  assert.equal(state.calculation, null); assert.equal(buildFactView(state, [source]).canCalculate, false);
  return state;
}
function accepted(source, candidate, state) {
  assert.equal(state.materials[0].candidates.length, 1, 'Acceptance and amount availability are separate contracts.');
  const fact = state.materials[0].candidates[0], block = source.blocks.find(row => row.id === candidate.blockId), at = block.text.indexOf(candidate.quote);
  assert(at >= 0); assert.equal(block.text.indexOf(candidate.quote, at + 1), -1);
  assert.deepEqual(fact.representation, candidate); assert.equal(fact.start, cp(block.text.slice(0, at))); assert.equal(fact.end, fact.start + cp(candidate.quote));
  return fact;
}
function history(source, candidate, amount, status = 'exact') {
  const old = ingest(source, [candidate], true), fact = accepted(source, candidate, old);
  fact.amount = amount; fact.normalization = { rawValue: candidate.value, status, amount, matchedText: candidate.value,
    span: { start: 0, end: cp(candidate.value) }, reason: 'Synthetic historical state; no calculation authorization.' };
  const before = structuredClone(old), reviewed = reviewFactsAgainstSources(old, [source]);
  assert.deepEqual(old, before); assert.equal(reviewed.materials[0].raw, rawFor([candidate]));
  return accepted(source, candidate, reviewed);
}
function check(text, value, expected, oldAmount, extra = {}) {
  const source = sourceFor(text);
  for (const quote of [value, source.blocks[0].text]) {
    const candidate = entry(value, quote, extra);
    assert.equal(accepted(source, candidate, ingest(source, [candidate])).amount, expected, 'fresh/source');
    assert.equal(history(source, candidate, oldAmount).amount, expected, 'stored/source');
  }
}
function six(row, wanted) {
  for (const layer of ['raw', 'accepted']) for (const mode of ['basic', 'relational', 'strict'])
    assert.deepEqual([row[layer + '_' + mode].tp, row[layer + '_' + mode].fp, row[layer + '_' + mode].fn], wanted);
  assert(row.production_defense.every(fact => !fact.calculation_authorized));
}
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-range-review.ts', 'lib/material-fact-source-review.ts', 'experiments/material-facts-v7/assess.mjs'])
  console.log(JSON.stringify({ evidence: 'late409_implementation_hash', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));

for (const prefix of ['最多', '最少']) test('compact upper/lower limits never yield an exact payable amount: ' + prefix, () => {
  const value = prefix + '四万元'; assert.equal(money(value).amount, null);
  assert(canonical(value)); assert.notEqual(canonical(value), canonical('四万元'));
  check('王甲工资' + value + '。', value, null, '40000.00');
  check('王甲工资' + value + '。', '四万元', null, '40000.00');
});
for (const suffix of ['内', '之内', '內', '之內']) test('a bounded monetary suffix is retained through value and quote clipping: ' + suffix, () => {
  const value = '四万元' + suffix; assert.equal(money(value).amount, null); assert(canonical(value));
  check('王甲工资' + value + '。', value, null, '40000.00');
  check('王甲工资' + value + '。', '四万元', null, '40000.00');
});
for (const prefix of ['最多', '最少']) {
  test('an explicit compact limit can continue across layout whitespace: ' + prefix, () => check('王甲工资' + prefix + '\n四万元。', '四万元', null, '40000.00'));
  test('an explicit compact limit in the preceding block still guards the amount: ' + prefix, () => {
    const source = sourceFor('王甲工资' + prefix); source.blocks.push({ id: 'b2', page: 1, text: '四万元。', bbox: null, confidence: null });
    const candidate = entry('四万元', '四万元', { blockId: 'b2' });
    assert.equal(accepted(source, candidate, ingest(source, [candidate])).amount, null);
    assert.equal(history(source, candidate, '40000.00').amount, null);
  });
}
for (const suffix of ['内部核算', '内容另记', '内控复核']) test('ordinary complete words are not an isolated 内 bound: ' + suffix, () => {
  assert.equal(money('四万元' + suffix).amount, '40000.00');
  check('王甲工资四万元' + suffix + '。', '四万元', '40000.00', '40000.00');
});
for (const text of ['王甲最多三个月后领工资四万元。', '王甲最少三天后领工资四万元。'])
  test('a bound attached to a duration cannot qualify a later separate wage amount: ' + text, () => check(text, '四万元', '40000.00', '40000.00'));

for (const prefix of ['最多', '最少']) for (const value of ['40000RMB', '人民币5角2分'])
  test('new literal paths do not bypass an existing compact prefix: ' + prefix + value, () => {
    const expression = prefix + value; assert.equal(money(expression).amount, null); assert(canonical(expression));
    check('王甲工资' + expression + '。', value, null, value === '40000RMB' ? '40000.00' : '0.52');
  });
for (const suffix of ['内', '之内']) for (const value of ['40000CNY', '人民币2分'])
  test('new literal paths do not bypass an attached upper-bound suffix: ' + value + suffix, () => {
    const expression = value + suffix; assert.equal(money(expression).amount, null); assert(canonical(expression));
    check('王甲工资' + expression + '。', value, null, value === '40000CNY' ? '40000.00' : '0.02');
  });
for (const [value, amount] of [['40000人民币', '40000.00'], ['40000人民幣', '40000.00'], ['40000RMB', '40000.00'], ['40000CNY', '40000.00'],
  ['人民币5角', '0.50'], ['人民币2分', '0.02'], ['人民币5角2分', '0.52']])
  test('an explicit newly supported RMB literal preserves raw evidence and never upgrades stored null: ' + value, () => {
    assert.equal(money(value).amount, amount); assert.equal(canonical(value), 'exact:' + amount);
    check('王甲工资' + value + '。', value, amount, amount);
    const source = sourceFor('王甲工资' + value + '。'); assert.equal(history(source, entry(value), null, 'unsupported').amount, null);
  });
for (const value of ['八成', '八折', '打八折', '对折', '拖欠工資', '未付工資', '本期應付工資', '勞動報酬'])
  test('a complete amount-free description is rejected while its raw observation is retained: ' + value, () => {
    assert.equal(classify(value).kind, 'not_monetary');
    const source = sourceFor(value), state = ingest(source, [entry(value)]);
    assert.equal(state.materials[0].candidates.length, 0); assert.equal(state.materials[0].rejected.length, 1);
  });
for (const value of ['四万元的八成', '四万元打八折']) test('a monetary formula remains accepted for review with no derived amount: ' + value, () => {
  const source = sourceFor('王甲工资' + value + '。'), candidate = entry(value);
  assert.notEqual(classify(value).kind, 'not_monetary');
  assert.equal(accepted(source, candidate, ingest(source, [candidate])).amount, null);
});
for (const [text, value, unsafe] of [['王甲工资人民币5角至人民币8角。', '人民币8角', '0.80'],
  ['王甲工资40000RMB至50000CNY。', '50000CNY', '50000.00'], ['王甲工资人民币5角/月。', '人民币5角', '0.50'],
  ['王甲工资人民币2分米。', '人民币2分', '0.02'], ['王甲工资40000RMB港幣。', '40000RMB', '40000.00']])
  test('explicit new units retain adjacent range/rate/lexical/currency guards: ' + text, () => check(text, value, null, unsafe));
test('a cropped exact operand cannot match its compact bound event in any scoring layer', () => {
  const text = '😀𠮷。王甲工资最多四万元。', value = '最多四万元', source = sourceFor('王甲工资' + value + '。');
  assert.equal(source.blocks[0].text, text);
  const start = cp(text.slice(0, text.indexOf(value))), gold = entry(value, text);
  const input = { id: 'late409-bound-event', source }, label = { expected: [gold], events: [{ id: 'e', anchors: [{ blockId: 'b1', start, end: start + cp(value) }] }], expected_event_ids: ['e'] };
  for (const [candidate, wanted] of [[entry('四万元', text), [0, 1, 1]], [gold, [1, 0, 0]]]) {
    const row = assessCase(input, label, { raw_output: rawFor([candidate]), finish_reason: 'stop' }); six(row, wanted);
  }
});
