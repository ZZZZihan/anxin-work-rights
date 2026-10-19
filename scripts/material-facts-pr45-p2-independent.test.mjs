// Nonimplementer PR45 P2 acceptance: finite synthetic source/state controls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.MATERIAL_FACT_TEST_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const load = name => import(pathToFileURL(resolve(ROOT, 'lib', name + '.ts')).href);
const { normalizeMoneyValueV4: parse } = await load('material-money-v4');
const { emptyFactState, ingestCandidates: legacy, validateCandidateOutput, buildFactView } = await load('material-facts-v3');
const { ingestRuntimeCandidates: fresh } = await load('material-fact-runtime-ingest');
const { reviewFactsAgainstSources: review } = await load('material-fact-source-review');
const AT = '2026-10-19T08:00:00.000Z', cp = value => Array.from(value).length;
const evidence = value => { if (process.env.PR45_INDEPENDENT_EVIDENCE) appendFileSync(process.env.PR45_INDEPENDENT_EVIDENCE, JSON.stringify(value) + '\n'); };
const money = (value, changes = {}) => ({kind: 'money', value, quote: value, blockId: 'b1', subject: '王甲', scope: 'individual',
  meaning: 'other_money', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated', ...changes});
const date = (value, changes = {}) => money(value, {kind: 'date', meaning: 'payment_date', ...changes});

function pipeline(id, text, item, { amount = item.kind === 'date' ? null : '400.00', relation = true,
  due = [], paid = [], next = null } = {}) {
  const blocks = [{ id: 'b1', page: 1, text, bbox: null, confidence: null }];
  if (next !== null) blocks.push({id: 'b2', page: 2, text: next, bbox: null, confidence: null});
  const source = { id: 'pr45-independent-' + id, name: 'synthetic.txt', sha256: '7'.repeat(64), analysisRevision: 45, ready: true, blocks };
  for (const quote of [item.value, text]) {
    const entry = {...item, quote}, raw = JSON.stringify({schemaVersion: 3, candidates: [entry]});
    const savedInput = structuredClone({source, entry});
    const validated = validateCandidateOutput(raw, source);
    assert.equal(validated.candidates.length, 1, 'Use a valid eleven-field source-bound candidate.');
    const history = legacy(emptyFactState(45), source, {raw}, 'synthetic', 'independent-review', AT);
    const storedFact = history.materials[0].candidates[0];
    if (entry.kind === 'money') {
      // Source review may downgrade a persisted exact value; it cannot upgrade an old null.
      Object.assign(storedFact, {amount: amount ?? '400.00', normalization: {rawValue: entry.value, status: 'exact',
        amount: amount ?? '400.00', matchedText: entry.value, span: {start: 0, end: cp(entry.value)}, reason: 'Synthetic persisted exact.'}});
    }
    const previous = structuredClone(history);
    for (const [mode, state] of [['fresh', fresh(emptyFactState(45), source, {raw}, 'synthetic', 'independent-review', AT)],
      ['stored-read', review(history, [source])]]) {
      const fact = state.materials[0].candidates[0];
      assert.ok(fact, 'Unsupported candidates remain available for review.');
      const scoped = structuredClone(state);
      scoped.scope = {worker: '王甲', employer: '甲公司', start: '2026-01-01', end: '2026-01-31'};
      scoped.scopeReview = {note: 'Synthetic scope; no amount confirmation.', actor: 'independent-review', at: AT};
      const view = buildFactView(scoped, [source]);
      evidence({id, mode, quote, entry, source, fact, fields: view.fields, canCalculate: view.canCalculate});
      assert.equal(fact.amount, amount, mode + ' amount');
      assert.equal(fact.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), !relation, mode + ' owner/role/period relation');
      assert.equal(fact.normalization.rawValue, entry.value);
      assert.deepEqual(fact.representation, entry); assert.equal(state.materials[0].raw, raw);
      assert.equal(fact.value, entry.value); assert.equal(fact.quote, quote);
      const start = cp(text.slice(0, text.indexOf(quote)));
      assert.deepEqual([fact.start, fact.end], [start, start + cp(quote)]);
      assert.equal(Array.from(text).slice(fact.start, fact.end).join(''), quote);
      assert.deepEqual(view.fields.due.values, due); assert.deepEqual(view.fields.paid.values, paid);
      assert.equal(view.canCalculate, false); assert.deepEqual(scoped.confirmations, {due: null, paid: null}); assert.equal(scoped.calculation, null);
    }
    assert.deepEqual(history, previous, 'Stored-state review is read-only.');
    if (entry.kind === 'money') {
      Object.assign(storedFact, {amount: null, normalization: {rawValue: entry.value, status: 'unsupported', amount: null,
        matchedText: null, span: null, reason: 'Synthetic historical unavailable.'}});
      const nullHistory = structuredClone(history), rechecked = review(history, [source]);
      assert.equal(rechecked.materials[0].candidates[0].amount, null, 'New grammar never upgrades persisted null money.');
      assert.deepEqual(history, nullHistory); assert.deepEqual(rechecked.history, nullHistory.history);
    }
    assert.deepEqual({source, entry}, savedInput);
  }
}

for (const value of ['¥四千', '￥四千', '¥肆仟', '￥肆仟', '¥兩千', '￥貳仟']) {
  const expected = /兩|貳/u.test(value) ? '2000.00' : '4000.00';
  test('one explicit RMB symbol supplies the omitted yuan unit: ' + value, () => {
    const result = parse(value); evidence({id: 'symbol-parse', value, result});
    assert.equal(result.amount, expected); assert.equal(result.status, 'exact');
    assert.equal(result.rawValue, value); assert.equal(result.matchedText, value);
    assert.deepEqual(result.span, {start: 0, end: cp(value)});
    pipeline('symbol-positive', '😀王甲2026年1月应付工资总额' + value + '。', money(value,
      {meaning: 'due_total', completeness: 'complete', period: '2026年1月'}), {amount: expected, due: [expected]});
  });
}
for (const [value, amount] of [['¥4000', '4000.00'], ['￥四千元', '4000.00'], ['人民币四千', '4000.00'], ['肆仟元', '4000.00']])
  test('existing RMB spellings retain exactness: ' + value, () => assert.equal(parse(value).amount, amount));
for (const value of ['¥四千￥', '¥四千人民币', '人民币¥四千', '¥四千美元', '¥四千至五千', '¥四千×2', '¥四千待定', '¥四千分之二'])
  test('symbol does not discard unsafe currency or numerical continuation: ' + value, () => {
    assert.equal(parse(value).amount, null);
    pipeline('symbol-unsafe', '😀王甲工资' + value + '。', money(value), {amount: null});
  });
for (const tail of ['￥', '美元', '至五千', '×2', '待定'])
  test('clipped symbol value cannot hide an unsafe source continuation: ' + tail, () => pipeline('symbol-clipped-unsafe',
    '😀王甲工资¥四千' + tail + '。', money('¥四千'), {amount: null, relation: false}));
for (const [text, item, opts] of [
  ['😀王甲2026年1月应付工资总额¥四千。李乙工资待定。', money('¥四千', {subject: '李乙', meaning: 'due_total', completeness: 'complete', period: '2026年1月'}), {amount: '4000.00', relation: false}],
  ['😀王甲2026年1月应付工资总额¥四千。李乙2026年2月应付工资总额5000元。', money('¥四千', {meaning: 'due_total', completeness: 'complete', period: '2026年2月'}), {amount: '4000.00', relation: false}],
  ['😀王甲月工资为¥四千。', money('¥四千', {meaning: 'due_total', completeness: 'complete', period: null}), {amount: null, relation: false}],
]) test('symbol precision cannot establish a missing owner, period or total role: ' + text + JSON.stringify(item), () => pipeline('symbol-attribution', text, item, opts));

for (const verb of ['到账', '收到']) for (const value of ['1月15日', '十二月三十一日', '１２月３１日'])
  test('yearless wage receipt keeps its whole date literal: ' + value + verb, () => pipeline('yearless-positive',
    '😀王甲工资于' + value + verb + '。', date(value)));
test('year-bearing receipt compatibility', () => pipeline('year-bearing', '😀王甲工资于2026年1月15日到账。', date('2026年1月15日')));
for (const [value, text, changes = {}, next = null] of [
  ['1月15日', '😀王甲工资于1月15日未到账。'],
  ['1月15日', '😀王甲工资于1月15日收到。李乙工资待定。', {subject: '李乙'}],
  ['1月15日', '😀王甲工资于1月15日李乙收到。'],
  ['1月15日', '😀王甲工资于1月15日到账。', {meaning: 'wage_period'}],
  ['1月15日', '😀王甲工资于1月15日到账。', {meaning: 'employment_period'}],
  ['1月15日', '😀王甲工资于1月15日到账。', {scope: 'organization'}],
  ['1月15日', '😀王甲工资于1月15日前到账。'],
  ['1月15日前', '😀王甲工资于1月15日前到账。'],
  ['1月15日', '😀王甲工资于2026年1月15日到账。'],
  ['1月15日', '😀王甲工资于1月15日。李乙收到。'],
  ['1月15日', '😀王甲工资于1月15日', {}, '到账。'],
  ['13月15日', '😀王甲工资于13月15日到账。'],
  ['1月32日', '😀王甲工资于1月32日收到。'],
]) test('yearless receipt refuses cropped boundary, wrong owner, role, calendar or other event: ' + text + JSON.stringify(changes),
  () => pipeline('yearless-negative', text, date(value, changes), {relation: false, next}));

for (const [label, unit] of [['月工资', 'month'], ['日工资', 'day'], ['小时工资', 'hour'], ['计件工资', 'piece']]) {
  const text = `😀王甲2026年1月${label}为400元。`;
  test('explicit wage-rate label has its correct unit and cannot suggest totals: ' + label, () => pipeline('rate-positive', text,
    money('400元', {meaning: 'rate', period: '2026年1月', rateUnit: unit})));
  test('unperiodized literal wage-rate label remains attributed: ' + label, () => pipeline('rate-no-period',
    `😀王甲${label}为400元。`, money('400元', {meaning: 'rate', rateUnit: unit})));
  test('explicit wage-rate label rejects a different unit: ' + label, () => pipeline('rate-wrong-unit', text,
    money('400元', {meaning: 'rate', period: '2026年1月', rateUnit: unit === 'month' ? 'hour' : 'month'}), {amount: null, relation: false}));
  test('explicit wage-rate label cannot become a complete due total: ' + label, () => pipeline('rate-as-total', text,
    money('400元', {meaning: 'due_total', completeness: 'complete', period: '2026年1月'}), {amount: null, relation: false}));
  test('rate owner cannot be borrowed from another source event: ' + label, () => pipeline('rate-wrong-owner', text + '李乙2026年1月工资待定。',
    money('400元', {subject: '李乙', meaning: 'rate', period: '2026年1月', rateUnit: unit}), {relation: false}));
}
test('rate period cannot be borrowed from another source event', () => pipeline('rate-wrong-period',
  '😀王甲2026年1月月工资为400元。李乙2026年2月工资待定。', money('400元', {meaning: 'rate', period: '2026年2月', rateUnit: 'month'}), {relation: false}));
for (const [text, period, unit] of [
  ['😀王甲2026年1月工资为400元。', '2026年1', 'month'],
  ['😀王甲2026年1月15日工资为400元。', '2026年1月15', 'day'],
  ['😀王甲２０２６年１月工资为400元。', '２０２６年１', 'month'],
  ['😀王甲二〇二六年一月工资为400元。', '二〇二六年一', 'month'],
  ['😀王甲2026年工资为400元。', '2026', 'month'],
]) test('a cropped calendar period cannot create a naked rate prefix: ' + period, () => pipeline('rate-calendar-crop', text,
  money('400元', {meaning: 'rate', period, rateUnit: unit}), {relation: false}));
for (const [period, label, unit] of [['2026年', '月工资', 'month'], ['2026年1月', '月工资', 'month'],
  ['2026年1月15日', '日工资', 'day']])
  test('a complete calendar period may precede its separate literal rate label: ' + period + label, () => pipeline('rate-complete-period',
    '😀王甲' + period + label + '为400元。', money('400元', {meaning: 'rate', period, rateUnit: unit})));
test('year-month wage label remains a period rather than an automatic monthly rate', () => pipeline('calendar-wage-period',
  '😀王甲2026年1月应付工资总额400元。', money('400元', {meaning: 'due_total', completeness: 'complete', period: '2026年1月'}), {due: ['400.00']}));
