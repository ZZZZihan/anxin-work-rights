import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Five concrete post-ec8 findings, with finite positive controls. No model,
// Worker, real material, confirmation, or mutation of a historical fact store.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(ROOT, path)));
const { normalizeMoneyValueV4: money, normalizeCandidateValueV4: normalize, classifyMonetaryExpression: classify } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates: fresh } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, buildFactView } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const { assessCase } = await load('experiments/material-facts-v7/assess.mjs');
const cp = text => Array.from(text).length;
const rawFor = candidates => JSON.stringify({ schemaVersion: 3, candidates });
const sourceFor = texts => ({ id: 'round26-independent', name: 'synthetic.txt', sha256: '6'.repeat(64), analysisRevision: 26, ready: true,
  blocks: (Array.isArray(texts) ? texts : [texts]).map((text, index) => ({ id: 'b' + (index + 1), page: 1, text, bbox: null, confidence: null })) });
const entry = (value, quote = value, extra = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual',
  meaning: 'other_money', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated', ...extra });
function stateFor(source, candidates, old = false) {
  const raw = rawFor(candidates), state = (old ? legacy : fresh)(emptyFactState(26), source, { raw }, 'independent', 'synthetic', '2026-10-18T20:00:00.000Z', null);
  assert.equal(state.materials[0].raw, raw);
  assert.deepEqual(state.confirmations, { due: null, paid: null });
  assert.equal(state.calculation, null); assert.equal(buildFactView(state, [source]).canCalculate, false);
  return state;
}
function factFor(source, item, state) {
  assert.equal(state.materials[0].candidates.length, 1, 'Accepted review candidates are distinct from usable derived amounts.');
  const fact = state.materials[0].candidates[0], text = source.blocks.find(block => block.id === item.blockId).text;
  const at = text.indexOf(item.quote); assert(at >= 0); assert.equal(text.indexOf(item.quote, at + 1), -1);
  assert.deepEqual(fact.representation, item); assert.equal(fact.start, cp(text.slice(0, at))); assert.equal(fact.end, fact.start + cp(item.quote));
  return fact;
}
function historical(source, item, status) {
  const state = stateFor(source, [item], true), fact = factFor(source, item, state), amount = status === 'exact' ? '4000.00' : null;
  fact.amount = amount;
  fact.normalization = { rawValue: item.value, status, amount, matchedText: item.value, span: { start: 0, end: cp(item.value) }, reason: 'Synthetic stored state, never confirmed.' };
  const before = structuredClone(state), reviewed = reviewFactsAgainstSources(state, [source]);
  assert.deepEqual(state, before); assert.equal(reviewed.materials[0].raw, rawFor([item]));
  assert.equal(buildFactView(reviewed, [source]).canCalculate, false);
  return factFor(source, item, reviewed);
}
function observations(source, value = '4000元', extra = {}) {
  const rows = [], block = source.blocks.find(item => item.text.includes(value));
  assert(block);
  for (const quote of [value, block.text]) {
    const item = entry(value, quote, { ...extra, blockId: block.id }), current = factFor(source, item, stateFor(source, [item]));
    rows.push({ quote, quoteAmount: normalize(item).amount, fresh: current.amount, freshStatus: current.normalization.status, issues: current.reviewIssues.map(issue => issue.code),
      storedExact: historical(source, item, 'exact').amount, storedUnsupported: historical(source, item, 'unsupported').amount });
  }
  return rows;
}
function checkAmounts(rows, amount) {
  for (const row of rows) {
    assert.equal(row.fresh, amount, JSON.stringify(row)); assert.equal(row.storedExact, amount, JSON.stringify(row));
    assert.equal(row.storedUnsupported, null, 'Reading an old unavailable amount must not upgrade it.');
  }
}
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-range-review.ts', 'lib/material-fact-source-review.ts', 'lib/material-fact-event-review.ts', 'lib/material-fact-runtime-ingest.ts', 'experiments/material-facts-v7/assess.mjs']) {
  const bytes = await readFile(resolve(ROOT, path));
  console.log(JSON.stringify({ evidence: 'round26_implementation', path, sha256: createHash('sha256').update(bytes).digest('hex') }));
}

for (const symbol of ['≤', '≥', '<', '>', '≦', '≧'])
  test('a comparison bound is never its exact endpoint: ' + symbol, () => {
    const observed = [];
    for (const layout of ['same', 'newline', 'block']) {
      const lead = '😀𠮷。王甲工资' + symbol;
      const source = sourceFor(layout === 'block' ? [lead, '4000元。'] : lead + (layout === 'newline' ? '\n' : '') + '4000元。');
      observed.push({ layout, rows: observations(source) });
    }
    console.log(JSON.stringify({ evidence: 'comparison_bound', symbol, literal: money(symbol + '4000元'), observed }));
    assert.equal(money(symbol + '4000元').amount, null);
    for (const { layout, rows } of observed) {
      checkAmounts(rows, null);
      if (layout === 'same') assert.equal(rows[1].quoteAmount, null);
    }
  });

