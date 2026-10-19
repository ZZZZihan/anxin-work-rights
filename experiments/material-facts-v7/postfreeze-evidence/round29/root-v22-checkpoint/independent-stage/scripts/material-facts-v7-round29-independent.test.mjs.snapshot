import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Five concrete post-baa8bebb findings. Only synthetic raw candidates and stored
// states are used; an accepted amount never grants calculation authority.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(ROOT, path)));
const { normalizeMoneyValueV4: money } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates: fresh } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, buildFactView } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const { assessCase } = await load('experiments/material-facts-v7/assess.mjs');
const cp = text => Array.from(text).length;
const rawFor = candidates => JSON.stringify({ schemaVersion: 3, candidates });
const sourceFor = texts => ({ id: 'round29-independent', name: 'synthetic.txt', sha256: '7'.repeat(64), analysisRevision: 29, ready: true,
  blocks: (Array.isArray(texts) ? texts : [texts]).map((text, index) => ({ id: 'b' + (index + 1), page: 1, text, bbox: null, confidence: null })) });
const entry = (value, quote = value, extra = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual',
  meaning: 'other_money', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated', ...extra });
function stateFor(source, candidates, old = false) {
  const raw = rawFor(candidates), state = (old ? legacy : fresh)(emptyFactState(29), source, { raw }, 'independent', 'synthetic', '2026-10-18T21:00:00.000Z', null);
  assert.equal(state.materials[0].raw, raw); assert.deepEqual(state.confirmations, { due: null, paid: null });
  assert.equal(state.calculation, null); assert.equal(buildFactView(state, [source]).canCalculate, false);
  return state;
}
function factFor(source, item, state) {
  assert.equal(state.materials[0].candidates.length, 1, 'Retaining a review candidate does not make its amount usable.');
  const fact = state.materials[0].candidates[0], text = source.blocks.find(block => block.id === item.blockId).text;
  const at = text.indexOf(item.quote); assert(at >= 0); assert.equal(text.indexOf(item.quote, at + 1), -1);
  assert.deepEqual(fact.representation, item); assert.equal(fact.start, cp(text.slice(0, at))); assert.equal(fact.end, fact.start + cp(item.quote));
  return fact;
}
function historical(source, item, amount, status) {
  const state = stateFor(source, [item], true), fact = factFor(source, item, state);
  fact.amount = amount;
  fact.normalization = { rawValue: item.value, status, amount, matchedText: item.value, span: { start: 0, end: cp(item.value) }, reason: 'Synthetic stored candidate, never confirmed.' };
  const before = structuredClone(state), reviewed = reviewFactsAgainstSources(state, [source]);
  assert.deepEqual(state, before); assert.equal(reviewed.materials[0].raw, rawFor([item]));
  return factFor(source, item, reviewed);
}
function moneyObservations(source, value = '4000元', extra = {}, storedAmount = '4000.00') {
  const rows = [], block = source.blocks.find(item => item.text.includes(value));
  assert(block);
  for (const quote of [value, block.text]) {
    const item = entry(value, quote, { ...extra, blockId: block.id });
    rows.push({ fresh: factFor(source, item, stateFor(source, [item])), storedExact: historical(source, item, storedAmount, 'exact'),
      storedUnavailable: historical(source, item, null, 'unsupported') });
  }
  return rows;
}
function checkMoney(rows, amount) {
  for (const row of rows) {
    assert.equal(row.fresh.amount, amount); assert.equal(row.storedExact.amount, amount);
    assert.equal(row.storedUnavailable.amount, null, 'Reviewing old unavailable money must not upgrade it.');
  }
}
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-range-review.ts', 'lib/material-fact-source-review.ts',
  'lib/material-fact-event-review.ts', 'lib/material-fact-currency-review.ts', 'experiments/material-facts-v7/assess.mjs'])
  console.log(JSON.stringify({ evidence: 'round29_implementation', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));


for (const [value, amount] of [['RMB 4000', '4000.00'], ['CNY4000', '4000.00'], ['人民幣4000', '4000.00']])
  test('an explicit preposed RMB marker needs no inferred yuan suffix: ' + value, () => {
    assert.equal(money(value).amount, amount);
    checkMoney(moneyObservations(sourceFor('😀王甲收到工资' + value + '。'), value), amount);
  });
test('marker order controls and foreign prefixes preserve the existing primitive contracts', () => {
  for (const value of ['人民币4000', '4000RMB', '4000CNY', '4000人民幣', '4000']) assert.equal(money(value).amount, '4000.00');
  for (const value of ['USD4000', '港幣4000', 'RMB4000美元']) assert.equal(money(value).amount, null);
});

test('a monthly payment day is not a monthly wage denominator', () => {
  for (const text of ['😀王甲工资4000元每月15日支付。', '😀王甲工资4000元按月15日支付。']) {
    assert.equal(money(text).amount, '4000.00');
    checkMoney(moneyObservations(sourceFor(text)), '4000.00');
  }
});
test('a genuine every-month rate still requires the rate attribute', () => {
  const source = sourceFor('😀王甲工资4000元每月。');
  checkMoney(moneyObservations(source), null);
  checkMoney(moneyObservations(source, '4000元', { meaning: 'rate', rateUnit: 'month' }), '4000.00');
});

for (const formula of ['四万元乘以出勤係數', '出勤係數乘以四万元'])
  test('an explicit traditional coefficient formula cannot expose its monetary operand: ' + formula, () => {
    assert.equal(money(formula).amount, null);
    const source = sourceFor('😀王甲工资' + formula + '。');
    checkMoney(moneyObservations(source, formula, {}, '40000.00'), null);
    checkMoney(moneyObservations(source, '四万元', {}, '40000.00'), null);
  });
test('explicit operator continuation across adjacent source blocks is still a formula', () => {
  checkMoney(moneyObservations(sourceFor(['😀王甲工资四万元乘以', '出勤係數。']), '四万元', {}, '40000.00'), null);
});
test('a different clause coefficient never contaminates a complete independent payment', () => {
  checkMoney(moneyObservations(sourceFor('😀王甲收到四万元。李乙另按出勤係數核算。'), '四万元', {}, '40000.00'), '40000.00');
  assert.equal(money('四万元乘以出勤系数').amount, null);
});

for (const bound of ['超過', '不超過', '不得超過'])
  test('a traditional upper-bound word remains a bound in full value and source crops: ' + bound, () => {
    const value = bound + '4000元', source = sourceFor('😀王甲工资' + value + '。');
    assert.equal(money(value).amount, null);
    checkMoney(moneyObservations(source, value), null);
    checkMoney(moneyObservations(source), null);
  });
test('an explicit bound split before the amount keeps its inequality across blocks', () => {
  checkMoney(moneyObservations(sourceFor(['😀王甲工资不得超過', '4000元。'])), null);
});
test('a simplified bound is an existing negative control, an unrelated elapsed time is not a bound', () => {
  assert.equal(money('不超过4000元').amount, null);
  checkMoney(moneyObservations(sourceFor('😀王甲收到4000元。李乙等超過三天才签字。')), '4000.00');
});

for (const marker of ['不詳', '無法確定', '待確認', '未載明', '暫定'])
  test('an attached traditional unknown marker survives whole values, source crops and history: ' + marker, () => {
    const value = '4000元' + marker, source = sourceFor('😀王甲工资' + value + '。');
    assert.equal(money(value).amount, null);
    checkMoney(moneyObservations(source, value), null);
    checkMoney(moneyObservations(source), null);
  });
test('layout whitespace and a neighboring block do not hide an attached unknown marker', () => {
  for (const marker of ['待確認', '無法確定'])
    checkMoney(moneyObservations(sourceFor(['😀王甲工资4000元\u200b', marker + '。'])), null);
});
test('a marker in a separate statement does not invalidate the completed payment', () => {
  checkMoney(moneyObservations(sourceFor('😀王甲收到工资4000元。李乙的数额待確認。')), '4000.00');
  assert.equal(money('4000元待确认').amount, null);
});
function noBorrow(source, expected, observed, anchorBlock, anchorText, eventId) {
  const text = source.blocks.find(block => block.id === anchorBlock).text;
  const at = cp(text.slice(0, text.indexOf(anchorText)));
  const label = { expected: [expected], expected_event_ids: [eventId], events: [{ id: eventId,
    anchors: [{ blockId: anchorBlock, start: at, end: at + cp(anchorText) }] }] };
  const row = assessCase({ id: 'round29-independent-events', source }, label, { raw_output: rawFor([observed]), finish_reason: 'stop' });
  for (const scope of ['raw', 'accepted']) for (const mode of ['basic', 'relational', 'strict'])
    assert.deepEqual([row[scope + '_' + mode].tp, row[scope + '_' + mode].fp, row[scope + '_' + mode].fn], [0, 1, 1]);
  assert(row.production_defense.every(fact => !fact.calculation_authorized));
}

test('all six layers refuse to borrow an equal exact payment from another event for formula or unknown crops', () => {
  for (const first of ['😀王甲工资4000元乘以出勤係數。', '😀王甲工资4000元待確認。', '😀王甲工资不超過4000元。']) {
    const source = sourceFor([first, '王甲另收到4000元。']);
    noBorrow(source, entry('4000元', source.blocks[1].text, { blockId: 'b2' }),
      entry('4000元', source.blocks[0].text), 'b2', '4000元', 'separate-payment');
  }
});
