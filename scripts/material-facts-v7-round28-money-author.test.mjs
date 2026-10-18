// Fixed synthetic ROUND28 author regressions; no HTTP/model/frozen data access.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OWN = fileURLToPath(new URL('../', import.meta.url));
const BASE = resolve(process.env.MATERIAL_FACT_TEST_ROOT || OWN);
const PATCH = resolve(process.env.MATERIAL_FACT_PATCH_ROOT || OWN);
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-round28-money-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(BASE, 'lib'), resolve(temporary, 'lib'), { recursive: true });
await cp(resolve(BASE, 'experiments/material-facts-v7/assess.mjs'), resolve(temporary, 'experiments/material-facts-v7/assess.mjs'), { recursive: true });
for (const file of ['material-money-v4.ts', 'material-fact-range-review.ts']) await cp(resolve(PATCH, 'lib', file), resolve(temporary, 'lib', file));
for (const [key, file] of [['MATERIAL_FACT_SOURCE_FILE', 'material-fact-source-review.ts'], ['MATERIAL_FACT_EVENT_FILE', 'material-fact-event-review.ts']])
  if (process.env[key]) await cp(process.env[key], resolve(temporary, 'lib', file));
const load = file => import(pathToFileURL(resolve(temporary, file)).href);
const { normalizeMoneyValueV4: parse, normalizeCandidateValueV4: normalize, classifyMonetaryExpression: classify, canonicalMonetaryExpression: canonical } = await load('lib/material-money-v4.ts');
const { attachedMoneyQualifierStatus: qualifier, hasMoneyRange: range } = await load('lib/material-fact-range-review.ts');
const { ingestRuntimeCandidates } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const { assessCase } = await load('experiments/material-facts-v7/assess.mjs');
const cpLength = value => Array.from(value).length;
const AT = '2026-10-18T00:00:00.000Z';
const modes = ['raw_basic', 'raw_relational', 'raw_strict', 'accepted_basic', 'accepted_relational', 'accepted_strict'];
function fixture(expression, { value = expression, fullQuote = false, nextBlock = null } = {}) {
  const source = { id: 'round28-author', name: '合成金额边界', sha256: 'a'.repeat(64), analysisRevision: 1, ready: true,
    blocks: [{ id: 'b1', page: 1, text: '😀王甲工资' + expression + (nextBlock === null ? '。' : ''), bbox: null, confidence: null }] };
  if (nextBlock !== null) source.blocks.push({ id: 'b2', page: 1, text: nextBlock + '。', bbox: null, confidence: null });
  const candidate = { kind: 'money', value, quote: fullQuote ? source.blocks[0].text : value, blockId: 'b1', subject: '王甲', scope: 'individual',
    meaning: 'arrears', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
  return { source, candidate, raw: JSON.stringify({ schemaVersion: 3, candidates: [candidate] }) };
}
function pipeline(f, amount) {
  const original = structuredClone(f);
  const check = fact => {
    assert(fact, 'money observation retained'); assert.equal(fact.amount, amount); assert.deepEqual(fact.representation, f.candidate);
    assert.equal(fact.value, f.candidate.value); assert.equal(fact.quote, f.candidate.quote);
    const text = f.source.blocks[0].text, start = cpLength(text.slice(0, text.indexOf(f.candidate.quote)));
    assert.deepEqual([fact.start, fact.end], [start, start + cpLength(f.candidate.quote)]);
    assert.equal(Array.from(text).slice(fact.start, fact.end).join(''), f.candidate.quote);
    assert.equal(fact.normalization.rawValue, f.candidate.value);
  };
  const fresh = ingestRuntimeCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'round28-author', AT);
  assert.equal(fresh.materials[0].raw, f.raw); check(fresh.materials[0].candidates[0]);
  assert.deepEqual(fresh.confirmations, { due: null, paid: null }); assert.equal(fresh.calculation, null);
  const history = ingestCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'round28-author', AT);
  const fact = history.materials[0].candidates[0]; assert(fact);
  fact.amount = amount ?? '4000.00'; fact.normalization = { rawValue: fact.value, amount: fact.amount, status: 'exact', matchedText: fact.value,
    span: { start: 0, end: cpLength(fact.value) }, reason: 'Synthetic historical exact.' };
  const stored = structuredClone(history), reviewed = reviewFactsAgainstSources(history, [f.source]);
  check(reviewed.materials[0].candidates[0]); assert.deepEqual(history, stored); assert.deepEqual(reviewed.history, history.history); assert.equal(reviewed.materials[0].raw, f.raw);
  fact.amount = null; fact.normalization = { rawValue: fact.value, amount: null, status: 'unsupported', matchedText: null, span: null, reason: 'Synthetic historical unsupported.' };
  const unavailable = structuredClone(history); assert.equal(reviewFactsAgainstSources(history, [f.source]).materials[0].candidates[0].amount, null);
  assert.deepEqual(history, unavailable); assert.deepEqual(f, original);
}
const amounts = [
  ['5角人民币', '0.50'], ['5角2分RMB', '0.52'], ['2分CNY', '0.02'], ['五角人民幣', '0.50'], ['伍角貳分人民币', '0.52'],
  ['兩分RMB', '0.02'], ['零角2分CNY', '0.02'], ['0分人民币', '0.00'], ['5角整人民币', '0.50'], ['2分正CNY', '0.02'],
  ['5角 rmb', '0.50'], ['2分 cny', '0.02'], ['5角\n人民币', '0.50'],
  ['人民币5角', '0.50'], ['RMB5角2分', '0.52'], ['CNY2分', '0.02'], ['5元人民币', '5.00'], ['五元五角2分', '5.52'],
];
for (const [value, amount] of amounts) test('complete explicit RMB subunits and neighboring supported literals: ' + JSON.stringify(value), () => {
  const raw = '😀' + value, parsed = parse(raw); assert.equal(parsed.amount, amount); assert.equal(parsed.status, 'exact'); assert.equal(parsed.rawValue, raw);
  assert.equal(parsed.matchedText, value); assert.deepEqual(parsed.span, { start: 1, end: 1 + cpLength(value) }); assert.equal(canonical(value), 'exact:' + amount);
});
for (const [value, amount] of amounts.filter(([value]) => !value.includes('\n'))) for (const fullQuote of [false, true])
  test('subunit raw/CP/fresh/history no-upgrade: ' + JSON.stringify({ value, fullQuote }), () => pipeline(fixture(value, { fullQuote }), amount));
