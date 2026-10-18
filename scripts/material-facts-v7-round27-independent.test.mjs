import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Five concrete post-6b24536 findings. All sources and stored states are
// synthetic; accepted candidates are never treated as calculation authority.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(ROOT, path)));
const { normalizeMoneyValueV4: money } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates: fresh } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, buildFactView } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const { assessCase } = await load('experiments/material-facts-v7/assess.mjs');
const cp = text => Array.from(text).length;
const rawFor = candidates => JSON.stringify({ schemaVersion: 3, candidates });
const sourceFor = texts => ({ id: 'round27-independent', name: 'synthetic.txt', sha256: '7'.repeat(64), analysisRevision: 27, ready: true,
  blocks: (Array.isArray(texts) ? texts : [texts]).map((text, index) => ({ id: 'b' + (index + 1), page: 1, text, bbox: null, confidence: null })) });
const entry = (value, quote = value, extra = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual',
  meaning: 'other_money', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated', ...extra });
function stateFor(source, candidates, old = false) {
  const raw = rawFor(candidates), state = (old ? legacy : fresh)(emptyFactState(27), source, { raw }, 'independent', 'synthetic', '2026-10-18T21:00:00.000Z', null);
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
  'lib/material-fact-event-review.ts', 'lib/material-fact-arithmetic-review.ts', 'experiments/material-facts-v7/assess.mjs'])
  console.log(JSON.stringify({ evidence: 'round27_implementation', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));

for (const [value, amount] of [['人民幣貳萬圓', '20000.00'], ['人民幣參萬圓', '30000.00'], ['人民幣陸萬圓', '60000.00']])
  test('explicit traditional financial currency parses without rewriting source: ' + value, () => {
    const normalized = money(value), rows = moneyObservations(sourceFor('😀王甲工資' + value + '。'), value, {}, amount);
    console.log(JSON.stringify({ evidence: 'financial_glyph', value, normalized, fresh: rows.map(row => row.fresh.amount), historical: rows.map(row => row.storedExact.amount) }));
    assert.equal(normalized.amount, amount);
    checkMoney(rows, amount);
  });

for (const suffix of ['按周计', '按季度计', '按年计'])
  test('a postposed unsupported denominator cannot become a total or supported enum rate: ' + suffix, () => {
    const observations = [];
    for (const layout of ['same', 'newline', 'block']) {
      const source = sourceFor(layout === 'block' ? ['😀王甲工资4000元', suffix + '。'] : '😀王甲工资4000元' + (layout === 'newline' ? '\n' : '') + suffix + '。');
      for (const extra of [{ meaning: 'due_total', completeness: 'complete' }, { meaning: 'rate', rateUnit: 'month' }])
        observations.push({ layout, meaning: extra.meaning, rows: moneyObservations(source, '4000元', extra) });
    }
    console.log(JSON.stringify({ evidence: 'unsupported_postposed_rate', suffix, observed: observations.map(item => ({ layout: item.layout, meaning: item.meaning,
      fresh: item.rows.map(row => row.fresh.amount), historical: item.rows.map(row => row.storedExact.amount) })) }));
    assert.equal(money('4000元' + suffix).amount, null);
    for (const item of observations) checkMoney(item.rows, null);
  });
test('an explicit supported monthly rate retains its amount and same-event attribution', () => {
  const rows = moneyObservations(sourceFor('😀王甲工资4000元按月计。'), '4000元', { meaning: 'rate', rateUnit: 'month' });
  checkMoney(rows, '4000.00');
  for (const row of rows) assert(!row.fresh.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'));
});
test('ordinary timing text does not acquire a rate denominator', () => {
  for (const suffix of ['按时支付', '按月15日发放']) checkMoney(moneyObservations(sourceFor('😀王甲工资4000元' + suffix + '。')), '4000.00');
});

for (const [text, meaning, simplified] of [['王甲於2026年1月入職', 'employment_period', '王甲于2026年1月入职'],
  ['王甲工資歸屬期間2026年1月', 'wage_period', '王甲工资归属期间2026年1月'],
  ['王甲於2026年1月簽訂勞動合同', 'contract_signing', '王甲于2026年1月签订劳动合同']])
  test('traditional date-role cue preserves the same literal and attribution: ' + meaning, () => {
    for (const clause of [simplified, text]) {
      const source = sourceFor('😀' + clause + '。');
      for (const quote of ['2026年1月', source.blocks[0].text]) {
        const item = entry('2026年1月', quote, { kind: 'date', meaning });
        const current = factFor(source, item, stateFor(source, [item])), oldState = stateFor(source, [item], true), before = structuredClone(oldState);
        const oldReviewed = reviewFactsAgainstSources(oldState, [source]), stored = factFor(source, item, oldReviewed);
        assert.deepEqual(oldState, before); assert.equal(oldReviewed.materials[0].raw, rawFor([item]));
        for (const fact of [current, stored]) {
          assert.equal(fact.amount, null); assert.equal(fact.value, '2026年1月');
          assert(!fact.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), JSON.stringify(fact.reviewIssues));
        }
      }
    }
  });
test('traditional date folding cannot turn contract signing into employment', () => {
  const source = sourceFor('😀王甲於2026年1月簽訂勞動合同。'), item = entry('2026年1月', '2026年1月', { kind: 'date', meaning: 'employment_period' });
  assert(factFor(source, item, stateFor(source, [item])).reviewIssues.some(issue => issue.code === 'source_relation_unresolved'));
});

for (const suffix of ['+奖金', '加上加班费', '乘以提成'])
  test('an explicit named-pay calculation never exposes its base operand: ' + suffix, () => {
    const observations = [];
    for (const layout of ['same', 'newline', 'block']) {
      const source = sourceFor(layout === 'block' ? ['😀王甲工资4000元', suffix + '。'] : '😀王甲工资4000元' + (layout === 'newline' ? '\n' : '') + suffix + '。');
      observations.push({ layout, rows: moneyObservations(source) });
    }
    console.log(JSON.stringify({ evidence: 'named_pay_arithmetic', suffix, observed: observations.map(item => ({ layout: item.layout,
      fresh: item.rows.map(row => row.fresh.amount), historical: item.rows.map(row => row.storedExact.amount) })) }));
    assert.equal(money('4000元' + suffix).amount, null);
    for (const item of observations) checkMoney(item.rows, null);
  });
test('another person or ordinary separate bonus clause does not become an attached operation', () => {
  checkMoney(moneyObservations(sourceFor('😀王甲工资4000元。李乙奖金1000元。')), '4000.00');
  checkMoney(moneyObservations(sourceFor(['😀王甲工资4000元。', '李乙另有奖金。'])), '4000.00');
});

for (const value of ['工作至少3个月，工资4000元', '工资4000元，工龄至少3个月', '最高人民法院判工资4000元'])
  test('a qualifier attached to a duration or unrelated noun does not qualify the wage: ' + value, () => {
    const normalized = money(value), rows = moneyObservations(sourceFor('😀王甲' + value + '。'));
    console.log(JSON.stringify({ evidence: 'unrelated_qualifier', value, normalized, fresh: rows.map(row => row.fresh.amount), historical: rows.map(row => row.storedExact.amount) }));
    assert.equal(normalized.amount, '4000.00');
    checkMoney(rows, '4000.00');
  });
test('an actual attached monetary bound remains unavailable', () => {
  assert.equal(money('至少4000元').amount, null);
  checkMoney(moneyObservations(sourceFor('😀王甲工资至少4000元。')), null);
});
test('an arithmetic operand in the first event cannot borrow the second exact event in six layers', () => {
  const first = '王甲第一笔工资4000元+奖金。', second = '王甲第二笔工资4000元。', source = sourceFor('😀' + first + second), text = source.blocks[0].text;
  const at = cp(text.slice(0, text.indexOf(second) + second.indexOf('4000元'))), gold = entry('4000元', second);
  const label = { expected: [gold], expected_event_ids: ['second'], events: [{ id: 'second', anchors: [{ blockId: 'b1', start: at, end: at + cp('4000元') }] }] };
  const row = assessCase({ id: 'round27-independent-events', source }, label, { raw_output: rawFor([entry('4000元', first)]), finish_reason: 'stop' });
  for (const scope of ['raw', 'accepted']) for (const mode of ['basic', 'relational', 'strict'])
    assert.deepEqual([row[scope + '_' + mode].tp, row[scope + '_' + mode].fp, row[scope + '_' + mode].fn], [0, 1, 1]);
  assert(row.production_defense.every(fact => !fact.calculation_authorized));
});
