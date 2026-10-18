import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Synthetic independent contracts only: no model, service or frozen case.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(ROOT, path)));
const { normalizeMoneyValueV4: money, normalizeCandidateValueV4: normalize } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates: fresh } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, buildFactView } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const { hasAttachedMoneyArithmetic } = await load('lib/material-fact-arithmetic-review.ts');
const { assessCase } = await load('experiments/material-facts-v7/assess.mjs');
const cp = text => Array.from(text).length;
const sourceFor = blocks => ({ id: 'round15-independent', name: 'synthetic-qualified-money.txt', sha256: 'e'.repeat(64),
  analysisRevision: 15, ready: true, blocks: (Array.isArray(blocks) ? blocks : [blocks]).map((text, i) => ({ id: 'b' + (i + 1), page: 1, text, bbox: null, confidence: null })) });
const entry = (value, quote = value, changes = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲',
  scope: 'individual', meaning: 'due_total', completeness: 'complete', period: null, rateUnit: null, assertion: 'narrated', ...changes });
const raw = candidates => JSON.stringify({ schemaVersion: 3, candidates });
function ingest(source, candidates, historical = false) {
  const text = raw(candidates), state = (historical ? legacy : fresh)(emptyFactState(15), source, { raw: text }, 'round15-independent', 'synthetic', '2026-10-18T08:00:00.000Z', null);
  assert.equal(state.materials[0].raw, text);
  assert.deepEqual(JSON.parse(state.materials[0].raw).candidates, candidates);
  assert.deepEqual(state.confirmations, { due: null, paid: null });
  assert.equal(state.calculation, null);
  assert.equal(buildFactView(state, [source]).canCalculate, false);
  return state;
}
function stored(source, candidate, state) {
  assert.equal(state.materials[0].candidates.length, 1, 'Complex money must remain available for review; accepted does not mean usable amount.');
  const fact = state.materials[0].candidates[0];
  assert.deepEqual(fact.representation, candidate);
  const text = source.blocks.find(block => block.id === candidate.blockId).text, at = text.indexOf(candidate.quote);
  assert(at >= 0); assert.equal(text.indexOf(candidate.quote, at + 1), -1);
  assert.equal(fact.start, cp(text.slice(0, at))); assert.equal(fact.end, cp(text.slice(0, at)) + cp(candidate.quote));
  return fact;
}
function historyAmount(source, candidate, amount) {
  const old = ingest(source, [candidate], true), fact = stored(source, candidate, old);
  fact.amount = amount;
  fact.normalization = { rawValue: candidate.value, status: 'exact', amount, matchedText: candidate.value, span: { start: 0, end: cp(candidate.value) }, reason: 'Synthetic unsafe exact history.' };
  const before = structuredClone(old), reviewed = reviewFactsAgainstSources(old, [source]);
  assert.deepEqual(old, before, 'Read review must not rewrite the stored original history.');
  assert.equal(reviewed.materials[0].raw, raw([candidate]));
  return stored(source, candidate, reviewed).amount;
}
function unsafeExpression(expression, value, baseAmount) {
  const source = sourceFor('😀𠮷王甲工资为' + expression + '。'), amounts = { whole: money(expression).amount };
  // Compute every layer before checking the expected result so a failing whole
  // literal check cannot hide the independent source/history failures.
  for (const [name, quote] of [['short', value], ['full', source.blocks[0].text]]) {
    const candidate = entry(value, quote);
    amounts['quote_' + name] = normalize(candidate).amount;
    amounts['fresh_' + name] = stored(source, candidate, ingest(source, [candidate])).amount;
    amounts['history_' + name] = historyAmount(source, candidate, baseAmount);
  }
  // A short quote deliberately lacks the modifier: only full-source review can
  // guard it, so do not pretend the quote-only normalizer can see missing text.
  delete amounts.quote_short;
  assert.deepEqual(amounts, Object.fromEntries(Object.keys(amounts).map(key => [key, null])), expression);
}
function sourceOnly(blocks, value, blockIndex, baseAmount) {
  const source = sourceFor(blocks), candidate = entry(value, value, { blockId: 'b' + (blockIndex + 1) });
  const amounts = {
    fresh: stored(source, candidate, ingest(source, [candidate])).amount,
    history: historyAmount(source, candidate, baseAmount),
  };
  assert.deepEqual(amounts, { fresh: null, history: null });
}
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-range-review.ts', 'lib/material-fact-arithmetic-review.ts',
  'lib/material-fact-source-review.ts', 'lib/material-fact-runtime-ingest.ts', 'experiments/material-facts-v7/assess.mjs'])
  console.log(JSON.stringify({ evidence: 'round15_implementation_hash', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));

for (const expression of ['不满四万元', '未满四万元', '低于四万元', '高于四万元', '多达四万元',
  '不滿四万元', '未滿四万元', '低於四万元', '高於四万元', '多達四万元'])
  test('whole, quoted crop, full source and historical crop cannot turn a bound into an exact amount: ' + expression,
    () => unsafeExpression(expression, '四万元', '40000.00'));
for (const [expression, value, amount] of [['3万余元至4万元', '4万元', '40000.00'], ['3万元左右至4万元', '4万元', '40000.00'],
  ['3万元至约4万元', '3万元', '30000.00'], ['3万餘元至4万元', '4万元', '40000.00'], ['3万元至約4万元', '3万元', '30000.00']])
  test('a qualified range cannot lend its other endpoint as an exact amount: ' + expression,
    () => unsafeExpression(expression, value, amount));
for (const expression of ['四万元的八成', '四万元的八折', '四万元打八折', '四万元的8.5成',
  '四万元工资的八成', '四万元的８折', '四万元打\n八折', '八成的四万元', '八成五的四万元',
  '四万元的八成半', '四万元打对折', '四万元工资八成'])
  test('a stated 成/折 expression is retained without treating its base as the result: ' + expression,
    () => unsafeExpression(expression, '四万元', '40000.00'));

for (const [blocks, value, blockIndex, amount] of [
  [['😀王甲工资不满\n四万元。'], '四万元', 0, '40000.00'],
  [['😀王甲工资不满', '四万元。'], '四万元', 1, '40000.00'],
  [['😀王甲工资3万余元至\n4万元。'], '4万元', 0, '40000.00'],
  [['😀王甲工资3万余元至', '4万元。'], '4万元', 1, '40000.00'],
  [['😀王甲工资3万元至', '约4万元。'], '3万元', 0, '30000.00'],
  [['😀王甲工资四万元的', '八成。'], '四万元', 0, '40000.00'],
  [['😀王甲工资四万元打', '八折。'], '四万元', 0, '40000.00'],
]) test('explicit layout continuation is source-bound, with untouched quote positions: ' + JSON.stringify(blocks),
  () => sourceOnly(blocks, value, blockIndex, amount));

for (const [expression, value, amount] of [['四万元', '四万元', '40000.00'], ['四万元整', '四万元整', '40000.00'],
  ['3万元', '3万元', '30000.00'], ['5元五角', '5元五角', '5.50'],
  ['四万元至2024年5月', '四万元', '40000.00'], ['四万元至4个月', '四万元', '40000.00'],
  ['四万元至2024-05-01', '四万元', '40000.00'], ['折合人民币四万元', '四万元', '40000.00']])
  test('an explicit exact amount or a following date/duration is not turned into a monetary interval: ' + expression, () => {
    assert.equal(money(expression).amount, amount);
    const source = sourceFor('😀王甲工资' + expression + '。');
    for (const quote of [value, source.blocks[0].text]) {
      const candidate = entry(value, quote);
      assert.equal(normalize(candidate).amount, amount);
      assert.equal(stored(source, candidate, ingest(source, [candidate])).amount, amount);
    }
  });
for (const text of ['😀王甲工资四万元。李乙工资不满三万元。',
  '😀王甲工资四万元。另一笔工资打八折。', '😀王甲工资四万元，折扣另议。'])
  test('a modifier or discount in a separate statement cannot attach across punctuation: ' + text, () => {
    const source = sourceFor(text), candidate = entry('四万元');
    assert.equal(stored(source, candidate, ingest(source, [candidate])).amount, '40000.00');
  });
for (const [before, after] of [['八成已经发放工资共', ''], ['', '\n八成已经发放'], ['', '。八折另议'], ['折合人民币', '']])
  test('an independent proportion or a stated conversion result is not an attached operation: ' + JSON.stringify([before, after]),
    () => assert.equal(hasAttachedMoneyArithmetic(before, after), false));

const anchor = (source, value, from = 0) => {
  const text = source.blocks[0].text, at = text.indexOf(value, from); assert(at >= 0);
  return { blockId: 'b1', start: cp(text.slice(0, at)), end: cp(text.slice(0, at + value.length)) };
};
function score(source, expected, anchors, candidates, counts) {
  const input = { id: 'round15-score', source }, label = { id: input.id, schemaVersion: 3, label_status: 'provisional_non_expert', expected,
    events: anchors.map((a, i) => ({ id: 'e' + i, anchors: [a] })), expected_event_ids: expected.map((_, i) => 'e' + i), acceptable_alternatives: [] };
  const result = { id: input.id, finish_reason: 'stop', raw_output: raw(candidates) }, before = structuredClone({ input, label, result });
  const row = assessCase(input, label, result);
  for (const layer of ['raw', 'accepted']) for (const mode of ['basic', 'relational', 'strict']) {
    const score = row[layer + '_' + mode]; assert.deepEqual([score.tp, score.fp, score.fn], counts);
  }
  assert.deepEqual({ input, label, result }, before);
  assert(row.production_defense.every(item => item.calculation_authorized === false));
  return row;
}
for (const expression of ['不满四万元', '3万余元至四万元', '四万元的八成'])
  test('six score layers cannot borrow an equal precise amount from another event: ' + expression, () => {
    const q1 = '王甲第一笔工资' + expression + '。', q2 = '王甲第二笔工资四万元。', source = sourceFor('😀' + q1 + q2);
    const expected = [entry(expression, q1), entry('四万元', q2)];
    const candidates = [entry('四万元', q1), entry('四万元', q2)];
    const second = source.blocks[0].text.lastIndexOf('四万元');
    const row = score(source, expected, [anchor(source, expression), anchor(source, '四万元', second)], candidates, [1, 1, 1]);
    assert.equal(row.raw_count, 2); assert.equal(row.accepted_count, 2);
  });
test('two actual equal precise payments remain two accepted occurrences and two six-layer matches', () => {
  const q1 = '王甲第一笔工资四万元。', q2 = '王甲第二笔工资四万元。', source = sourceFor('😀' + q1 + q2);
  const candidates = [entry('四万元', q1), entry('四万元', q2)], state = ingest(source, candidates);
  assert.equal(state.materials[0].candidates.length, 2);
  const second = source.blocks[0].text.lastIndexOf('四万元');
  score(source, candidates, [anchor(source, '四万元'), anchor(source, '四万元', second)], candidates, [2, 0, 0]);
});
test('a historical unsupported value is not silently upgraded by current normalization', () => {
  const source = sourceFor('😀王甲工资四万元。'), candidate = entry('四万元'), old = ingest(source, [candidate], true);
  const fact = stored(source, candidate, old); fact.amount = null;
  fact.normalization = { rawValue: candidate.value, status: 'unsupported', amount: null, matchedText: null, span: null, reason: 'Synthetic unsupported history.' };
  const before = structuredClone(old), reviewed = reviewFactsAgainstSources(old, [source]);
  assert.equal(stored(source, candidate, reviewed).amount, null); assert.deepEqual(old, before);
});
