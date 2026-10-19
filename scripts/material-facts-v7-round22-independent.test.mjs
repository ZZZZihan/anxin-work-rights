import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Independent finite contracts for the four ROUND22 findings. Synthetic sources
// only. Acceptance, derived amount, source event and calculation are distinct.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(ROOT, path)));
const { normalizeMoneyValueV4: money, normalizeCandidateValueV4: normalize, canonicalMonetaryExpression: canonical } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates: fresh } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, buildFactView } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const { assessCase } = await load('experiments/material-facts-v7/assess.mjs');
const cp = text => Array.from(text).length;
const entry = (value, quote = value, changes = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual',
  meaning: 'due_total', completeness: 'complete', period: null, rateUnit: null, assertion: 'narrated', ...changes });
const sourceFor = text => ({ id: 'round22-independent', name: 'round22-synthetic.txt', sha256: 'f'.repeat(64), analysisRevision: 22,
  ready: true, blocks: [{ id: 'b1', page: 1, text: '😀𠮷。' + text, bbox: null, confidence: null }] });
const rawFor = candidates => JSON.stringify({ schemaVersion: 3, candidates });
function ingest(source, candidates, historical = false) {
  const raw = rawFor(candidates), state = (historical ? legacy : fresh)(emptyFactState(22), source, { raw }, 'round22-independent', 'synthetic', '2026-10-18T12:00:00.000Z', null);
  assert.equal(state.materials[0].raw, raw); assert.deepEqual(state.confirmations, { due: null, paid: null });
  assert.equal(state.calculation, null); assert.equal(buildFactView(state, [source]).canCalculate, false);
  return state;
}
function stored(source, candidate, state) {
  assert.equal(state.materials[0].candidates.length, 1, 'Accepted candidate is distinct from usable amount.');
  const fact = state.materials[0].candidates[0]; assert.deepEqual(fact.representation, candidate);
  const block = source.blocks.find(row => row.id === candidate.blockId), at = block.text.indexOf(candidate.quote);
  assert(at >= 0); assert.equal(block.text.indexOf(candidate.quote, at + 1), -1);
  assert.equal(fact.start, cp(block.text.slice(0, at))); assert.equal(fact.end, fact.start + cp(candidate.quote));
  return fact;
}
function oldReview(source, candidate, amount, status = 'exact') {
  const old = ingest(source, [candidate], true), fact = stored(source, candidate, old);
  fact.amount = amount; fact.normalization = { rawValue: candidate.value, status, amount,
    matchedText: candidate.value, span: { start: 0, end: cp(candidate.value) }, reason: 'Synthetic historical value for read-only review.' };
  const before = structuredClone(old), reviewed = reviewFactsAgainstSources(old, [source]);
  assert.deepEqual(old, before); assert.equal(reviewed.materials[0].raw, rawFor([candidate]));
  return stored(source, candidate, reviewed);
}
function checkSource(text, value, expected, oldAmount = expected, changes = {}) {
  const source = sourceFor(text);
  for (const quote of [value, source.blocks[0].text]) {
    const candidate = entry(value, quote, changes);
    assert.equal(stored(source, candidate, ingest(source, [candidate])).amount, expected, 'fresh source-bound amount');
    assert.equal(oldReview(source, candidate, oldAmount).amount, expected, 'historical source-bound amount');
  }
}
function score(source, expected, candidates, anchorValues = expected.map(candidate => candidate.value)) {
  const text = source.blocks[0].text, events = expected.map((candidate, index) => {
    const quoteAt = text.indexOf(candidate.quote); assert(quoteAt >= 0);
    const valueAt = quoteAt + candidate.quote.indexOf(anchorValues[index]); assert(valueAt >= quoteAt);
    const start = cp(text.slice(0, valueAt));
    return { id: 'e' + index, anchors: [{ blockId: 'b1', start, end: start + cp(anchorValues[index]) }] };
  });
  const label = { expected, events, expected_event_ids: events.map(event => event.id), acceptable_alternatives: [] };
  const input = { id: 'round22-scoring', source }, before = structuredClone({ input, label, candidates });
  const row = assessCase(input, label, { raw_output: rawFor(candidates), finish_reason: 'stop' });
  assert.deepEqual({ input, label, candidates }, before);
  assert(row.production_defense.every(fact => !fact.calculation_authorized));
  return row;
}
function six(row, wanted) {
  for (const layer of ['raw', 'accepted']) for (const mode of ['basic', 'relational', 'strict'])
    assert.deepEqual([row[layer + '_' + mode].tp, row[layer + '_' + mode].fp, row[layer + '_' + mode].fn], wanted, layer + '_' + mode);
}
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-source-review.ts', 'lib/material-fact-runtime-ingest.ts', 'experiments/material-facts-v7/assess.mjs'])
  console.log(JSON.stringify({ evidence: 'round22_implementation_hash', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));

for (const [value, expected] of [['人民幣兩萬圓', '20000.00'], ['人民幣四億圓', '400000000.00'], ['4億圓', '400000000.00'], ['兩元五角', '2.50']])
  test('traditional numeral aliases derive an exact value without repairing evidence: ' + value, () => {
    assert.equal(money(value).amount, expected); assert.equal(canonical(value), 'exact:' + expected);
    assert.equal(normalize(entry(value, '王甲工资' + value + '。')).amount, expected);
    checkSource('王甲工资' + value + '。', value, expected);
  });
for (const [text, value, unsafe] of [['王甲以港幣支付兩萬圓。', '兩萬圓', '20000.00'], ['王甲工资兩萬圓至四萬圓。', '兩萬圓', '20000.00'],
  ['王甲工资三萬圓至兩億圓。', '兩億圓', '200000000.00'], ['王甲工资約兩萬圓。', '兩萬圓', '20000.00'], ['王甲工资兩萬圓的2倍。', '兩萬圓', '20000.00']])
  test('new numeral aliases cannot bypass an attached foreign/range/bound/formula: ' + text, () => checkSource(text, value, null, unsafe));
test('recognizing an alias does not upgrade a previously unsupported stored candidate', () => {
  const source = sourceFor('王甲工资人民幣兩萬圓。'), candidate = entry('人民幣兩萬圓');
  assert.equal(oldReview(source, candidate, null, 'unsupported').amount, null);
});

for (const [a, b] of [['不满四万元', '不满40000元'], ['低于四万元', '低于40000元'], ['四万元不到', '40000元不到'],
  ['四万元开外', '40000元开外'], ['不滿四萬元', '不满40000元'], ['四萬元開外', '40000元开外']])
  test('a supported bound has an anchored numeric-spelling key, never an exact amount: ' + a, () => {
    assert.equal(money(a).amount, null); assert.equal(money(b).amount, null);
    assert(canonical(a)); assert.equal(canonical(a), canonical(b)); assert.notEqual(canonical(a), canonical('40000元'));
    const source = sourceFor('王甲工资' + a + '。');
    const candidate = entry(a); assert.equal(stored(source, candidate, ingest(source, [candidate])).amount, null);
    assert.equal(oldReview(source, candidate, '40000.00').amount, null);
  });
test('bound direction, literal qualifier and prefix/suffix position are retained in comparison keys', () => {
  const values = ['不满四万元', '高于四万元', '四万元不到', '四万元开外'];
  const keys = values.map(canonical); assert(keys.every(Boolean)); assert.equal(new Set(keys).size, values.length);
  assert(keys.every(key => key !== canonical('四万元')));
});
test('source-exact qualified gold still extracts by literal fallback without inventing a non-null key', () => {
  const value = '不满四万元', source = sourceFor('王甲工资' + value + '。'), candidate = entry(value);
  six(score(source, [candidate], [candidate]), [1, 0, 0]);
});

for (const weekday of ['周日', '星期日', '礼拜日', '週日', '禮拜日'])
  test('a finite weekday identifies an attributable day rather than a daily rate: ' + weekday, () => {
    checkSource('王甲' + weekday + '工资400元。', '400元', '400.00', '400.00', { period: weekday });
  });
for (const [text, subject] of [['王甲周日工资标准400元。', '王甲'], ['王甲每周日工资400元。', '王甲'],
  ['王甲按日工资400元。', '王甲'], ['王周日工资400元。', '王周'], ['李星期日工资400元。', '李星期']])
  test('a weekday suffix does not erase a rate or absorb a literal subject ending: ' + text, () => checkSource(text, '400元', null, '400.00', { subject }));
test('a correct supported daily rate remains usable as a rate and never authorizes calculation', () =>
  checkSource('王甲每日工资400元。', '400元', '400.00', '400.00', { meaning: 'rate', completeness: 'not_applicable', rateUnit: 'day' }));
test('another person\'s daily rate cannot contaminate this weekday total', () =>
  checkSource('王甲星期日工资400元。李乙每日工资500元。', '400元', '400.00'));

for (const suffix of ['工資', '勞務費', '勞動報酬'])
  for (const outerAnchor of [false, true]) test('traditional finite event wrappers align in either containment direction: ' + suffix + '/' + outerAnchor, () => {
    const base = '四萬圓', wrapped = base + suffix, quote = '王甲收到' + wrapped + '。', source = sourceFor(quote);
    const changes = { meaning: 'payment', completeness: 'partial' };
    const gold = entry(outerAnchor ? wrapped : base, quote, changes), candidate = entry(outerAnchor ? base : wrapped, quote, changes);
    six(score(source, [gold], [candidate]), [1, 0, 0]);
  });
test('the same traditional amount at two source events retains six-layer one-to-one matches in reverse output order', () => {
  const q1 = '王甲首笔收到四萬圓勞務費。', q2 = '王甲再次收到四萬圓勞務費。', source = sourceFor(q1 + q2);
  const changes = { meaning: 'payment', completeness: 'partial' };
  const expected = [entry('四萬圓', q1, changes), entry('四萬圓', q2, changes)];
  const candidates = [entry('四萬圓勞務費', q2, changes), entry('四萬圓勞務費', q1, changes)];
  assert.equal(ingest(source, candidates).materials[0].candidates.length, 2);
  six(score(source, expected, candidates), [2, 0, 0]);
});
test('an arbitrary traditional narrative is not a finite monetary wrapper', () => {
  const base = '四萬圓', value = base + '工資尚未支付', quote = '王甲称' + value + '。', source = sourceFor(quote);
  six(score(source, [entry(base, quote)], [entry(value, quote)]), [0, 1, 1]);
});
test('repeated traditional short quotes remain ambiguous across distinct events', () => {
  const q1 = '王甲首笔收到四萬圓工資。', q2 = '王甲再次收到四萬圓工資。', source = sourceFor(q1 + q2);
  const expected = [entry('四萬圓', q1), entry('四萬圓', q2)];
  const candidates = [entry('四萬圓工資'), entry('四萬圓工資')];
  assert.equal(ingest(source, candidates).materials[0].candidates.length, 2);
  six(score(source, expected, candidates), [0, 2, 2]);
});
