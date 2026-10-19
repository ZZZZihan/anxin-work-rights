import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Synthetic parser, exact-evidence and historical read contracts. No inference.
const OWN = fileURLToPath(new URL('../', import.meta.url));
const BASE = resolve(process.env.V7_ROUND20_BASE_ROOT || OWN);
const PATCH = resolve(process.env.V7_ROUND20_PATCH_ROOT || OWN);
const temp = await mkdtemp(resolve(tmpdir(), 'anxin-round20-money-author-'));
after(() => rm(temp, { recursive: true, force: true }));
await cp(resolve(BASE, 'lib'), resolve(temp, 'lib'), { recursive: true });
for (const name of ['material-money-v4.ts', 'material-fact-arithmetic-review.ts']) {
  await cp(resolve(PATCH, 'lib', name), resolve(temp, 'lib', name));
  console.log(JSON.stringify({ file: name, sha256: createHash('sha256').update(await readFile(resolve(temp, 'lib', name))).digest('hex') }));
}
if (process.env.V7_ROUND20_CURRENCY_FILE) await cp(process.env.V7_ROUND20_CURRENCY_FILE, resolve(temp, 'lib/material-fact-currency-review.ts'));
const load = name => import(pathToFileURL(resolve(temp, 'lib', name)).href);
const { normalizeMoneyValueV4: money, normalizeCandidateValueV4: normalize, canonicalMonetaryExpression: canonical } = await load('material-money-v4.ts');
const { hasAttachedMoneyArithmetic: arithmetic } = await load('material-fact-arithmetic-review.ts');
const { ingestRuntimeCandidates: fresh } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, buildFactView } = await load('material-facts-v3.ts');
const { reviewFactsAgainstSources: review } = await load('material-fact-source-review.ts');
const cpLength = text => Array.from(text).length;
const PREFIX = '😀𠮷王甲工资为';
const entry = (value, quote = value, changes = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'arrears', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated', ...changes });
function fixture(value, expression = value, fullQuote = false, changes = {}) {
  const text = PREFIX + expression + '。', candidate = entry(value, fullQuote ? text : value, changes);
  return { candidate, raw: JSON.stringify({ schemaVersion: 3, candidates: [candidate] }), source: { id: 'round20-author', name: '合成系数比例与传统万', sha256: 'e'.repeat(64), analysisRevision: 20, ready: true,
    blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] } };
}
function ingest(f, historical = false) {
  const before = structuredClone(f.source);
  const state = (historical ? legacy : fresh)(emptyFactState(20), f.source, { raw: f.raw }, 'round20-author', 'synthetic', '2026-10-18T00:00:00Z');
  assert.deepEqual(f.source, before); assert.equal(state.materials[0].raw, f.raw); assert.equal(state.materials[0].candidates.length, 1);
  assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null); assert.equal(buildFactView(state, [f.source]).canCalculate, false);
  const fact = state.materials[0].candidates[0]; assert.deepEqual(fact.representation, f.candidate);
  assert.equal(Array.from(f.source.blocks[0].text).slice(fact.start, fact.end).join(''), f.candidate.quote);
  assert.equal(fact.start, cpLength(f.source.blocks[0].text.slice(0, f.source.blocks[0].text.indexOf(f.candidate.quote))));
  return state;
}
function history(f, storedAmount, expected) {
  const state = ingest(f, true), candidate = state.materials[0].candidates[0];
  Object.assign(candidate, { amount: storedAmount, normalization: { rawValue: f.candidate.value, status: storedAmount === null ? 'unsupported' : 'exact', amount: storedAmount,
    matchedText: storedAmount === null ? null : f.candidate.value, span: storedAmount === null ? null : { start: 0, end: cpLength(f.candidate.value) }, reason: 'Synthetic pre-fix history.' } });
  const before = structuredClone(state), checked = review(state, [f.source]);
  assert.equal(checked.materials[0].candidates[0].amount, expected); assert.deepEqual(state, before);
  assert.equal(checked.materials[0].raw, f.raw); assert.deepEqual(checked.materials[0].candidates[0].representation, f.candidate);
}
function unavailable(expression, value = '四万元') {
  for (const fullQuote of [false, true]) {
    const f = fixture(value, expression, fullQuote);
    assert.equal(normalize({ ...f.candidate, quote: f.source.blocks[0].text }).amount, null);
    assert.equal(ingest(f).materials[0].candidates[0].amount, null); history(f, '40000.00', null);
  }
}
function exact(value, amount) {
  const parsed = money(value); assert.equal(parsed.amount, amount); assert.equal(parsed.status, 'exact');
  assert.equal(parsed.rawValue, value); assert.equal(parsed.matchedText, value); assert.deepEqual(parsed.span, { start: 0, end: cpLength(value) });
  assert.equal(canonical(value), 'exact:' + amount);
  const embedded = money(PREFIX + value); assert.equal(embedded.amount, amount); assert.deepEqual(embedded.span, { start: cpLength(PREFIX), end: cpLength(PREFIX + value) });
  for (const fullQuote of [false, true]) {
    const f = fixture(value, value, fullQuote); assert.equal(normalize(f.candidate).amount, amount); assert.equal(ingest(f).materials[0].candidates[0].amount, amount);
    history(f, amount, amount); history(f, null, null);
  }
}

