import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Synthetic independent checks only. No model, service or frozen case is used.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const moduleAt = path => import(pathToFileURL(resolve(ROOT, path)).href);
const { classifyMonetaryExpression, normalizeMoneyValueV4 } = await moduleAt('lib/material-money-v4.ts');
const { ingestRuntimeCandidates } = await moduleAt('lib/material-fact-runtime-ingest.ts');
const { reviewFactsAgainstSources } = await moduleAt('lib/material-fact-source-review.ts');
const { emptyFactState, ingestCandidates: ingestHistorical, buildFactView } = await moduleAt('lib/material-facts-v3.ts');
const { assessCase } = await moduleAt('experiments/material-facts-v7/assess.mjs');
const AT = '2026-10-18T12:00:00.000Z';
const cp = text => Array.from(text).length;
const sourceFor = text => ({ id: 'round9-independent-source', name: 'synthetic-relative-day.txt', sha256: 'c'.repeat(64),
  analysisRevision: 9, ready: true, blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] });
const entry = (value, quote, overrides = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲',
  scope: 'individual', meaning: 'due_total', completeness: 'complete', period: null, rateUnit: null,
  assertion: 'narrated', ...overrides });
const output = candidates => JSON.stringify({ schemaVersion: 3, candidates });
function ingest(source, candidates, historical = false) {
  const raw = output(candidates);
  const state = (historical ? ingestHistorical : ingestRuntimeCandidates)(emptyFactState(9), source,
    { raw }, 'independent-relative-day', 'synthetic-owner', AT, null);
  assert.equal(state.materials[0].raw, raw);
  assert.deepEqual(JSON.parse(state.materials[0].raw).candidates, candidates);
  assert.deepEqual(state.confirmations, { due: null, paid: null });
  assert.equal(state.calculation, null);
  return state;
}
function checkStored(source, candidate, state, amount) {
  assert.equal(state.materials[0].candidates.length, 1);
  const saved = state.materials[0].candidates[0];
  assert.equal(saved.amount, amount);
  assert.deepEqual(saved.representation, candidate);
  const at = source.blocks[0].text.indexOf(candidate.quote);
  assert.equal(saved.start, cp(source.blocks[0].text.slice(0, at)));
  assert.equal(saved.end, saved.start + cp(candidate.quote));
  assert.equal(buildFactView(state, [source]).canCalculate, false);
  return saved;
}
function totalSurvives(text, subject = '王甲') {
  const source = sourceFor(text);
  for (const quote of [text, '四万元']) {
    const candidate = entry('四万元', quote, { subject });
    const fresh = ingest(source, [candidate]);
    const saved = checkStored(source, candidate, fresh, '40000.00');
    assert.equal(saved.normalization.status, 'exact');
    assert(!saved.reviewIssues.some(issue => issue.code === 'rate_unit_mismatch'));
    const historical = ingest(source, [candidate], true);
    const original = historical.materials[0].candidates[0];
    original.amount = '40000.00';
    original.normalization = { rawValue: '四万元', status: 'exact', amount: '40000.00', matchedText: '四万元',
      span: { start: 0, end: 3 }, reason: 'Synthetic previously saved exact money.' };
    const before = structuredClone(historical), reviewed = reviewFactsAgainstSources(historical, [source]);
    checkStored(source, candidate, reviewed, '40000.00');
    assert.deepEqual(historical, before, 'Read-time review does not edit historical evidence.');
    assert.equal(reviewed.materials[0].raw, before.materials[0].raw);
    // A corrected interpretation must never upgrade an already unavailable
    // historical normalization or silently replace its raw/value/quote.
    original.amount = null;
    original.normalization = { ...original.normalization, amount: null, status: 'unsupported' };
    const unavailable = structuredClone(historical);
    checkStored(source, candidate, reviewFactsAgainstSources(historical, [source]), null);
    assert.deepEqual(historical, unavailable);
  }
}
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-source-review.ts', 'lib/material-fact-runtime-ingest.ts', 'experiments/material-facts-v7/assess.mjs'])
  console.log(JSON.stringify({ evidence: 'implementation_hash', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));

const noAmounts = ['今日工资', '今天的工资', '昨日基本工资', '明日工资合计', '当日工资总额', '该日劳动报酬',
  '本日工资', '同日劳务费', '翌日工资', '前一天工资', '下一日工资', '那一天的工资',
  '每日工资', '每天工资', '日工资', '某日工资', '该天工资'];
for (const value of noAmounts) test('relative-day wage name has no amount, while its raw and old display remain: ' + value, () => {
  assert.equal(classifyMonetaryExpression(value).kind, 'not_monetary');
  assert.equal(normalizeMoneyValueV4(value).amount, null);
  const text = '😀王甲的材料记载：' + value + '。', source = sourceFor(text), candidate = entry(value, value);
  const state = ingest(source, [candidate]);
  assert.equal(state.materials[0].candidates.length, 0);
  assert.equal(state.materials[0].rejected.length, 1);
  const historical = ingest(source, [candidate], true), before = structuredClone(historical);
  const reviewed = reviewFactsAgainstSources(historical, [source]);
  checkStored(source, candidate, reviewed, null);
  assert.deepEqual(historical, before);
  assert.equal(reviewed.materials[0].raw, before.materials[0].raw);
});

for (const day of ['今日', '昨日', '明日', '当日', '该日', '同日', '翌日', '前一日', '下一日', '今天', '某日'])
  test('relative-day total survives full/cropped source and historical review: ' + day, () => {
    totalSurvives('😀王甲' + day + '工资合计四万元。');
  });

for (const clause of ['每日工资四万元', '每天工资四万元', '日薪四万元', '日工资标准为四万元', '今日工资标准为四万元', '今日工资四万元/日'])
  test('real daily rate still blocks total-role money and accepts an explicit day rate: ' + clause, () => {
    const text = '😀王甲' + clause + '。', source = sourceFor(text);
    for (const quote of [text, '四万元']) {
      const total = entry('四万元', quote), blocked = ingest(source, [total]);
      const stored = checkStored(source, total, blocked, null);
      assert.equal(stored.normalization.status, 'rate_unit_mismatch');
      const rate = entry('四万元', quote, { meaning: 'rate', completeness: 'not_applicable', rateUnit: 'day' });
      checkStored(source, rate, ingest(source, [rate]), '40000.00');
    }
  });

for (const day of ['2026年10月18日', '18日']) test('an explicit calendar-day wage total remains available: ' + day, () => {
  totalSurvives('😀王甲' + day + '工资合计四万元。');
});
for (const [subject, relative] of [['王今', '今日'], ['王当', '当日']]) {
  test('a name ending in a relative-day prefix does not hide a true daily wage: ' + subject, () => {
    const text = '😀' + subject + '日工资四万元。', source = sourceFor(text), candidate = entry('四万元', '四万元', { subject });
    assert.equal(checkStored(source, candidate, ingest(source, [candidate]), null).normalization.status, 'rate_unit_mismatch');
  });
  test('the same name followed by a separate relative day still names a total: ' + subject, () => {
    totalSurvives('😀' + subject + relative + '工资合计四万元。', subject);
  });
}
test('horizontal spacing and Cf folding do not change original CP quote coordinates', () => {
  totalSurvives('😀王甲今\u200b日 基本工资 合计四万元。');
});
test('a daily rate in another sentence does not poison the relative-day total', () => {
  totalSurvives('李乙每日工资三百元。\n😀王甲今日工资合计四万元。');
});
for (const value of ['今日工资若干元', '今日工资****元', '今日工资四万余元', '今日工资四万至五万元', '今日工资待核'])
  test('unknown or nonexact money remains reviewable rather than falsely rejected: ' + value, () => {
    assert.notEqual(classifyMonetaryExpression(value).kind, 'not_monetary');
    const text = '😀王甲记载' + value + '。', source = sourceFor(text), candidate = entry(value, value);
    checkStored(source, candidate, ingest(source, [candidate]), null);
  });
test('a rejected no-amount candidate is still a raw FP in all three raw scoring layers', () => {
  const candidate = entry('今日工资', '今日工资'), input = { id: 'round9-no-amount-case', source: sourceFor('😀王甲今日工资。') };
  const label = { id: input.id, schemaVersion: 3, label_status: 'provisional_non_expert', expected: [], events: [],
    expected_event_ids: [], acceptable_alternatives: [] };
  const result = { id: input.id, finish_reason: 'stop', raw_output: output([candidate]) };
  const before = structuredClone({ input, label, result }), row = assessCase(input, label, result);
  for (const mode of ['basic', 'relational', 'strict']) {
    assert.deepEqual([row['raw_' + mode].tp, row['raw_' + mode].fp, row['raw_' + mode].fn], [0, 1, 0]);
    assert.deepEqual([row['accepted_' + mode].tp, row['accepted_' + mode].fp, row['accepted_' + mode].fn], [0, 0, 0]);
  }
  assert.deepEqual({ input, label, result }, before);
});
