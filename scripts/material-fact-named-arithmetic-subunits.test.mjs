import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const IMPLEMENTATION = fileURLToPath(new URL('../', import.meta.url));
const SOURCE = resolve(process.env.MATERIAL_FACT_TEST_ROOT || IMPLEMENTATION);
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-named-arithmetic-subunits-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(SOURCE, 'lib'), resolve(temporary, 'lib'), { recursive: true });
for (const file of ['material-money-v4.ts', 'material-fact-arithmetic-review.ts'])
  await cp(resolve(IMPLEMENTATION, 'lib', file), resolve(temporary, 'lib', file));
const load = name => import(pathToFileURL(resolve(temporary, 'lib', name)).href);
const { normalizeMoneyValueV4, normalizeCandidateValueV4 } = await load('material-money-v4.ts');
const { hasAttachedMoneyArithmetic } = await load('material-fact-arithmetic-review.ts');
const { reviewCandidateAgainstSource } = await load('material-fact-source-review.ts');
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates } = await load('material-facts-v3.ts');
const AT = '2026-10-18T00:00:00.000Z';

function fixture(expression, value = '四万元', amount = '40000.00', quote = value) {
  const source = { id: 'named-arithmetic-subunits', name: '合成命名算式及角分', sha256: 'b'.repeat(64), analysisRevision: 1, ready: true,
    blocks: [{ id: 'b1', page: 1, text: `😀王甲欠薪为${expression}。`, bbox: null, confidence: null }] };
  const representation = { kind: 'money', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'arrears',
    completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [representation] });
  const stored = ingestCandidates(emptyFactState(1), source, { raw }, 'synthetic', 'audit', AT);
  const candidate = stored.materials[0].candidates[0];
  assert(candidate);
  Object.assign(candidate, { amount, normalization: { rawValue: value, status: 'exact', amount, matchedText: value, span: { start: 0, end: Array.from(value).length }, reason: 'Synthetic historical precision' } });
  return { source, representation, raw, stored, candidate };
}

const namedExpressions = ['四万元乘以出勤系数', '四万元除以折算系数', '四万元×绩效系数', '四万元／出勤比例',
  '四万元工资乘以出勤系数', '四万元基本工资除以计薪天数', '四万元劳动报酬×岗位系数',
  '出勤系数乘以四万元', '绩效系数×四万元', '计薪天数除以四万元',
  '四万元 乘 以 出 勤 系 数', '四万元乘\n以出勤系数', '四万元乘以\n出勤系数',
  '四万元\u200d×\u200d出勤系数', '四万元＊绩效系数', '四万元工资乘以出\n勤系数'];
for (const expression of namedExpressions) test(`an explicit operation with a finite named operand stays unknown: ${JSON.stringify(expression)}`, () => {
  const normalization = normalizeMoneyValueV4(expression);
  assert.equal(normalization.amount, null); assert.equal(normalization.status, 'unsupported'); assert.equal(normalization.rawValue, expression);
  const f = fixture(expression), original = structuredClone(f);
  const normalized = normalizeCandidateValueV4({ ...f.representation, quote: f.source.blocks[0].text });
  assert.equal(normalized.amount, null); assert.equal(normalized.value, '四万元'); assert.equal(normalized.normalization.rawValue, '四万元');
  const reviewed = reviewCandidateAgainstSource(f.candidate, f.source);
  assert.equal(reviewed.amount, null); assert.equal(reviewed.normalization.status, 'unsupported');
  assert.deepEqual(reviewed.representation, f.representation);
  assert.equal(reviewed.start, Array.from('😀王甲欠薪为').length + Array.from(expression.slice(0, expression.indexOf('四万元'))).length);
  assert.deepEqual(f, original);
  const fresh = ingestRuntimeCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'audit', AT);
  assert.equal(fresh.materials[0].raw, f.raw); assert.equal(fresh.materials[0].candidates[0].amount, null);
  assert.equal(fresh.calculation, null); assert.deepEqual(fresh.confirmations, { due: null, paid: null });
});

const decimalSubunits = [
  ['5元五角', '5.50'],
  ['5元5角', '5.50'], ['5元5角2分', '5.52'], ['5元2分', '5.02'], ['5元0角2分', '5.02'],
  ['0元0角0分', '0.00'], ['0元5角2分', '0.52'], ['5元5角0分', '5.50'], ['5元0分', '5.00'],
  ['人民币5元5角2分', '5.52'], ['￥5元5角2分', '5.52'], ['1,234元5角2分', '1234.52'],
  ['5圆5角2分', '5.52'], ['5元5角2分整', '5.52'], ['999999999999元9角9分', '999999999999.99'],
];
for (const [value, amount] of decimalSubunits) test(`complete Arabic yuan/jiao/fen preserves every subunit: ${value}`, () => {
  const normalized = normalizeMoneyValueV4(value);
  assert.equal(normalized.amount, amount); assert.equal(normalized.status, 'exact');
  assert.equal(normalized.matchedText, value); assert.equal(normalized.rawValue, value);
  assert.deepEqual(normalized.span, { start: 0, end: Array.from(value).length });
  const f = fixture(value, value, amount), original = structuredClone(f);
  assert.equal(normalizeCandidateValueV4(f.representation).amount, amount);
  assert.equal(reviewCandidateAgainstSource(f.candidate, f.source).amount, amount);
  const fresh = ingestRuntimeCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'audit', AT);
  assert.equal(fresh.materials[0].raw, f.raw); assert.equal(fresh.materials[0].candidates[0].amount, amount);
  assert.equal(fresh.calculation, null); assert.deepEqual(fresh.confirmations, { due: null, paid: null });
  assert.deepEqual(f, original);
});

