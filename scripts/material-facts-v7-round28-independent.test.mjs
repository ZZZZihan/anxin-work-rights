import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Seven concrete post-b4974a3 findings plus the directly introduced subunit-crop safety closure. All sources and stored states are
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
const sourceFor = texts => ({ id: 'round28-independent', name: 'synthetic.txt', sha256: '7'.repeat(64), analysisRevision: 28, ready: true,
  blocks: (Array.isArray(texts) ? texts : [texts]).map((text, index) => ({ id: 'b' + (index + 1), page: 1, text, bbox: null, confidence: null })) });
const entry = (value, quote = value, extra = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual',
  meaning: 'other_money', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated', ...extra });
function stateFor(source, candidates, old = false) {
  const raw = rawFor(candidates), state = (old ? legacy : fresh)(emptyFactState(28), source, { raw }, 'independent', 'synthetic', '2026-10-18T21:00:00.000Z', null);
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
  console.log(JSON.stringify({ evidence: 'round28_implementation', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));

for (const [value, amount] of [['5角人民币', '0.50'], ['5角2分RMB', '0.52'], ['2分CNY', '0.02']])
  test('one explicit postposed RMB marker preserves the full subunit amount: ' + value, () => {
    assert.equal(money(value).amount, amount);
    checkMoney(moneyObservations(sourceFor('😀王甲工资' + value + '。'), value, {}, amount), amount);
  });
test('bare subunits and malformed or conflicting currency never gain an amount', () => {
  for (const value of ['5角', '2分', '5角2分', '5角2分RMB美元', '5角22分RMB']) assert.equal(money(value).amount, null);
});
test('a subunit tail cropped from the same full literal cannot become 0.02', () => {
  checkMoney(moneyObservations(sourceFor('😀王甲工资5角2分RMB。'), '2分RMB', {}, '0.02'), null);
});
test('adjacent blocks, whitespace and Cf cannot turn the tail of 5角2分RMB into 0.02', () => {
  for (const before of ['😀王甲工资5角', '😀王甲工资5角  ', '😀王甲工资5角\u200b'])
    checkMoney(moneyObservations(sourceFor([before, '2分RMB。']), '2分RMB', {}, '0.02'), null);
});
test('a sentence or another named person separates a genuine 0.02 payment', () => {
  for (const before of ['😀王甲工资5角。', '😀李乙工资5角。'])
    checkMoney(moneyObservations(sourceFor([before, '王甲另收2分RMB。']), '2分RMB', {}, '0.02'), '0.02');
});

for (const value of ['出勤率為百分之八十', '支付比例為80%', '百分比為80%'])
  test('a complete traditional percentage is rejected as amount-free while raw survives: ' + value, () => {
    for (const text of [value, value.replace('為', '为')]) {
      const item = entry(text), source = sourceFor('😀王甲' + text + '。'), state = stateFor(source, [item]);
      assert.equal(state.materials[0].candidates.length, 0);
      assert.equal(state.materials[0].rejected.length, 1);
      assert.match(state.materials[0].rejected[0].reason, /money 候选原文没有金额/u);
    }
  });
test('an attached percentage with real currency remains a review candidate, never its base amount', () => {
  checkMoney(moneyObservations(sourceFor('😀王甲工资4000元的80%。')), null);
});

function checkDate(text, value, meaning, supported = true) {
  const source = sourceFor('😀' + text + '。');
  for (const quote of [value, source.blocks[0].text]) {
    const item = entry(value, quote, { kind: 'date', meaning }), current = factFor(source, item, stateFor(source, [item]));
    const old = stateFor(source, [item], true), before = structuredClone(old), reviewed = reviewFactsAgainstSources(old, [source]);
    assert.deepEqual(old, before); assert.equal(reviewed.materials[0].raw, rawFor([item]));
    for (const fact of [current, factFor(source, item, reviewed)]) {
      assert.equal(fact.amount, null); assert.equal(fact.value, value);
      assert.equal(!fact.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), supported, JSON.stringify(fact.reviewIssues));
    }
  }
}
for (const [text, value] of [['王甲於2026年1月後入職', '2026年1月後'], ['王甲從2026年1月起任職', '從2026年1月起']])
  test('traditional boundary words inside the date value keep attribution: ' + value, () => checkDate(text, value, 'employment_period'));
test('a complete calendar payment deadline needs no receipt verb', () => {
  checkDate('王甲工资应于2026年1月15日前支付', '2026年1月15日前', 'payment_date');
  checkDate('王甲工資應於2026年1月15日前支付', '2026年1月15日前', 'payment_date');
});
test('postposed receipt on a calendar date is an already-supported baseline control', () =>
  checkDate('王甲于2026年1月15日收到工资', '2026年1月15日', 'payment_date'));
test('an employment date cannot borrow the payment-date role', () =>
  checkDate('王甲于2026年1月15日入职', '2026年1月15日', 'payment_date', false));

for (const subject of ['王月', '王日', '王时'])
  test('an anchored individual name ending in a rate-unit glyph does not create a rate: ' + subject, () => {
    const source = sourceFor('😀' + subject + '工资4000元。');
    checkMoney(moneyObservations(source, '4000元', { subject }), '4000.00');
  });
test('an explicit monthly rate survives, and a model subject cannot swallow 每月 into a false total', () => {
  checkMoney(moneyObservations(sourceFor('😀王甲每月工资4000元。'), '4000元', { meaning: 'rate', rateUnit: 'month' }), '4000.00');
  checkMoney(moneyObservations(sourceFor('😀王甲每月工资4000元。'), '4000元', { subject: '王甲每月' }), null);
});
for (const subject of ['王和平', '何和', '周及'])
  test('ROUND37 internal coordination requires review; terminal name glyphs stay supported: ' + subject, () => {
    const source = sourceFor('😀' + subject + '2026年1月全部应付工资合计4000元。');
    const rows = moneyObservations(source, '4000元', { subject, meaning: 'due_total', completeness: 'complete', period: '2026年1月' });
    checkMoney(rows, '4000.00');
    for (const row of rows) for (const fact of [row.fresh, row.storedExact])
      assert.equal(fact.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), subject === '王和平', JSON.stringify(fact.reviewIssues));
  });
test('an actual coordinated subject still cannot be certified as one individual', () => {
  const source = sourceFor('😀王甲和李乙2026年1月全部应付工资合计4000元。');
  const rows = moneyObservations(source, '4000元', { subject: '王甲和李乙', meaning: 'due_total', completeness: 'complete', period: '2026年1月' });
  for (const row of rows) assert(row.fresh.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'));
});

for (const suffix of ['以下列方式支付', '以上海银行卡支付', '以内部分配方式支付'])
  test('ordinary payment prose cannot become an amount bound: ' + suffix, () => {
    assert.equal(money('工资4000元' + suffix).amount, '4000.00');
    checkMoney(moneyObservations(sourceFor('😀王甲工资4000元' + suffix + '。')), '4000.00');
  });
test('real bounds remain unavailable rather than becoming ordinary prose', () => {
  for (const suffix of ['以上工资', '以下金额', '以内范围']) {
    assert.equal(money('4000元' + suffix).amount, null);
    checkMoney(moneyObservations(sourceFor('😀王甲工资4000元' + suffix + '。')), null);
  }
});
function noBorrow(source, expected, observed, anchorBlock, anchorText, eventId) {
  const text = source.blocks.find(block => block.id === anchorBlock).text;
  const at = cp(text.slice(0, text.indexOf(anchorText)));
  const label = { expected: [expected], expected_event_ids: [eventId], events: [{ id: eventId,
    anchors: [{ blockId: anchorBlock, start: at, end: at + cp(anchorText) }] }] };
  const row = assessCase({ id: 'round28-independent-events', source }, label, { raw_output: rawFor([observed]), finish_reason: 'stop' });
  for (const scope of ['raw', 'accepted']) for (const mode of ['basic', 'relational', 'strict'])
    assert.deepEqual([row[scope + '_' + mode].tp, row[scope + '_' + mode].fp, row[scope + '_' + mode].fn], [0, 1, 1]);
  assert(row.production_defense.every(fact => !fact.calculation_authorized));
}
test('six layers never score a cropped 0.02 tail as the full 0.52 literal', () => {
  const source = sourceFor('😀王甲工资5角2分RMB。');
  noBorrow(source, entry('5角2分RMB', source.blocks[0].text), entry('2分RMB', source.blocks[0].text), 'b1', '5角2分RMB', 'full-subunits');
});
test('an equal amount at another event cannot lend its gold anchor in any of six layers', () => {
  const source = sourceFor(['😀王甲第一笔工资5角2分RMB。', '王甲第二笔工资5角2分RMB。']);
  noBorrow(source, entry('5角2分RMB', source.blocks[1].text, { blockId: 'b2' }),
    entry('5角2分RMB', source.blocks[0].text), 'b2', '5角2分RMB', 'second-payment');
});
