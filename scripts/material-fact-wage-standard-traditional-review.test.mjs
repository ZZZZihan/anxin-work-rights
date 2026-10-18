import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Synthetic parsing/runtime/read-time checks. Only the owned parser is copied
// over configurable baseline dependencies; no source/range worktree is imported.
const OWN = fileURLToPath(new URL('../', import.meta.url));
const SOURCE = resolve(process.env.MATERIAL_FACT_TEST_ROOT || OWN);
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-standard-traditional-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(SOURCE, 'lib'), resolve(temporary, 'lib'), { recursive: true });
await cp(resolve(OWN, 'lib/material-money-v4.ts'), resolve(temporary, 'lib/material-money-v4.ts'));
const load = name => import(pathToFileURL(resolve(temporary, 'lib', name)).href);
const { classifyMonetaryExpression, normalizeMoneyValueV4, normalizeCandidateValueV4 } = await load('material-money-v4.ts');
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest.ts');
const { reviewCandidateAgainstSource } = await load('material-fact-source-review.ts');
const { emptyFactState, ingestCandidates } = await load('material-facts-v3.ts');
const AT = '2026-10-18T00:00:00.000Z';

function fixture(value, text = `😀王甲的工资为${value}。`, quote = value) {
  const source = { id: 'standard-traditional-synthetic', name: '合成工资标准及传统金额单位', sha256: 'a'.repeat(64), analysisRevision: 1, ready: true,
    blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
  const representation = { kind: 'money', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'arrears',
    completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [representation] }), before = structuredClone(source);
  const state = ingestRuntimeCandidates(emptyFactState(1), source, { raw }, 'synthetic', 'audit', AT);
  assert.deepEqual(source, before);
  assert.equal(state.materials[0].raw, raw);
  assert.deepEqual(state.confirmations, emptyFactState(1).confirmations);
  return { source, state, material: state.materials[0], raw, representation };
}

const labels = ['工资标准', '每月工资标准', '基本工资标准', '今日工资标准', '月工资标准', '本月工资标准', '昨日基本工资标准', '每天工资标准',
  '每月基本工资标准', '2026年10月工资标准', '2026年10月18日工资标准', '试用期工资标准', '税前工资标准', '岗位工资标准', '薪资标准', '薪酬标准', '劳动报酬标准'];
for (const value of labels) {
  test(`a complete wage-standard label contains no amount: ${value}`, () => {
    const classification = classifyMonetaryExpression(value), { material, raw } = fixture(value);
    assert.equal(classification.kind, 'not_monetary');
    assert.equal(classification.normalization.status, 'not_money');
    assert.equal(classification.normalization.rawValue, value);
    assert.equal(classification.normalization.amount, null);
    assert.equal(classification.normalization.span, null);
    assert.equal(material.candidates.length, 0);
    assert.equal(material.rejected.length, 1);
    assert.match(material.rejected[0].reason, /没有金额表达/u);
    assert.equal(material.raw, raw);
  });
}
for (const value of ['工资标准未知', '每月工资标准不详', '基本工资标准未明确', '今日工资标准待定', '工资标准xxx', '工资标准？', '工资标准＿', '工资标准……'])
  test(`unknown or masked wage-standard amounts remain reviewable: ${value}`, () => {
    const classification = classifyMonetaryExpression(value), { material, representation } = fixture(value);
    assert.equal(classification.kind, 'monetary');
    assert.equal(classification.normalization.status, 'masked');
    assert.equal(material.candidates.length, 1);
    assert.equal(material.rejected.length, 0);
    assert.deepEqual(material.candidates[0].representation, representation);
    assert.equal(material.candidates[0].amount, null);
  });
for (const value of ['工资标准另议', '工资标准若干', '工资标准待核', '工资标准4000', '基本工资标准四千', '今日工资标准未核算'])
  test(`unrecognized or incomplete amount text is not rejected as a definite empty label: ${value}`, () => {
    assert.equal(classifyMonetaryExpression(value).kind, 'undetermined');
    const { material } = fixture(value);
    assert.equal(material.candidates.length, 1);
    assert.equal(material.rejected.length, 0);
    assert.equal(material.candidates[0].amount, null);
  });

const amounts = [['4000圓', '4000.00'], ['四千圓', '4000.00'], ['人民幣四千圓', '4000.00'], ['人民币四千圓', '4000.00'],
  ['人民幣4000圓', '4000.00'], ['人民幣4000元', '4000.00'], ['人民幣四千圆', '4000.00'], ['￥4000圓', '4000.00'],
  ['4,000圓', '4000.00'], ['4萬圓', null], ['4万圓', '40000.00'], ['四千圓整', '4000.00'], ['四千圓正', '4000.00'],
  ['壹仟圓整', '1000.00'], ['人民幣壹仟圓整', '1000.00'], ['四千圓五角六分', '4000.56'], ['人民幣四千圓零六分', '4000.06'],
  ['4000圓5角6分', '4000.56'], ['人民幣4000圓6分', '4000.06'], ['0圓', '0.00'], ['零圓', '0.00'], ['0圓0角6分', '0.06'], ['4000.56圓', '4000.56']];
