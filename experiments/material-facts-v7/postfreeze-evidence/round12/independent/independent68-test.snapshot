import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Independent synthetic integration contracts; never reads a frozen case or calls a model.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const at = path => import(pathToFileURL(resolve(ROOT, path)));
const { normalizeMoneyValueV4, normalizeCandidateValueV4, canonicalMonetaryExpression, classifyMonetaryExpression } = await at('lib/material-money-v4.ts');
const { ingestRuntimeCandidates } = await at('lib/material-fact-runtime-ingest.ts');
const { moneyTokenHasNonCurrencySubunit } = await at('lib/material-fact-currency-review.ts');
const { reviewFactsAgainstSources } = await at('lib/material-fact-source-review.ts');
const { emptyFactState, ingestCandidates: ingestHistorical, buildFactView } = await at('lib/material-facts-v3.ts');
const { assessCase } = await at('experiments/material-facts-v7/assess.mjs');
const cp = text => Array.from(text).length;
const sourceFor = text => ({ id: 'round12-independent-source', name: 'synthetic-boundaries.txt',
  sha256: 'e'.repeat(64), analysisRevision: 12, ready: true,
  blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] });
const entry = (value, quote, changes = {}) => ({ kind: 'money', value, quote, blockId: 'b1',
  subject: '王甲', scope: 'individual', meaning: 'due_total', completeness: 'complete',
  period: null, rateUnit: null, assertion: 'narrated', ...changes });
