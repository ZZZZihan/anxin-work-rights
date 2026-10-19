import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Four concrete post-47e4c305 findings. Only synthetic raw candidates and stored
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
const sourceFor = texts => ({ id: 'round30-independent', name: 'synthetic.txt', sha256: '7'.repeat(64), analysisRevision: 30, ready: true,
  blocks: (Array.isArray(texts) ? texts : [texts]).map((text, index) => ({ id: 'b' + (index + 1), page: 1, text, bbox: null, confidence: null })) });
const entry = (value, quote = value, extra = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual',
  meaning: 'other_money', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated', ...extra });
function stateFor(source, candidates, old = false) {
  const raw = rawFor(candidates), state = (old ? legacy : fresh)(emptyFactState(30), source, { raw }, 'independent', 'synthetic', '2026-10-18T21:00:00.000Z', null);
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

for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-range-review.ts', 'lib/material-fact-arithmetic-review.ts',
  'lib/material-fact-source-review.ts', 'lib/material-fact-runtime-ingest.ts', 'experiments/material-facts-v7/assess.mjs'])
  console.log(JSON.stringify({ evidence: 'round30_implementation', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));
function observation(name, rows, whole = null) {
  console.log(JSON.stringify({ evidence: 'round30_boundary', name, whole, rows: rows.map(row => Object.fromEntries(Object.entries(row).map(([key, fact]) =>
    [key, { amount: fact.amount, status: fact.normalization.status, issues: fact.reviewIssues.map(issue => issue.code) }])) ) }));
}
function unsafe(expression, base, source = sourceFor('😀王甲收到工资' + expression + '。')) {
  const rows = moneyObservations(source, base, {}, base === '四万元' ? '40000.00' : '4000.00');
  const fullItem = entry(expression, source.blocks[0].text);
  if (source.blocks[0].text.includes(expression)) rows.push({ fresh: factFor(source, fullItem, stateFor(source, [fullItem])),
    storedExact: historical(source, fullItem, base === '四万元' ? '40000.00' : '4000.00', 'exact'), storedUnavailable: historical(source, fullItem, null, 'unsupported') });
  const whole = money(expression); observation(expression, rows, whole); assert.equal(whole.amount, null); checkMoney(rows, null);
}
function precise(text, base, amount = '4000.00') {
  const rows = moneyObservations(sourceFor(text), base, {}, amount); observation(text, rows); checkMoney(rows, amount);
}
for (const proportion of ['半成', '半折', '对折']) test('an explicit multiplication operand is not the result: ' + proportion,
  () => unsafe('四万元乘以' + proportion, '四万元'));
test('the finite traditional discount also applies after an explicit divisor', () => unsafe('四万元除以對折', '四万元'));
test('an explicit operator followed by a line break keeps its bounded proportion operand', () => unsafe('四万元乘以\n半成', '四万元'));
test('an operator and proportion on the next source block cannot authorize its base', () => {
  const source = sourceFor(['😀王甲工资四万元', '乘以半折。']); const rows = moneyObservations(source, '四万元', {}, '40000.00'); observation('adjacent proportion', rows); checkMoney(rows, null);
});
for (const value of ['４０００元', '人民币４０００元', '￥４０００元']) test('fullwidth integer digits preserve the explicit RMB amount and raw evidence: ' + value, () => {
  const normalized = money(value); const rows = moneyObservations(sourceFor('😀王甲收到工资' + value + '。'), value);
  observation(value, rows, normalized); assert.equal(normalized.amount, '4000.00'); assert.equal(normalized.rawValue, value);
  assert.equal(Array.from(value).slice(normalized.span.start, normalized.span.end).join(''), normalized.matchedText); checkMoney(rows, '4000.00');
});
test('foreign and unknown fullwidth amounts remain unavailable', () => {
  for (const value of ['港币４０００元', '４０００元待定', '４０００元乘以半成']) {
    assert.equal(money(value).amount, null); checkMoney(moneyObservations(sourceFor('😀王甲工资' + value + '。'), value), null);
  }
});
for (const suffix of ['（负数）', '为负数', '负值', '（負數）']) test('a postposed signed description cannot become a positive amount: ' + suffix,
  () => unsafe('4000元' + suffix, '4000元'));
test('a postposed sign across source layout remains attached to the same amount', () => {
  for (const source of [sourceFor('😀王甲工资4000元\n为负数。'), sourceFor(['😀王甲工资4000元', '（负数）。'])]) {
    const rows = moneyObservations(source); observation('layout signed amount', rows); checkMoney(rows, null);
  }
});
for (const prose of ['一次性支付', '一并支付', '三日内支付']) test('bounded numeral-leading payment prose is not another money digit: ' + prose, () => {
  const expression = '4000元' + prose; const normalized = money(expression);
  const rows = moneyObservations(sourceFor('😀王甲收到工资' + expression + '。')); observation(expression, rows, normalized);
  assert.equal(normalized.amount, '4000.00'); checkMoney(rows, '4000.00');
});
test('a payment duration on the next block does not extend the complete money token', () => {
  const source = sourceFor(['😀王甲收到工资4000元', '三日内支付。']); const rows = moneyObservations(source); observation('adjacent payment duration', rows); checkMoney(rows, '4000.00');
});
test('another sentence and another person discount cannot poison a complete payment', () => {
  precise('😀王甲收到工资4000元。李乙商品打对折。', '4000元');
  precise('😀王甲收到工资4000元。李乙账户为负数。', '4000元');
});
test('an actual fractional currency continuation still prevents cropping to its yuan base', () => {
  assert.equal(money('4000元五角').amount, '4000.50'); checkMoney(moneyObservations(sourceFor('😀王甲工资4000元五角。')), null);
});
test('actual rates and unknown amounts keep their existing source defense', () => {
  checkMoney(moneyObservations(sourceFor('😀王甲工资4000元/月。')), null);
  checkMoney(moneyObservations(sourceFor('😀王甲工资4000元待定。')), null);
});
function reportFor(source, expected, observed, anchorText, blockId = 'b2') {
  const block = source.blocks.find(item => item.id === blockId); const at = cp(block.text.slice(0, block.text.indexOf(anchorText)));
  assert(block.text.includes(anchorText));
  const label = { expected: [expected], expected_event_ids: ['separate-event'], events: [{ id: 'separate-event', anchors: [{ blockId, start: at, end: at + cp(anchorText) }] }] };
  const report = assessCase({ id: 'round30-event-isolation', source }, label, { raw_output: rawFor([observed]), finish_reason: 'stop' });
  assert(report.production_defense.every(item => !item.calculation_authorized)); return report;
}
for (const [first, amount] of [['😀王甲工资四万元乘以半成。', '四万元'], ['😀王甲工资4000元（负数）。', '4000元']])
  test('six score layers cannot borrow another equal-valued event: ' + first, () => {
    const source = sourceFor([first, '王甲另收工资' + amount + '。']); const expected = entry(amount, source.blocks[1].text, { blockId: 'b2' });
    const report = reportFor(source, expected, entry(amount, amount), amount);
    for (const layer of ['raw', 'accepted']) for (const mode of ['basic', 'relational', 'strict']) {
      const row = report[layer + '_' + mode]; assert.deepEqual([row.tp, row.fp, row.fn], [0, 1, 1]);
    }
  });
test('a fullwidth amount aligned with its own event is scoreable without calculating', () => {
  const source = sourceFor('😀王甲收到工资４０００元。'); const item = entry('４０００元', source.blocks[0].text);
  const report = reportFor(source, item, item, '４０００元', 'b1');
  for (const layer of ['raw', 'accepted']) for (const mode of ['basic', 'relational', 'strict']) {
    const row = report[layer + '_' + mode]; assert.deepEqual([row.tp, row.fp, row.fn], [1, 0, 0]);
  }
});