const invalid = ['5角', '2分', '5角2分', '15角人民币', '12分RMB', '5角12分RMB', '2分5角人民币', '5角5角人民币', '2分2分CNY', '5角人民币5分', '5角2分RMB3',
  '5角人民币万元', '5角人民币人民币', 'RMB5角RMB', '5角人民币CNY', '5角RMB美元', '5角港币', '美元5角人民币', '5角人民币未知', '约5角人民币', '负5角人民币',
  '5角人民币的2倍', '5角人民币乘以提成率', '5角人民币/年', '5角度人民币', '5分钟人民币', '5角人民币至2分CNY'];
for (const value of invalid) test('subunit grammar does not guess or discard danger: ' + value, () => assert.equal(parse(value).amount, null));
for (const [expression, value] of [['5角2分RMB', '2分RMB'], ['5角人民币5分', '5角人民币'], ['5角2分RMB3', '5角2分RMB'], ['15角人民币', '5角人民币'], ['5角人民币至2分CNY', '5角人民币']])
  for (const fullQuote of [false, true]) test('source and history preserve complete subunit boundary: ' + JSON.stringify({ expression, value, fullQuote }), () => pipeline(fixture(expression, { value, fullQuote }), null));
for (const expression of ['5角人民币至6角人民币', '5角2分RMB到8角CNY', '人民币5角至6角RMB', '介于5角RMB和6角CNY之间'])
  test('explicit subunit endpoints remain a range: ' + expression, () => { assert(range(expression)); assert.equal(parse(expression).amount, null); });

const ratios = ['出勤率為百分之八十', '支付比例為80%', '百分比為80%', '比例為50%', '出勤比例為百分之五十', '计发比例為50%', '折算比例為80%',
  '出勤率 為 80％', '出勤率為80\u200d%', '出勤率\n為\n百分之八十', '出勤率为80%', '支付比例是百分之八十', '50%', '百分之五十'];
for (const value of ratios) test('complete percentage is definite non-money without rewriting raw: ' + JSON.stringify(value), () => {
  const f = fixture(value), got = classify(value); assert.equal(got.kind, 'not_monetary'); assert.equal(got.normalization.rawValue, value);
  const result = ingestRuntimeCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'round28-author', AT);
  assert.equal(result.materials[0].raw, f.raw); assert.equal(result.materials[0].candidates.length, 0); assert.equal(result.materials[0].rejected.length, 1);
  const row = assessCase({ id: 'ratio', source: f.source }, { id: 'ratio', expected: [], events: [], expected_event_ids: [] }, { finish_reason: 'stop', raw_output: f.raw });
  assert(row.protocol); for (const mode of modes) assert.deepEqual([row[mode].tp, row[mode].fp, row[mode].fn], mode.startsWith('raw_') ? [0, 1, 0] : [0, 0, 0]);
});
for (const value of ['四万元的50%', '4000元乘以出勤率為80%', '出勤率為未知', '支付比例為?', '百分比為**', '人民币未知', '人民币50%', '支付比例為80%工资4000元'])
  test('money or unknown ratio prose remains reviewable: ' + value, () => { assert.notEqual(classify(value).kind, 'not_monetary'); assert.equal(parse(value).amount, null); });

