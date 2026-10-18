import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Two late-95c contracts, independently added without changing the earlier 39.
// Synthetic source/raw only; no service, frozen result, model or confirmation.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(ROOT, path)));
const { normalizeMoneyValueV4: money, normalizeCandidateValueV4: normalize } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates: fresh } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, buildFactView } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const { assessCase } = await load('experiments/material-facts-v7/assess.mjs');
const cp = text => Array.from(text).length;
const raw = candidates => JSON.stringify({ schemaVersion: 3, candidates });
const entry = (value, quote = value, extra = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual',
  meaning: 'other_money', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated', ...extra });
const sourceFor = texts => ({ id: 'r24-rate-wrapper', name: 'synthetic.txt', sha256: 'd'.repeat(64), analysisRevision: 24, ready: true,
  blocks: (Array.isArray(texts) ? texts : [texts]).map((text, i) => ({ id: 'b' + (i + 1), page: 1, text, bbox: null, confidence: null })) });
function ingest(source, candidates, historical = false) {
  const output = raw(candidates), state = (historical ? legacy : fresh)(emptyFactState(24), source, { raw: output }, 'independent', 'synthetic', '2026-10-18T15:00:00.000Z', null);
  assert.equal(state.materials[0].raw, output); assert.deepEqual(JSON.parse(output).candidates, candidates);
  assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
  assert.equal(buildFactView(state, [source]).canCalculate, false);
  for (const fact of state.materials[0].candidates) {
    const candidate = fact.representation, text = source.blocks.find(block => block.id === candidate.blockId).text;
    assert.deepEqual(candidate, candidates.find(item => JSON.stringify(item) === JSON.stringify(candidate)));
    const at = text.indexOf(candidate.quote); assert(at >= 0);
    assert.equal(fact.start, cp(text.slice(0, at))); assert.equal(fact.end, fact.start + cp(candidate.quote));
  }
  return state;
}
function amounts(source, value, extra = {}) {
  const facts = [];
  for (const quote of [value, source.blocks[0].text]) {
    const candidate = entry(value, quote, extra), state = ingest(source, [candidate]);
    assert.equal(state.materials[0].candidates.length, 1); facts.push(state.materials[0].candidates[0]);
    const old = ingest(source, [candidate], true), fact = old.materials[0].candidates[0]; assert(fact);
    fact.amount = '40000.00'; fact.normalization = { rawValue: value, status: 'exact', amount: '40000.00', matchedText: value,
      span: { start: 0, end: cp(value) }, reason: 'Synthetic old exact state, never confirmed.' };
    const before = structuredClone(old), reviewed = reviewFactsAgainstSources(old, [source]);
    assert.deepEqual(old, before); assert.equal(reviewed.materials[0].raw, raw([candidate]));
    facts.push(reviewed.materials[0].candidates[0]);
  }
  return facts;
}
function anchor(source, blockId, value, from = 0) {
  const text = source.blocks.find(block => block.id === blockId).text, at = text.indexOf(value, from); assert(at >= 0);
  return { blockId, start: cp(text.slice(0, at)), end: cp(text.slice(0, at + value.length)) };
}
function score(source, expected, anchors, candidates, rawCounts, acceptedCounts) {
  const input = { id: 'r24-score', source }, label = { expected, events: anchors.map((value, i) => ({ id: 'e' + i, anchors: [value] })), expected_event_ids: expected.map((_, i) => 'e' + i) };
  const result = { raw_output: raw(candidates), finish_reason: 'stop' }, before = structuredClone({ input, label, result });
  const row = assessCase(input, label, result);
  for (const layer of ['raw', 'accepted']) for (const mode of ['basic', 'relational', 'strict']) {
    const metric = row[layer + '_' + mode]; assert.deepEqual([metric.tp, metric.fp, metric.fn], layer === 'raw' ? rawCounts : acceptedCounts, layer + '_' + mode);
  }
  assert.deepEqual({ input, label, result }, before); assert(row.production_defense.every(fact => !fact.calculation_authorized));
}
for (const path of ['lib/material-fact-arithmetic-review.ts', 'lib/material-fact-runtime-ingest.ts', 'experiments/material-facts-v7/assess.mjs'])
  console.log(JSON.stringify({ evidence: 'round24_rate_wrapper_hash', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));

for (const [operator, rate] of [['乘以', '提成率'], ['除以', '出勤率'], ['×', '税率']])
  test('an explicit operation on a named rate does not expose its base as the result: ' + operator + rate, () => {
    const expression = '四万元' + operator + rate, source = sourceFor('😀王甲工资' + expression + '。');
    const reviewed = amounts(source, '四万元');
    const actual = { whole: money(expression).amount, quote: normalize(entry('四万元', source.blocks[0].text)).amount,
      fresh_and_history: reviewed.map(fact => fact.amount), every_review_has_issue: reviewed.every(fact => fact.reviewIssues.length > 0) };
    assert.deepEqual(actual, { whole: null, quote: null, fresh_and_history: [null, null, null, null], every_review_has_issue: true });
  });
test('a rate mentioned in another clause or a correctly typed monthly wage rate keeps its own amount', () => {
  for (const text of ['😀王甲工资四万元。李乙按提成率核算。', '😀王甲工资四万元，下一期按出勤率核算。'])
    for (const fact of amounts(sourceFor(text), '四万元')) assert.equal(fact.amount, '40000.00');
  for (const fact of amounts(sourceFor('😀王甲月工资四万元。'), '四万元', { meaning: 'rate', rateUnit: 'month' })) assert.equal(fact.amount, '40000.00');
});
test('a clipped base cannot score as the complete named-rate formula event in any layer', () => {
  const value = '四万元乘以提成率', source = sourceFor('😀王甲工资' + value + '。'), quote = source.blocks[0].text;
  score(source, [entry(value, quote)], [anchor(source, 'b1', value)], [entry('四万元', quote)], [0, 1, 1], [0, 1, 1]);
});
for (const suffix of ['工資', '勞務費', '勞動報酬']) for (const reverse of [false, true])
  test('one uniquely anchored traditional wrapper collapses in either order, while raw keeps its duplicate: ' + suffix + reverse, () => {
    const source = sourceFor('😀王甲工资四万元' + suffix + '。'), quote = source.blocks[0].text;
    const candidates = [entry('四万元' + suffix, quote), entry('四万元', quote)]; if (reverse) candidates.reverse();
    const state = ingest(source, candidates); assert.equal(state.materials[0].candidates.length, 1); assert.equal(state.materials[0].rejected.length, 1);
    score(source, [entry('四万元', quote)], [anchor(source, 'b1', '四万元')], candidates, [1, 1, 0], [1, 0, 0]);
  });
test('equal traditional amounts in two source events remain two accepted facts in one block or across blocks', () => {
  for (const separateBlocks of [false, true]) {
    const first = '😀王甲第一笔工资四万元工資。', second = '王甲第二笔工资四万元勞務費。';
    const source = sourceFor(separateBlocks ? [first, second] : first + second), secondId = separateBlocks ? 'b2' : 'b1';
    const candidates = [entry('四万元工資', first), entry('四万元勞務費', second, { blockId: secondId })];
    const state = ingest(source, candidates); assert.equal(state.materials[0].candidates.length, 2); assert.equal(state.materials[0].rejected.length, 0);
    const from = separateBlocks ? 0 : first.length;
    score(source, candidates, [anchor(source, 'b1', '四万元'), anchor(source, secondId, '四万元', from)], candidates, [2, 0, 0], [2, 0, 0]);
  }
});
test('repeated bare quotes do not prove a single event even when the literal and attributes match', () => {
  const source = sourceFor('😀王甲第一笔工资四万元工資。王甲第二笔工资四万元工資。');
  const candidates = [entry('四万元工資'), entry('四万元工資')], state = ingest(source, candidates);
  assert.equal(state.materials[0].candidates.length, 2); assert.equal(state.materials[0].rejected.length, 0);
});