test('minimal unlisted coefficient operand remains non-exact', () => {
  assert.equal(money('四万元乘以提成比例').amount, null); unavailable('四万元乘以提成比例');
});
test('minimal traditional wan retains an exact unmodified token', () => exact('人民幣四萬圓', '40000.00'));
const names = ['提成比例', '社保缴费比例', '奖金系数', '住房公积金缴存比例', '年终奖励系数', '绩效工资调整比例', '甲乙丙丁新自定义系数', '社保繳費比例', '獎金系數'];
for (const name of names) for (const operator of ['乘以', '除以', '×', '+', '加上']) test('bounded coefficient name requires adjacent explicit operator: ' + operator + name, () => {
  assert.equal(arithmetic('', operator + name), true);
  assert.equal(money('四万元' + operator + name).amount, null); unavailable('四万元' + operator + name);
});
for (const [before, after] of [['提成比例乘以', ''], ['社保缴费比例×', ''], ['獎金系數除以', ''], ['', '基本工资乘以奖金系数'], ['', '的提成比例倍'], ['', '的社保缴费比例%']])
  test('coefficient operand supports existing explicit prefix/fraction/noun routes: ' + before + '|' + after, () => {
    assert.equal(arithmetic(before, after), true);
    const expression = before + '四万元' + after; assert.equal(money(expression).amount, null); unavailable(expression);
  });
for (const tail of ['乘\n以提成比例', '乘以提\n成比\n例', '乘以社保\r\n缴费比例', '×獎金系\n數', '乘以提\u200d成比例', ' 乘 以 社 保 缴 费 比 例'])
  test('explicit coefficient layout/Cf detection keeps raw evidence intact: ' + JSON.stringify(tail), () => unavailable('四万元' + tail));
for (const tail of ['乘以\n提成比例', '乘以社保缴费比例', '×獎金系數']) test('new named operand can complete in an adjacent OCR block: ' + JSON.stringify(tail), () => {
  const f = fixture('四万元'); f.source.blocks[0].text = PREFIX + '四万元' + tail.slice(0, tail.startsWith('×') ? 1 : 2);
  f.source.blocks.push({ id: 'b2', page: 1, text: tail.slice(tail.startsWith('×') ? 1 : 2), bbox: null, confidence: null });
  assert.equal(ingest(f).materials[0].candidates[0].amount, null); history(f, '40000.00', null);
});
for (const [before, after] of [['', '加班费按提成比例发放'], ['', '加班工资按社保缴费比例另行核对'], ['', '除外另有提成比例'], ['', '。王乙奖金系数为2'], ['', '，王乙按提成比例支付'], ['', '乘以，王乙奖金系数另议'], ['', '\n王乙奖金系数另议'], ['提成比例已经核定，王甲工资', ''], ['', '/月'], ['', '加\n班费按提成比例发放'], ['', '除\n外另有奖金系数'], ['', '加薪后调整奖金系数']])
  test('ordinary nouns, punctuation and another event cannot become coefficient math: ' + before + '|' + after, () => assert.equal(arithmetic(before, after), false));
for (const [value, amount] of [['四萬圓', '40000.00'], ['人民幣四萬圓', '40000.00'], ['人民币四萬元', '40000.00'], ['人民幣 四萬 圓', '40000.00'], ['4萬元', '40000.00'], ['肆萬圓', '40000.00'], ['人民幣肆萬圓五角2分', '40000.52'], ['四萬零五元', '40005.00'], ['四萬圓零5分', '40000.05'], ['一萬圓', '10000.00']])
  test('traditional wan parses only in a complete anchored yuan literal: ' + value, () => exact(value, amount));
for (const value of ['一萬一圓', '兩萬圓', '一億圓', '億四萬圓', '兩四萬圓', '四萬萬圓', '四萬圓5', '四萬圓伍佰分', '四萬圓５角', '四\u200d萬圓', '四萬圓的兩倍', '四萬圓的四萬倍', '四萬圓的億倍', '四萬圓乘以提成比例', '四萬圓至五萬圓', '四萬圓港幣', '約四萬圓', '四萬圓餘', '負四萬圓'])
  test('traditional aliases cannot repair unsupported numerals or erase uncertainty: ' + JSON.stringify(value), () => {
    assert.equal(money(value).amount, null); assert.equal(money(value).rawValue, value);
  });
for (const [expression, value] of [['一萬四萬圓', '四萬圓'], ['億四萬圓', '四萬圓'], ['兩四萬圓', '四萬圓'], ['四萬圓五角', '四萬圓'], ['四萬圓的兩倍', '四萬圓'], ['四萬圓的四萬倍', '四萬圓'], ['四萬圓乘以提成比例', '四萬圓'], ['三萬圓至四萬圓', '四萬圓'], ['四萬圓至五萬圓', '四萬圓'], ['四萬圓港幣', '四萬圓'], ['約四萬圓', '四萬圓'], ['負四萬圓', '四萬圓'], ['4萬元', '4']])
  test('clipped traditional evidence remains unavailable in quote, source and forced history: ' + value + ' <- ' + expression, () => unavailable(expression, value));
test('traditional yuan still supports an explicit existing monthly rate', () => {
  const f = fixture('四萬圓', '四萬圓/月', false, { meaning: 'rate', rateUnit: 'month' });
  assert.equal(normalize({ ...f.candidate, quote: f.source.blocks[0].text }).amount, '40000.00');
  assert.equal(ingest(f).materials[0].candidates[0].amount, '40000.00');
});
