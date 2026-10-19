import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const IMPLEMENTATION = fileURLToPath(new URL('../', import.meta.url));
const BASE = resolve(process.env.V7_BASELINE_ROOT || IMPLEMENTATION);
const MONEY = resolve(process.env.V7_MONEY_TEST_FILE || resolve(IMPLEMENTATION, 'lib/material-money-v4.ts'));
const temp = await mkdtemp(resolve(tmpdir(), 'anxin-mixed-subunit-contract-'));
after(() => rm(temp, { recursive: true, force: true }));
await cp(resolve(BASE, 'lib'), resolve(temp, 'lib'), { recursive: true });
await cp(MONEY, resolve(temp, 'lib/material-money-v4.ts'));
const load = file => import(pathToFileURL(resolve(temp, 'lib', file)).href);
const { normalizeMoneyValueV4: money, normalizeCandidateValueV4: normalize } = await load('material-money-v4.ts');
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest.ts');
const { reviewFactsAgainstSources } = await load('material-fact-source-review.ts');
const { emptyFactState, ingestCandidates } = await load('material-facts-v3.ts');
console.log(JSON.stringify({ money_file: MONEY, sha256: createHash('sha256').update(await readFile(MONEY)).digest('hex') }));
const cpLength = value => Array.from(value).length;
function fixture(value, expression = value, changes = {}) {
  const prefix = '😀𠮷王甲工资为';
  const source = { id: 'round13-mixed-subunits', name: '合成混合元角分', sha256: 'd'.repeat(64), analysisRevision: 13, ready: true,
    blocks: [{ id: 'b1', page: 1, text: prefix + expression + '。', bbox: null, confidence: null }] };
  const candidate = { kind: 'money', value, quote: value, blockId: 'b1', subject: '王甲', scope: 'individual',
    meaning: 'arrears', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated', ...changes };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [candidate] });
  return { source, candidate, raw, prefix };
}
function ingest(f, old = false) {
  const state = (old ? ingestCandidates : ingestRuntimeCandidates)(emptyFactState(13), f.source, { raw: f.raw }, 'author-round13', 'synthetic', '2026-10-18T00:00:00Z');
  assert.equal(state.materials[0].raw, f.raw);
  assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
  assert.equal(state.materials[0].candidates.length, 1);
  assert.deepEqual(state.materials[0].candidates[0].representation, f.candidate);
  assert.equal(state.materials[0].candidates[0].start, cpLength(f.prefix));
  assert.equal(state.materials[0].candidates[0].end, cpLength(f.prefix + f.candidate.quote));
  return state;
}
function exact(value, expected) {
  const normalization = money(value);
  assert.equal(normalization.status, 'exact'); assert.equal(normalization.amount, expected);
  assert.equal(normalization.rawValue, value); assert.equal(normalization.matchedText, value);
  assert.deepEqual(normalization.span, { start: 0, end: cpLength(value) });
  const full = '😀𠮷工资' + value, embedded = money(full);
  assert.equal(embedded.rawValue, full); assert.equal(embedded.amount, expected);
  assert.equal(embedded.span.start, 4); assert.equal(embedded.span.end, cpLength(full));
  const f = fixture(value);
  assert.equal(normalize({ ...f.candidate, quote: f.source.blocks[0].text }).amount, expected);
  assert.equal(ingest(f).materials[0].candidates[0].amount, expected);
  // An old unavailable value stays unavailable; new extraction supports it.
  const old = ingest(f, true), stored = old.materials[0].candidates[0];
  Object.assign(stored, { amount: null, normalization: { rawValue: value, status: 'unsupported', amount: null, matchedText: null, span: null, reason: 'Synthetic pre-fix unsupported history.' } });
  const before = structuredClone(old), reviewed = reviewFactsAgainstSources(old, [f.source]);
  assert.equal(reviewed.materials[0].candidates[0].amount, null);
  assert.deepEqual(old, before); assert.equal(reviewed.materials[0].raw, f.raw);
}

const digits = [
  ...Array.from('0123456789', (glyph, n) => [glyph, n]),
  ...Array.from('零一二三四五六七八九', (glyph, n) => [glyph, n]),
  ...Array.from('零壹贰叁肆伍陆柒捌玖', (glyph, n) => [glyph, n]), ['〇', 0], ['两', 2],
];
const uniqueDigits = [...new Map(digits.map(row => [row[0], row])).values()];
for (const [glyph, n] of uniqueDigits) {
  test(`one supported digit after integer yuan gives exact jiao: ${glyph}`, () => exact(`5元${glyph}角`, `5.${n}0`));
  test(`one supported digit after integer yuan gives exact fen: ${glyph}`, () => exact(`5元${glyph}分`, `5.0${n}`));
  test(`one supported jiao digit precedes an Arabic fen digit: ${glyph}`, () => exact(`5元${glyph}角2分`, `5.${n}2`));
  if (n !== 0) test(`omitted jiao permits one zero before a nonzero fen digit: ${glyph}`, () => exact(`5元零${glyph}分`, `5.0${n}`));
}
for (const [value, expected] of [['5元五角伍分', '5.55'], ['5元5角伍分', '5.55'], ['5元伍角五分', '5.55'],
  ['40000元五角', '40000.50'], ['0元零伍分', '0.05'], ['5元零角伍分', '5.05'], ['5元伍角零分', '5.50'],
  ['5元五角整', '5.50'], ['5元零伍分正', '5.05'], ['人民币5元伍角贰分', '5.52'],
  ['￥5元伍角贰分', '5.52'], ['人民幣5圓五角贰分', '5.52'], ['5圆五角贰分', '5.52'],
  ['1,234元伍角〇分', '1234.50'], ['1，234元零伍分', '1234.05'], ['999999999999元玖角玖分', '999999999999.99']])
  test(`mixed single-digit spelling keeps its whole token and exact cents: ${value}`, () => exact(value, expected));

for (const value of ['5元十五角', '5元五角十二分', '5元55角', '5元五五角', '5元五角22分', '5元五角贰贰分',
  '5元五分伍角', '5元五角贰角', '5元五分贰分', '5元整五角', '5元五角零2分', '5元五角零贰分',
  '5元零零分', '5元零〇分', '5元零0分', '5元〇五分', '5元零零五分', '5元五角贰分3', '5元五角贰分３',
  '5元五角贰分另有300', '5元五角贰分另有３', '5.5元五角', '5.0元五角', '4万元五角', '4亿元五角',
  '5元五角贰分3元', '12,34元五角',
  '1000000000000元壹角', '5元五角的两倍', '5元五角乘以K', '5元五分之K', '5元伍分之一',
  '5元五分钟后离开', '5元伍分鐘后离开', '5元五分\u200d钟后离开', '5元五分\n钟后离开', '5元伍角度示意图'])
  test(`invalid order, precision, scale, unit word or formula stays unavailable: ${JSON.stringify(value)}`, () => {
    const normalized = money(value); assert.equal(normalized.amount, null); assert.equal(normalized.rawValue, value);
    const f = fixture(value); assert.equal(ingest(f).materials[0].candidates[0].amount, null);
  });
for (const [value, expression] of [['5元', '5元五角'], ['5元五角', '5元五角贰分'], ['5元五角', '5元五角零贰分'],
  ['5元五角', '5元五角的两倍'], ['5元五角', '5元五角乘以K'], ['5元五分', '5元五分钟后离开'],
  ['5元五分', '5元五分之K'], ['5元伍分', '5元伍分之一']]) test(`cropped subunit operand cannot become precise: ${value} <- ${expression}`, () => {
    const f = fixture(value, expression);
    assert.equal(normalize({ ...f.candidate, quote: f.source.blocks[0].text }).amount, null);
    assert.equal(ingest(f).materials[0].candidates[0].amount, null);
    const old = ingest(f, true); Object.assign(old.materials[0].candidates[0], { amount: money(value).amount ?? '5.00', normalization: money(value) });
    const before = structuredClone(old), reviewed = reviewFactsAgainstSources(old, [f.source]);
    assert.equal(reviewed.materials[0].candidates[0].amount, null); assert.deepEqual(old, before);
  });
test('new mixed parsing cannot silently repair a wrong persisted derived amount', () => {
  const f = fixture('5元五角'), old = ingest(f, true);
  Object.assign(old.materials[0].candidates[0], { amount: '5.00', normalization: { ...money('5元'), rawValue: '5元五角' } });
  const before = structuredClone(old), reviewed = reviewFactsAgainstSources(old, [f.source]);
  assert.equal(reviewed.materials[0].candidates[0].amount, null); assert.deepEqual(old, before);
});
for (const [unit, rateUnit] of [['月', 'month'], ['日', 'day'], ['小时', 'hour'], ['件', 'piece']]) test(`real mixed-subunit rate keeps its declared unit: ${unit}`, () => {
  const f = fixture('5元五角贰分', `5元五角贰分/${unit}`, { meaning: 'rate', rateUnit });
  assert.equal(ingest(f).materials[0].candidates[0].amount, '5.52');
  assert.equal(ingest({ ...f, candidate: { ...f.candidate, meaning: 'arrears', rateUnit: null }, raw: JSON.stringify({ schemaVersion: 3, candidates: [{ ...f.candidate, meaning: 'arrears', rateUnit: null }] }) }).materials[0].candidates[0].amount, null);
});

// ROUND30 adds complete fullwidth numerals; the former unsupported cases now
// require exact cents, raw evidence and source handling. Cropped cases stay rejected.
for (const [value, amount] of [["５元五角", "5.50"], ["5元５角", "5.50"], ["5元伍角２分", "5.52"], ["5元5角２分", "5.52"]])
  test("complete fullwidth numeral contract: " + value, () => exact(value, amount));