const output = candidates => JSON.stringify({ schemaVersion: 3, candidates });
function ingest(source, candidates, historical = false) {
  const raw = output(candidates);
  const state = (historical ? ingestHistorical : ingestRuntimeCandidates)(emptyFactState(12), source,
    { raw }, 'independent-round12', 'synthetic-owner', '2026-10-18T16:00:00.000Z', null);
  assert.equal(state.materials[0].raw, raw);
  assert.deepEqual(JSON.parse(raw).candidates, candidates);
  assert.deepEqual(state.confirmations, { due: null, paid: null });
  assert.equal(state.calculation, null);
  assert.equal(buildFactView(state, [source]).canCalculate, false);
  return state;
}
function stored(source, candidate, state, amount) {
  assert.equal(state.materials[0].candidates.length, 1);
  const fact = state.materials[0].candidates[0];
  assert.equal(fact.amount, amount);
  assert.deepEqual(fact.representation, candidate);
  const block = source.blocks.find(block => block.id === candidate.blockId);
  const index = block.text.indexOf(candidate.quote);
  assert(index >= 0);
  assert.equal(fact.start, cp(block.text.slice(0, index)));
  assert.equal(fact.end, fact.start + cp(candidate.quote));
  return fact;
}
function unavailableInSource(text, value) {
  const source = sourceFor(text);
  for (const quote of [text, value]) {
    const candidate = entry(value, quote);
    if (quote === text) assert.equal(normalizeCandidateValueV4(candidate).amount, null, 'Full quote must expose the attached modifier.');
    stored(source, candidate, ingest(source, [candidate]), null);
    const old = ingest(source, [candidate], true), prior = old.materials[0].candidates[0];
    prior.amount = normalizeMoneyValueV4(value).amount ?? '40000.00';
    prior.normalization = { rawValue: value, status: 'exact', amount: prior.amount, matchedText: value,
      span: { start: 0, end: cp(value) }, reason: 'Synthetic previously exact history.' };
    const before = structuredClone(old), reviewed = reviewFactsAgainstSources(old, [source]);
    stored(source, candidate, reviewed, null);
    assert.deepEqual(old, before);
  }
}
function exactInSource(text, value, amount, changes = {}) {
  const source = sourceFor(text);
  for (const quote of [text, value]) {
    const candidate = entry(value, quote, changes);
    assert.equal(normalizeCandidateValueV4(candidate).amount, amount);
    stored(source, candidate, ingest(source, [candidate]), amount);
  }
}
function scores(text, candidate, expected, anchor, counts) {
  const input = { id: 'round12-score', source: sourceFor(text) }, start = text.indexOf(anchor);
  assert(start >= 0);
  const label = { id: input.id, schemaVersion: 3, label_status: 'provisional_non_expert', expected,
    events: expected.length ? [{ id: 'e1', anchors: [{ blockId: 'b1', start: cp(text.slice(0, start)), end: cp(text.slice(0, start + anchor.length)) }] }] : [],
    expected_event_ids: expected.map(() => 'e1'), acceptable_alternatives: [] };
  const result = { id: input.id, finish_reason: 'stop', raw_output: output([candidate]) };
  const before = structuredClone({ input, label, result }), row = assessCase(input, label, result);
  for (const scope of ['raw', 'accepted']) for (const layer of ['basic', 'relational', 'strict']) {
    const score = row[scope + '_' + layer];
    assert.deepEqual([score.tp, score.fp, score.fn], counts[scope], scope + '_' + layer);
  }
  assert.deepEqual({ input, label, result }, before);
  assert(row.production_defense.every(item => item.calculation_authorized === false));
  return row;
}
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-source-review.ts', 'lib/material-fact-arithmetic-review.ts',
  'lib/material-fact-runtime-ingest.ts', 'experiments/material-facts-v7/assess.mjs'])
  console.log(JSON.stringify({ evidence: 'implementation_hash', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));

for (const expression of ['四万元乘以实际出勤系数', '四万元乘以工龄系数', '四万元除以应出勤天数',
  '实际出勤系数乘以四万元', '四万元工资×实际出勤系数', '四万元乘以实\u200b际出勤系数', '四万元乘以实际出\n勤系数'])
  test('modified symbolic formula cannot expose its literal operand: ' + expression, () => {
    assert.equal(normalizeMoneyValueV4(expression).amount, null);
    assert.notEqual(canonicalMonetaryExpression(expression), canonicalMonetaryExpression('四万元'));
    unavailableInSource('😀王甲工资为' + expression + '。', '四万元');
  });
test('modified symbolic operand after an explicit operator in the next OCR block remains unavailable', () => {
  const source = sourceFor('😀王甲工资四万元');
  source.blocks.push({ id: 'b2', page: 1, text: '乘以实际出勤系数', bbox: null, confidence: null });
  const candidate = entry('四万元', '四万元');
  stored(source, candidate, ingest(source, [candidate]), null);
});
for (const text of ['😀王甲加班费四万元。', '😀王甲工资四万元，实际出勤系数另行核对。', '😀王甲等三人工资共四万元。'])
  test('symbolic guards preserve a literal wage or a lexical 加班费: ' + text, () => exactInSource(text, '四万元', '40000.00'));

for (const value of ['工资标准', '每月工资标准', '基本工资标准', '今日工资标准', '每月基本工资标准', '2024年5月工资标准', '岗位工资标准', '劳动报酬标准'])
  test('amount-free wage-standard label is rejected without erasing raw: ' + value, () => {
    assert.equal(classifyMonetaryExpression(value).kind, 'not_monetary');
    const text = '😀王甲材料标注：' + value + '。', candidate = entry(value, value), source = sourceFor(text);
    const state = ingest(source, [candidate]);
    assert.equal(state.materials[0].candidates.length, 0);
    assert.equal(state.materials[0].rejected.length, 1);
    assert.equal(state.materials[0].raw, output([candidate]));
    const old = ingest(source, [candidate], true), before = structuredClone(old);
    const reviewed = reviewFactsAgainstSources(old, [source]);
    assert.deepEqual(old, before);
    assert.equal(reviewed.materials[0].raw, before.materials[0].raw);
    assert.equal(reviewed.materials[0].candidates[0].amount, null);
  });
for (const value of ['工资标准不详', '工资标准若干元', '工资标准××元'])
  test('unknown wage standard remains reviewable instead of being called no amount: ' + value, () => {
    assert.notEqual(classifyMonetaryExpression(value).kind, 'not_monetary');
    const source = sourceFor('😀王甲' + value + '。'), candidate = entry(value, value);
    stored(source, candidate, ingest(source, [candidate]), null);
  });
for (const [value, amount] of [['4000元/月', '4000.00'], ['0元/月', '0.00']])
  test('a real stated wage-standard rate including zero remains exact: ' + value, () => {
    const text = '😀王甲工资标准' + value + '。';
    exactInSource(text, value, amount, { meaning: 'rate', completeness: 'not_applicable', rateUnit: 'month' });
  });

for (const [value, amount] of [['4000圓', '4000.00'], ['四千圓', '4000.00'], ['人民幣四千圓', '4000.00'],
  ['人民币4000圓', '4000.00'], ['5圓5角2分', '5.52'], ['四千圓五角二分', '4000.52']])
  test('supported traditional yuan keeps its original evidence and exact cents: ' + value, () => {
    const normalized = normalizeMoneyValueV4(value);
    assert.equal(normalized.amount, amount);
    assert.equal(normalized.rawValue, value);
    const text = '😀王甲工资' + value + '。', source = sourceFor(text);
    exactInSource(text, value, amount);
    const candidate = entry(value, value), old = ingest(source, [candidate], true), fact = old.materials[0].candidates[0];
    fact.amount = null;
    fact.normalization = { rawValue: value, status: 'unsupported', amount: null, matchedText: null, span: null, reason: 'Synthetic old unsupported spelling.' };
    const before = structuredClone(old);
    stored(source, candidate, reviewFactsAgainstSources(old, [source]), null);
    assert.deepEqual(old, before);
  });
for (const tail of ['5角', '/月', '每天']) for (const value of ['4000', '4000圓'])
  test('traditional yuan cannot hide omitted subunits or a rate behind a crop: ' + value + ' / ' + tail, () => {
    unavailableInSource('😀王甲工资4000圓' + tail + '。', value);
  });
test('a complete traditional yuan monthly rate stays exact with its stated role', () =>
  exactInSource('😀王甲工资标准4000圓/月。', '4000圓/月', '4000.00', { meaning: 'rate', completeness: 'not_applicable', rateUnit: 'month' }));
for (const text of ['😀王甲工资港幣4000圓。', '😀王甲工资按美元計4000圓。'])
  test('traditional yuan glyph does not turn an explicitly foreign amount into RMB: ' + text, () => unavailableInSource(text, '4000圓'));

for (const [tail, fragment] of [['5分钟后离开', '1000元5分'], ['5分鐘后离开', '1000元5分'],
  ['5分米长的材料', '1000元5分'], ['5分期结清', '1000元5分'], ['5角度的示意图', '1000元5角'], ['5角色的清单', '1000元5角']])
  test('a lexical fen or jiao suffix is not currency, even when the model crops the word: ' + tail, () => {
    const text = '😀王甲收到工资1000元' + tail + '。';
    const normalized = normalizeMoneyValueV4(text);
    assert.equal(normalized.amount, null, 'Conservative full-value rejection is allowed; a fabricated cent amount is not.');
    unavailableInSource(text, fragment);
  });
for (const [expression, fragment] of [['1000元5分之一', '1000元5分'], ['一千元五分之一', '一千元五分']])
  test('a fractional 分之一 continuation cannot be cropped into exact cents: ' + expression, () => {
    assert.equal(normalizeMoneyValueV4(expression).amount, null);
    unavailableInSource('😀王甲工资' + expression + '。', fragment);
  });
test('分之后 describes later payment after a genuine fen amount', () =>
  exactInSource('😀王甲收到1000元5分之后离开。', '1000元5分', '1000.05'));
for (const expression of ['約四千圓', '四千圓餘'])
  test('traditional approximation stays unavailable in the full value and cropped source: ' + expression, () => {
    const normalized = normalizeMoneyValueV4(expression);
    assert.equal(normalized.amount, null);
    assert.equal(normalized.rawValue, expression);
    const source = sourceFor('😀王甲工资' + expression + '。'), candidate = entry(expression, source.blocks[0].text);
    stored(source, candidate, ingest(source, [candidate]), null);
    unavailableInSource(source.blocks[0].text, '四千圓');
  });
test('the pre-existing yuan-only crop next to a minute count stays conservatively unavailable', () => {
  const source = sourceFor('😀王甲收到工资1000元5分钟后离开。'), candidate = entry('1000元', '1000元');
  stored(source, candidate, ingest(source, [candidate]), null);
});
for (const [value, amount] of [['1000元5分', '1000.05'], ['1000元5角', '1000.50'], ['5元5角2分', '5.52']])
  test('a genuine complete subunit amount is still exact: ' + value, () => {
    assert.equal(normalizeMoneyValueV4(value).amount, amount);
    exactInSource('😀王甲收到工资' + value + '，随后离开。', value, amount);
  });

test('a complete fen amount followed by 工资 remains a currency amount, not the ordinary word 分工', () => {
  // This private helper did not exist in the preserved baseline. The integration
  // assertion below remains the regression contract on both versions.
  if (typeof moneyTokenHasNonCurrencySubunit === 'function') {
    assert.equal(moneyTokenHasNonCurrencySubunit('1000元5分', '工资。'), false);
    assert.equal(moneyTokenHasNonCurrencySubunit('1000元5分', '钟后离开。'), true);
  }
  assert.equal(normalizeMoneyValueV4('王甲收到1000元5分工资。').amount, '1000.05');
  exactInSource('😀王甲收到1000元5分工资。', '1000元5分', '1000.05');
});

for (const after of ['至2024年5月仍未支付', '至4个月内付清', '到2025年1月才付清', '至四个月内付清', '到2024-05-01仍未支付', '至五天后支付'])
  test('a date or duration after 至/到 is not a second monetary endpoint: ' + after, () => {
    const text = '😀王甲拖欠工资3万元' + after + '。', value = '3万元', source = sourceFor(text);
    exactInSource(text, value, '30000.00');
    const candidate = entry(value, value), old = ingest(source, [candidate], true), prior = old.materials[0].candidates[0];
    prior.amount = null;
    prior.normalization = { rawValue: value, status: 'range', amount: null, matchedText: null, span: null, reason: 'Synthetic old overly conservative range.' };
    const before = structuredClone(old);
    stored(source, candidate, reviewFactsAgainstSources(old, [source]), null);
    assert.deepEqual(old, before, 'A corrected guard cannot auto-upgrade stored history.');
  });
for (const expression of ['3万元至4万元', '人民币3万元至人民币4万元', '3万元到4万'])
  test('a real complete money range still rejects either precise endpoint: ' + expression, () => {
    const text = '😀王甲工资为' + expression + '。';
    assert.equal(normalizeMoneyValueV4(expression).amount, null);
    unavailableInSource(text, '3万元');
  });

test('a formula operand cannot borrow the event of its complete symbolic expression in any score layer', () => {
  const text = '😀王甲工资四万元乘以实际出勤系数。';
  const row = scores(text, entry('四万元', text), [entry('四万元乘以实际出勤系数', text)],
    '四万元乘以实际出勤系数', { raw: [0, 1, 1], accepted: [0, 1, 1] });
  assert.equal(row.production_defense[0].amount, null);
});
test('no-amount standard contributes raw FP but no accepted FP across all six layers', () => {
  const text = '😀王甲工资标准。';
  scores(text, entry('工资标准', '工资标准'), [], '工资标准', { raw: [0, 1, 0], accepted: [0, 0, 0] });
});
test('a cropped duration-word fragment cannot score as the correctly stated yuan amount', () => {
  const text = '😀王甲收到工资1000元5分钟后离开。';
  const row = scores(text, entry('1000元5分', '1000元5分'), [entry('1000元', text)], '1000元', { raw: [0, 1, 1], accepted: [0, 1, 1] });
  assert.equal(row.production_defense[0].amount, null);
});
test('traditional and simplified yuan literals share a key at the same source event', () => {
  const text = '😀王甲收到工资4000圓。';
  assert.equal(canonicalMonetaryExpression('4000圓'), canonicalMonetaryExpression('4000圆'));
  const row = scores(text, entry('4000圓', text), [entry('4000圓', text)], '4000圓', { raw: [1, 0, 0], accepted: [1, 0, 0] });
  assert.equal(row.production_defense[0].amount, '4000.00');
});