for (const [value, amount] of amounts) {
  test(`traditional RMB spelling preserves original normalization evidence: ${value}`, () => {
    const normalization = normalizeMoneyValueV4(value);
    assert.equal(normalization.rawValue, value);
    assert.equal(classifyMonetaryExpression(value).kind, 'monetary');
    assert.equal(normalization.amount, amount);
    if (amount !== null) {
      assert.equal(normalization.status, 'exact');
      assert.equal(normalization.matchedText, value);
      assert.deepEqual(normalization.span, { start: 0, end: Array.from(value).length });
    } else assert.notEqual(normalization.status, 'exact', 'traditional digit units beyond this alias remain unsupported');
  });
  if (amount !== null) for (const style of ['cropped', 'full']) test(`fresh runtime supports ${value}, ${style} quote, without editing raw or CP`, () => {
    const text = `😀王甲工资为${value}。`, { material, source, representation, raw } = fixture(value, text, style === 'full' ? text : value);
    assert.equal(material.candidates.length, 1);
    assert.equal(material.rejected.length, 0);
    const candidate = material.candidates[0];
    assert.equal(candidate.amount, amount);
    assert.equal(candidate.normalization.status, 'exact');
    assert.equal(candidate.normalization.rawValue, value);
    assert.equal(candidate.normalization.matchedText, value);
    assert.deepEqual(candidate.normalization.span, { start: 0, end: Array.from(value).length });
    assert.deepEqual(candidate.representation, representation);
    assert.equal(candidate.value, value);
    assert.equal(candidate.quote, representation.quote);
    const start = Array.from(text.slice(0, text.indexOf(representation.quote))).length;
    assert.equal(candidate.start, start);
    assert.equal(candidate.end, start + Array.from(representation.quote).length);
    assert.equal(material.raw, raw);
    assert.equal(reviewCandidateAgainstSource(candidate, source).amount, amount);
  });
}
for (const value of ['4000圓', '四千圓', '人民幣四千圓', '人民幣四千圓五角六分']) test(`historically unavailable ${value} never auto-upgrades during read review`, () => {
  const f = fixture(value), stored = ingestCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'audit', AT);
  const candidate = stored.materials[0].candidates[0];
  assert.equal(candidate.amount, null);
  const before = structuredClone(stored);
  assert.equal(reviewCandidateAgainstSource(candidate, f.source).amount, null);
  assert.deepEqual(stored, before);
});
for (const [value, expected] of [['港幣四千圓', 'unsupported'], ['四千圓美元', 'unsupported'], ['HKD4000圓', 'unsupported'],
  ['4000圓至5000圓', 'range'], ['四千圓至五千圓', 'range'], ['人民幣四千圓或五千圓', null],
  ['四千圓左右', 'approximate'], ['约四千圓', 'approximate'], ['四千圓的2倍', 'unsupported'], ['4000圓5角6分7分', 'unsupported'],
  ['4000圓圓', 'unsupported'], ['四千圓形', 'unsupported'], ['四千圓滿', 'unsupported']])
  test(`traditional spelling cannot bypass an unsafe monetary qualifier: ${value}`, () => {
    const normalization = normalizeMoneyValueV4(value);
    assert.equal(normalization.rawValue, value);
    assert.equal(normalization.amount, null);
    if (expected) assert.equal(normalization.status, expected);
  });
for (const value of ['4000圓', '四千圓']) test(`cropping traditional subunits still withholds the base amount: ${value}`, () => {
  const text = `😀王甲工资为${value}5角。`, { material, representation } = fixture(value, text);
  assert.equal(material.candidates.length, 1);
  assert.equal(material.candidates[0].amount, null);
  assert.deepEqual(material.candidates[0].representation, representation);
});
for (const value of ['工资标准4000元', '每月工资标准4000元', '今日工资标准四千元', '工资标准4000元/月'])
  test(`a standard that actually states an amount stays monetary: ${value}`, () => {
    const classification = classifyMonetaryExpression(value), { material } = fixture(value);
    assert.equal(classification.kind, 'monetary');
    assert.equal(material.candidates.length, 1);
    assert.equal(material.rejected.length, 0);
  });
test('a correctly declared monthly rate remains exact with the traditional unit', () => {
  const representation = { kind: 'money', value: '四千圓', quote: '月工资标准四千圓', blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'rate',
    completeness: 'not_applicable', period: null, rateUnit: 'month', assertion: 'narrated' };
  const normalized = normalizeCandidateValueV4(representation);
  assert.equal(normalized.amount, '4000.00');
  assert.equal(normalized.normalization.rawValue, '四千圓');
});