for (const expression of ['5元15角', '5元5角12分', '5元5角2分3', '5元5角2分3元', '5元5角2分5分',
  '5元5角2角', '5元整5角', '5元5角零2分', '5.5元5角', '4万元5角', '四元5角',
  '1000000000000元0角0分', '5元5角2分另有300', '5元5角2分２', '5元５角',
  '5元5角2分另有３',
  '5元5角2分的2倍', '5元5角2分×2', '5元5角2分乘以出勤系数']) test(`an invalid, cropped or calculated Arabic subunit token is not a precise result: ${expression}`, () => {
  const normalized = normalizeMoneyValueV4(expression);
  assert.equal(normalized.amount, null); assert.equal(normalized.rawValue, expression);
});

for (const [value, expression] of [['5元', '5元5角2分'], ['5元5角', '5元5角2分'], ['5元5角2分', '5元5角2分3'],
  ['5元5角2分', '5元5角2分的2倍'], ['5元5角2分', '5元5角2分乘以出勤系数']]) test(`cropped value keeps the full adjacent subunit/arithmetic boundary: ${value} <- ${expression}`, () => {
  const f = fixture(expression, value, '5.52', `王甲欠薪为${expression}。`);
  const normalized = normalizeCandidateValueV4(f.representation);
  assert.equal(normalized.amount, null); assert.equal(normalized.value, value);
  assert.equal(normalized.normalization.rawValue, value);
});

for (const [before, after] of [['', '。另一人乘以出勤系数'], ['', '，另一人工资乘以出勤系数'],
  ['', '\n另一人乘以出勤系数'], ['', '工资已付。出勤系数乘以2另计。'], ['', '乘车补贴另计'],
  ['', '加班费另计'], ['', '/月'], ['', '/日'], ['', '/小时'], ['', '/件'],
  ['出勤系数已确认，王甲工资', ''], ['出勤系数乘以2后工资合计', '']]) test(`ordinary prose, another event and genuine rates do not become named arithmetic: ${JSON.stringify([before, after])}`, () => {
  assert.equal(hasAttachedMoneyArithmetic(before, after), false);
});

test('unrelated named coefficients/counts and true rates keep an already stated amount', () => {
  for (const expression of ['四万元，另一人按出勤系数计算', '四万元工资，另有2名工人', '两倍工资合计四万元',
    '出勤系数已确定，王甲欠薪合计四万元']) {
    const f = fixture(expression);
    assert.equal(reviewCandidateAgainstSource(f.candidate, f.source).amount, '40000.00', expression);
  }
  assert.equal(normalizeMoneyValueV4('三人工资共5元5角2分').amount, '5.52');
  for (const [unit, rateUnit] of [['月', 'month'], ['日', 'day'], ['小时', 'hour'], ['件', 'piece']]) {
    const f = fixture(`5元5角2分/${unit}`, '5元5角2分', '5.52');
    Object.assign(f.candidate.representation, { meaning: 'rate', rateUnit });
    assert.equal(reviewCandidateAgainstSource(f.candidate, f.source).amount, '5.52', unit);
  }
});

for (const name of ['出勤系数', '绩效系数', '工资系数', '计发系数', '折算系数', '考核系数', '岗位系数',
  '出勤比例', '支付比例', '计发比例', '折算比例', '出勤天数', '工作天数', '计薪天数', '工作月数', '计薪月数', '人数', '件数']) test(`finite named operand enumeration requires an explicit adjacent operator: ${name}`, () => {
  for (const operator of ['乘以', '除以', '×', '＊', 'x', '÷', '/', '+', '减去']) {
    assert(hasAttachedMoneyArithmetic('', `${operator}${name}`));
    assert(hasAttachedMoneyArithmetic(`${name}${operator}`, ''));
  }
  assert.equal(hasAttachedMoneyArithmetic('', `。${name}乘以2`), false);
  assert.equal(hasAttachedMoneyArithmetic(`${name}已经说明，工资`, ''), false);
});

test('Arabic subunit spans retain supplementary Unicode source coordinates', () => {
  const raw = '😀𠮷工资人民币5元5角2分', normalized = normalizeMoneyValueV4(raw);
  assert.equal(normalized.rawValue, raw); assert.equal(normalized.matchedText, '人民币5元5角2分');
  assert.equal(normalized.amount, '5.52'); assert.deepEqual(normalized.span, { start: 4, end: 13 });
});

for (const [raw, amount] of [['３人工资共四万元', '40000.00'], ['３人工资共5元5角2分', '5.52'],
  ['２０２６年２月３人工资5元5角2分', '5.52'], ['5元5角2分已工作２个月', '5.52']]) test(`fullwidth dates/counts remain unrelated to the anchored amount: ${raw}`, () => {
  assert.equal(normalizeMoneyValueV4(raw).amount, amount);
});
