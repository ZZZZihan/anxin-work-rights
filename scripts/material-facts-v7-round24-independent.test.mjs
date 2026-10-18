import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Independent finite contracts for the four late-95c review findings. Synthetic
// source text only: no Worker, model request, frozen material or confirmation.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(ROOT, path)));
const { normalizeMoneyValueV4: money } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates: fresh } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, buildFactView } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const { assessCase } = await load('experiments/material-facts-v7/assess.mjs');
const cp = text => Array.from(text).length;
const raw = candidates => JSON.stringify({ schemaVersion: 3, candidates });
const sourceFor = text => ({ id: 'round24-independent', name: 'synthetic.txt', sha256: 'a'.repeat(64), analysisRevision: 24, ready: true,
  blocks: [{ id: 'b1', page: 1, text: '😀' + text, bbox: null, confidence: null }] });
const entry = (value, quote = value, extra = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual',
  meaning: 'due_total', completeness: 'complete', period: '2026年1月', rateUnit: null, assertion: 'narrated', ...extra });
function ingest(source, candidates, historical = false) {
  const output = raw(candidates), state = (historical ? legacy : fresh)(emptyFactState(24), source, { raw: output }, 'round24-independent', 'synthetic', '2026-10-18T14:00:00.000Z', null);
  assert.equal(state.materials[0].raw, output); assert.deepEqual(JSON.parse(output).candidates, candidates);
  assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
  assert.equal(buildFactView(state, [source]).canCalculate, false);
  return state;
}
function stored(source, candidate, state) {
  assert.equal(state.materials[0].candidates.length, 1, 'Candidate retention is distinct from a usable derived amount.');
  const fact = state.materials[0].candidates[0], text = source.blocks.find(block => block.id === candidate.blockId).text;
  const at = text.indexOf(candidate.quote); assert(at >= 0); assert.equal(text.indexOf(candidate.quote, at + 1), -1);
  assert.deepEqual(fact.representation, candidate); assert.equal(fact.start, cp(text.slice(0, at))); assert.equal(fact.end, fact.start + cp(candidate.quote));
  return fact;
}
function history(source, candidate, amount = '4000.00', status = 'exact') {
  const old = ingest(source, [candidate], true), fact = stored(source, candidate, old);
  fact.amount = amount; fact.normalization = { rawValue: candidate.value, status, amount, matchedText: candidate.value,
    span: { start: 0, end: cp(candidate.value) }, reason: 'Synthetic stored state; not a confirmed calculation input.' };
  const before = structuredClone(old), reviewed = reviewFactsAgainstSources(old, [source]);
  assert.deepEqual(old, before); assert.equal(reviewed.materials[0].raw, raw([candidate]));
  return stored(source, candidate, reviewed);
}
function moneyCases(source, value, extra = {}) {
  const facts = {};
  for (const [name, quote] of [['short', value], ['full', source.blocks[0].text]]) {
    const candidate = entry(value, quote, extra);
    facts['fresh_' + name] = stored(source, candidate, ingest(source, [candidate]));
    facts['history_' + name] = history(source, candidate, /[万萬]/u.test(value) ? '40000.00' : '4000.00');
  }
  return facts;
}
function assertAmounts(facts, amount, requireIssue = false) {
  const actual = Object.fromEntries(Object.entries(facts).map(([key, fact]) => [key, fact.amount]));
  assert.deepEqual(actual, Object.fromEntries(Object.keys(facts).map(key => [key, amount])));
  if (requireIssue) for (const fact of Object.values(facts)) {
    assert(fact.reviewIssues.length > 0); assert.notEqual(fact.normalization.status, 'exact');
  }
}
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-source-review.ts', 'lib/material-fact-event-review.ts', 'lib/material-fact-currency-review.ts', 'experiments/material-facts-v7/assess.mjs'])
  console.log(JSON.stringify({ evidence: 'round24_implementation_hash', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));

test('the complete uncertain expressions already contain no exact amount', () => {
  for (const tail of ['？', '待核实', '待定', '未知']) assert.equal(money('4000元' + tail).amount, null);
});
for (const tail of ['？', '待核实', '待定', '未知']) {
  test('a minimal value and either quote cannot remove its postposed uncertainty: ' + tail, () =>
    assertAmounts(moneyCases(sourceFor('王甲2026年1月全部应付工资合计4000元' + tail), '4000元'), null, true));
  test('explicit layout whitespace does not detach the uncertainty: ' + tail, () =>
    assertAmounts(moneyCases(sourceFor('王甲2026年1月全部应付工资合计4000元\n' + tail), '4000元'), null, true));
  test('the next source block can continue this amount uncertainty: ' + tail, () => {
    const source = sourceFor('王甲2026年1月全部应付工资合计4000元');
    source.blocks.push({ id: 'b2', page: 1, text: tail, bbox: null, confidence: null });
    assertAmounts(moneyCases(source, '4000元'), null, true);
  });
}
for (const text of ['王甲2026年1月全部应付工资合计4000元。李乙是否到岗？', '王甲2026年1月全部应付工资合计4000元。是否已经收到？',
  '王甲2026年1月全部应付工资合计4000元。李乙工资待核实。'])
  test('another complete clause does not become an attached monetary uncertainty: ' + text, () =>
    assertAmounts(moneyCases(sourceFor(text), '4000元'), '4000.00'));

for (const [text, meaning] of [['王甲2026年1月全部應付工資合計四萬圓。', 'due_total'],
  ['王甲2026年1月全部已付工資合計四萬圓。', 'paid_total'], ['王甲2026年1月全部应付工资合计四万元。', 'due_total']])
  test('a complete one-owner traditional total is attributed like the simplified equivalent: ' + text, () => {
    const value = text.includes('萬') ? '四萬圓' : '四万元', facts = moneyCases(sourceFor(text), value, { meaning });
    assertAmounts(facts, '40000.00');
    for (const fact of Object.values(facts)) assert(!fact.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'));
  });
for (const [text, extra] of [['王甲2026年1月應付工資四萬圓。', {}], ['王甲2026年1月全部應付工資合計四萬圓。', { subject: '李乙' }]])
  test('traditional folding cannot invent completeness or source ownership: ' + text + JSON.stringify(extra), () => {
    const source = sourceFor(text), candidate = entry('四萬圓', '四萬圓', extra), state = ingest(source, [candidate]);
    if (state.materials[0].candidates.length === 0) assert.equal(state.materials[0].rejected.length, 1, 'An absent source subject may be rejected before relation review.');
    else assert(stored(source, candidate, state).reviewIssues.some(issue => issue.code === 'source_relation_unresolved'));
  });

for (const text of ['王甲工资美元折合人民币4000元。', '王甲工资美元折算为人民币4000元。', '王甲工资港币折合人民幣4000元。'])
  test('an explicitly written RMB conversion result is retained without computing an exchange rate: ' + text, () =>
    assertAmounts(moneyCases(sourceFor(text), '4000元', { period: null, meaning: 'other_money', completeness: 'not_applicable' }), '4000.00'));
for (const text of ['王甲工资美元折合4000元。', '王甲工资以港币折合4000元。', '王甲工资美元折合人民币4000元港币。'])
  test('a conversion word alone or a conflicting denomination cannot authorize RMB: ' + text, () =>
    assertAmounts(moneyCases(sourceFor(text), '4000元', { period: null, meaning: 'other_money', completeness: 'not_applicable' }), null));
test('a stored unavailable conversion result is never silently upgraded', () => {
  const source = sourceFor('王甲工资美元折合人民币4000元。'), candidate = entry('4000元', '4000元', { period: null, meaning: 'other_money', completeness: 'not_applicable' });
  assert.equal(history(source, candidate, null, 'unsupported').amount, null);
});

for (const value of ['每月15日', '每月十五日', '2026年1月15日'])
  test('an explicit wage receipt date is retained literally without inventing a calendar year: ' + value, () => {
    const source = sourceFor('王甲工资收到日' + value + '。');
    for (const quote of [value, source.blocks[0].text]) {
      const candidate = entry(value, quote, { kind: 'date', meaning: 'payment_date', completeness: 'not_applicable', period: null });
      const fact = stored(source, candidate, ingest(source, [candidate]));
      assert.equal(fact.amount, null); assert.equal(fact.value, value);
      assert(!fact.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'));
    }
  });
for (const [text, value, meaning] of [['王甲工资收到日每月15日。', '15日', 'payment_date'],
  ['王甲工资收到日每月15日。', '每月15日', 'wage_period'], ['王甲工资收到日每月32日。', '每月32日', 'payment_date']])
  test('recurrence is not a license to crop its semantics, change its role, or use an invalid day: ' + value + meaning, () => {
    const source = sourceFor(text), candidate = entry(value, value, { kind: 'date', meaning, completeness: 'not_applicable', period: null });
    const fact = stored(source, candidate, ingest(source, [candidate]));
    assert(fact.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'));
  });

test('a cropped precise value cannot score as the complete uncertain event in any of six layers', () => {
  const source = sourceFor('王甲2026年1月全部应付工资合计4000元待定。'), value = '4000元待定', text = source.blocks[0].text;
  const start = cp(text.slice(0, text.indexOf(value))), gold = entry(value, text), input = { id: 'r24-uncertain', source };
  const label = { expected: [gold], events: [{ id: 'uncertain', anchors: [{ blockId: 'b1', start, end: start + cp(value) }] }], expected_event_ids: ['uncertain'] };
  const row = assessCase(input, label, { raw_output: raw([entry('4000元', text)]), finish_reason: 'stop' });
  for (const layer of ['raw', 'accepted']) for (const mode of ['basic', 'relational', 'strict'])
    assert.deepEqual([row[layer + '_' + mode].tp, row[layer + '_' + mode].fp, row[layer + '_' + mode].fn], [0, 1, 1]);
  assert(row.production_defense.every(fact => !fact.calculation_authorized));
});