const prose = ['以下列方式支付', '以下述方式支付', '以下文说明为准', '以下表方式支付', '以上海银行卡支付', '以上述方式支付', '以上文说明支付', '以上表金额支付', '以上班记录支付',
  '以内部转账方式支付', '以内容清单列示', '以内控程序支付', '以内地银行卡支付', '以内陸银行卡支付', '以內部方式支付'];
for (const tail of prose) test('finite 以-word continuation is not an amount bound: ' + tail, () => {
  assert.equal(qualifier('', tail), null); assert.equal(parse('工资4000元' + tail).amount, '4000.00');
  for (const fullQuote of [false, true]) { const f = fixture('4000元' + tail, { value: '4000元', fullQuote }); assert.equal(normalize({ ...f.candidate, quote: f.source.blocks[0].text }).amount, '4000.00'); pipeline(f, '4000.00'); }
});
for (const tail of ['以下\n列方式支付', '以上\n海银行卡支付', '以内\n部方式支付', '以\u200d下列方式支付'])
  test('ordinary continuation detection preserves Unicode/layout raw: ' + JSON.stringify(tail), () => {
    assert.equal(parse('4000元' + tail).amount, '4000.00');
    // The existing source-clause boundary truncates an OCR-split ordinary word
    // at 以上/以下/以内. Keep that source-only availability limit conservative;
    // this parser patch does not upgrade an unavailable source review.
    pipeline(fixture('4000元' + tail, { value: '4000元', fullQuote: true }), tail.includes('\n') ? null : '4000.00');
  });
for (const tail of ['以上', '以下', '以内', '以內', '以上工资', '以下金额', '以内范围', '以上支付', '以下另议', '以内待核', '以外', '左右'])
  test('real bound and uncertainty remains unavailable: ' + tail, () => {
    assert.notEqual(qualifier('', tail), null); assert.equal(parse('4000元' + tail).amount, null);
    pipeline(fixture('4000元' + tail, { value: '4000元', fullQuote: true }), null);
  });
for (const [nextBlock, amount] of [['以下列方式支付', '4000.00'], ['以上海银行卡支付', '4000.00'], ['以内部转账支付', '4000.00'], ['以上', null], ['以下', null], ['以内', null], ['。王乙工资以下限4000元支付', '4000.00']])
  test('source-only layout edge retains finite boundary and separate event: ' + nextBlock, () => pipeline(fixture('4000元', { value: '4000元', nextBlock }), amount));

for (const [literal, amount] of [['5角人民币', '0.50'], ['5角2分RMB', '0.52'], ['2分CNY', '0.02']]) test('same registered event matches all six scoring modes after postfix parse: ' + literal, () => {
  const f = fixture(literal + '（' + amount + '元）', { value: literal });
  const text = f.source.blocks[0].text, expected = { ...f.candidate, value: amount + '元', quote: amount + '元' };
  const anchor = value => ({ blockId: 'b1', start: cpLength(text.slice(0, text.indexOf(value))), end: cpLength(text.slice(0, text.indexOf(value))) + cpLength(value) });
  const label = { id: 'same-event', expected: [expected], expected_event_ids: ['e1'], events: [{ id: 'e1', anchors: [anchor(literal), anchor(expected.value)] }] };
  const row = assessCase({ id: 'same-event', source: f.source }, label, { finish_reason: 'stop', raw_output: f.raw }); assert(row.protocol);
  for (const mode of modes) assert.deepEqual([row[mode].tp, row[mode].fp, row[mode].fn], [1, 0, 0]);
});
test('equal cents from another event cannot earn any of six true positives', () => {
  const f = fixture('5角2分RMB。王乙工资0.52元', { value: '5角2分RMB' }); const text = f.source.blocks[0].text;
  const anchor = value => ({ blockId: 'b1', start: cpLength(text.slice(0, text.indexOf(value))), end: cpLength(text.slice(0, text.indexOf(value))) + cpLength(value) });
  const label = { id: 'different-events', expected: [{ ...f.candidate, subject: '王乙', value: '0.52元', quote: '0.52元' }], expected_event_ids: ['e2'], events: [{ id: 'e1', anchors: [anchor(f.candidate.value)] }, { id: 'e2', anchors: [anchor('0.52元')] }] };
  const row = assessCase({ id: 'different-events', source: f.source }, label, { finish_reason: 'stop', raw_output: f.raw });
  for (const mode of modes) assert.deepEqual([row[mode].tp, row[mode].fp, row[mode].fn], [0, 1, 1]);
});