for (const tail of ['（金额待核实）', '金额待定', '（数额未知）'])
  test('an amount-label bridge cannot hide uncertainty through quote or source cropping: ' + tail, () => {
    for (const layout of ['same', 'newline', 'block']) {
      const lead = '😀𠮷。王甲工资4000元';
      const source = sourceFor(layout === 'block' ? [lead, tail + '。'] : lead + (layout === 'newline' ? '\n' : '') + tail + '。');
      const rows = observations(source);
      console.log(JSON.stringify({ evidence: 'amount_label_uncertainty', tail, layout, rows }));
      checkAmounts(rows, null);
      if (layout === 'same') assert.equal(rows[1].quoteAmount, null);
    }
  });

test('a bound or labelled uncertainty in another sentence does not poison an ordinary amount', () => {
  for (const tail of ['李乙工资≤5000元。', '李乙工资金额待定。']) {
    const source = sourceFor('😀𠮷。王甲工资4000元。' + tail);
    checkAmounts(observations(source), '4000.00');
  }
});
test('a different person in the next block is not an attached amount-label bridge', () => {
  const source = sourceFor(['😀𠮷。王甲工资4000元。', '李乙工资金额待定。']);
  checkAmounts(observations(source), '4000.00');
});

for (const [suffix, unit] of [['按月计', 'month'], ['按日计', 'day'], ['按小时计', 'hour'], ['按件计酬', 'piece']])
  test('a supported postposed denominator requires its rate role and unit: ' + suffix, () => {
    const source = sourceFor('😀𠮷。王甲工资4000元' + suffix + '。');
    const totals = observations(source, '4000元', { meaning: 'due_total', completeness: 'complete' });
    console.log(JSON.stringify({ evidence: 'postposed_rate', suffix, totals }));
    checkAmounts(totals, null);
    const rates = observations(source, '4000元', { meaning: 'rate', rateUnit: unit });
    checkAmounts(rates, '4000.00');
    for (const row of rates) {
      assert.equal(row.quoteAmount, '4000.00');
      assert(!row.issues.includes('source_relation_unresolved'), JSON.stringify(row));
    }
    checkAmounts(observations(source, '4000元', { meaning: 'rate', rateUnit: unit === 'month' ? 'day' : 'month' }), null);
  });
for (const suffix of ['按时支付', '按月15日发放'])
  test('ordinary timing prose is not a supported denominator: ' + suffix, () =>
    checkAmounts(observations(sourceFor('😀𠮷。王甲工资4000元' + suffix + '。')), '4000.00'));

for (const value of ['實付工資', '工資合計', '薪酬總額', '人民币', '人民幣', 'RMB', 'CNY', '元', '圆', '￥'])
  test('a complete name or denomination contains no monetary amount: ' + value, () => {
    const classification = classify(value), source = sourceFor('😀𠮷。王甲材料记载' + value + '。'), item = entry(value);
    const state = stateFor(source, [item]);
    console.log(JSON.stringify({ evidence: 'no_amount_label', value, classification, accepted: state.materials[0].candidates.length, rejected: state.materials[0].rejected.length }));
    assert.equal(classification.kind, 'not_monetary'); assert.equal(state.materials[0].candidates.length, 0);
    assert.equal(state.materials[0].rejected.length, 1); assert.deepEqual(JSON.parse(state.materials[0].raw).candidates, [item]);
  });
for (const value of ['人民币未知', '實付工資未知'])
  test('an explicitly unknown amount is retained as a review candidate: ' + value, () => {
    const source = sourceFor('😀𠮷。王甲材料记载' + value + '。'), item = entry(value);
    const fact = factFor(source, item, stateFor(source, [item]));
    assert.notEqual(classify(value).kind, 'not_monetary'); assert.equal(fact.amount, null);
  });

test('the same endpoint in a different event cannot supply a true positive in any of six layers', () => {
  const first = '王甲第一笔工资≤4000元。', second = '王甲第二笔工资4000元。';
  const source = sourceFor('😀𠮷。' + first + second), text = source.blocks[0].text;
  const gold = entry('4000元', second), at = cp(text.slice(0, text.indexOf(second) + second.indexOf('4000元')));
  const label = { expected: [gold], expected_event_ids: ['second'], events: [{ id: 'second', anchors: [{ blockId: 'b1', start: at, end: at + cp('4000元') }] }] };
  const row = assessCase({ id: 'r26-event-isolation', source }, label, { raw_output: rawFor([entry('4000元', first)]), finish_reason: 'stop' });
  for (const layer of ['raw', 'accepted']) for (const mode of ['basic', 'relational', 'strict'])
    assert.deepEqual([row[layer + '_' + mode].tp, row[layer + '_' + mode].fp, row[layer + '_' + mode].fn], [0, 1, 1]);
  assert(row.production_defense.every(fact => !fact.calculation_authorized));
});
