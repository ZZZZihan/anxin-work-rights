// Synthetic finite-classifier/RMB parsing and source-read fixtures; no model/data archive.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OWN = fileURLToPath(new URL('../', import.meta.url));
const BASE = resolve(process.env.MATERIAL_FACT_TEST_ROOT || OWN);
const MONEY = resolve(process.env.MATERIAL_FACT_MONEY_ROOT || OWN, 'lib/material-money-v4.ts');
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-explicit-rmb-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(BASE, 'lib'), resolve(temporary, 'lib'), { recursive: true });
await cp(MONEY, resolve(temporary, 'lib/material-money-v4.ts'));
console.log(JSON.stringify({ money_sha256: createHash('sha256').update(await readFile(MONEY)).digest('hex') }));
const load = file => import(pathToFileURL(resolve(temporary, 'lib', file)).href);
const { normalizeMoneyValueV4: money, normalizeCandidateValueV4: normalize, classifyMonetaryExpression: classify,
  canonicalMonetaryExpression: canonical } = await load('material-money-v4.ts');
const { ingestRuntimeCandidates: ingest } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy } = await load('material-facts-v3.ts');
const { reviewFactsAgainstSources: review } = await load('material-fact-source-review.ts');
const length = value => Array.from(value).length;
const AT = '2026-10-18T00:00:00Z';
function fixture(value, expression = value, style = 'crop') {
  const text = `😀𠮷。王甲收到工资${expression}。`;
  const source = { id: 'synthetic-explicit-rmb', name: '合成有限人民币与无金额描述', sha256: 'a'.repeat(64),
    analysisRevision: 1, ready: true, blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
  const representation = { kind: 'money', value, quote: style === 'full' ? text : value, blockId: 'b1', subject: '王甲',
    scope: 'individual', meaning: 'arrears', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [representation] });
  const state = ingest(emptyFactState(1), source, { raw }, 'synthetic', 'author', AT);
  assert.equal(state.materials[0].raw, raw); assert.equal(state.calculation, null);
  assert.deepEqual(state.confirmations, { due: null, paid: null });
  return { source, representation, raw, state, material: state.materials[0] };
}
function preserved(value, expression, style, expected) {
  const f = fixture(value, expression, style), candidate = f.material.candidates[0];
  assert.equal(f.material.candidates.length, 1); assert.equal(f.material.rejected.length, 0);
  assert.equal(candidate.amount, expected); assert.equal(candidate.normalization.rawValue, value);
  assert.deepEqual(candidate.representation, f.representation); assert.equal(candidate.value, value);
  assert.equal(candidate.quote, f.representation.quote);
  const start = length(f.source.blocks[0].text.slice(0, f.source.blocks[0].text.indexOf(candidate.quote)));
  assert.equal(candidate.start, start); assert.equal(candidate.end, start + length(candidate.quote));
  const original = structuredClone(f.state), view = review(f.state, [f.source]);
  assert.equal(view.materials[0].candidates[0].amount, expected);
  assert.deepEqual(f.state, original); assert.equal(view.materials[0].raw, f.raw);
  assert.deepEqual(view.history, f.state.history);
  if (expected === null) {
    const stored = legacy(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'author', AT);
    const old = stored.materials[0].candidates[0]; assert(old);
    old.amount = '40000.00'; old.normalization = { rawValue: value, status: 'exact', amount: '40000.00',
      matchedText: value, span: { start: 0, end: length(value) }, reason: 'synthetic obsolete exact' };
    const before = structuredClone(stored);
    assert.equal(review(stored, [f.source]).materials[0].candidates[0].amount, null);
    assert.deepEqual(stored, before);
  }
}

const empty = ['八成', '八折', '打八折', '对折', '對折', '8.5成', '八成五', '五成半', '八五折',
  '拖欠工資', '未付工資', '本期應付工資', '勞動報酬', '每月工資標準', '今日基本工資', '本期應付勞動報酬'];
for (const value of empty) test(`complete non-money descriptions reject while retaining raw: ${value}`, () => {
  assert.equal(classify(value).kind, 'not_monetary');
  const f = fixture(value); assert.equal(f.material.candidates.length, 0); assert.equal(f.material.rejected.length, 1);
  assert.equal(f.material.raw, f.raw); assert.equal(classify(value).normalization.rawValue, value);
});
for (const value of ['八成未知', '打八折待定', '拖欠工資未知', '未付工資不詳', '本期應付工資？', '勞動報酬xxx',
  '本期應付工資若干', '工資另議']) test(`unknown/masked prose is retained for review: ${value}`, () => {
  assert.notEqual(classify(value).kind, 'not_monetary');
  const f = fixture(value); assert.equal(f.material.candidates.length, 1); assert.equal(f.material.candidates[0].amount, null);
});
const suffix = [['40000人民币', '40000.00'], ['40000人民幣', '40000.00'], ['40000RMB', '40000.00'], ['40000CNY', '40000.00'],
  ['40,000 RMB', '40000.00'], ['四万元人民币', '40000.00'], ['四萬CNY', '40000.00'], ['0.02人民币', '0.02']];
const subunits = [['人民币5角', '0.50'], ['人民币2分', '0.02'], ['人民币5角2分', '0.52'], ['人民幣五角二分', '0.52'],
  ['RMB5角2分', '0.52'], ['CNY2分', '0.02'], ['人民币伍角贰分', '0.52'], ['人民币零分', '0.00'], ['人民币0角2分', '0.02']];
for (const [value, expected] of [...suffix, ...subunits]) test(`explicit RMB literal is exact integer cents with unchanged span: ${value}`, () => {
  const n = money(value); assert.equal(n.amount, expected); assert.equal(n.status, 'exact'); assert.equal(n.rawValue, value);
  assert.equal(n.matchedText, value); assert.deepEqual(n.span, { start: 0, end: length(value) });
  assert.equal(classify(value).kind, 'monetary');
});
for (const [value, expected] of [suffix[0], suffix[2], suffix[3], subunits[0], subunits[1], subunits[2]])
  for (const style of ['full', 'crop']) test(`fresh/read source raw and CP remain unchanged: ${value}, ${style}`, () => preserved(value, value, style, expected));
for (const value of ['40000RMB', '人民币5角2分']) test(`new parser never upgrades historically unsupported records on read: ${value}`, () => {
  const f = fixture(value), stored = legacy(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'author', AT);
  assert.equal(stored.materials[0].candidates[0].amount, null);
  const before = structuredClone(stored); assert.equal(review(stored, [f.source]).materials[0].candidates[0].amount, null);
  assert.deepEqual(stored, before);
});

const unsafe = ['5角', '2分', '5角2分', '人民币25角', '人民币2.5角', '人民币5角22分', '人民币5角零2分',
  '人民币5角度', '人民币2分米', '人民币5分鐘', '40000RMB美元', 'USD40000RMB', '人民币5角港币',
  '40000人民币至50000人民币', '40000RMB至50000CNY', '人民币5角至人民币8角', '人民币5角2分至人民币8角',
  '40000RMB的2倍', '人民币5角的2倍', '人民币5角2分+人民币2分', '不满40000RMB', '最多40000RMB',
  '人民币5角2分之内', '人民币5角2分左右', '人民币5角2分或人民币8角', '40000RMB2分', '40000RMB万元',
  '1.001人民币', '-40000RMB', '人民币-5角', '40000RMBA', '人民币5角2分3分'];
for (const value of unsafe) test(`new literals do not bypass non-exact/ordinary boundaries: ${value}`, () => {
  assert.equal(money(value).amount, null); assert.equal(money(value).rawValue, value);
});
for (const [value, expected] of [['40000rmb', '40000.00'], ['CNY五角二分', '0.52'], ['人民幣兩分', '0.02'],
  ['人民币五角二分', '0.52'], ['四萬元人民幣', '40000.00']])
  test(`finite supported currency/digit spelling stays exact: ${value}`, () => assert.equal(money(value).amount, expected));
const cropped = [['40000RMB', '40000RMB至50000CNY'], ['50000CNY', '40000RMB至50000CNY'],
  ['人民币5角', '人民币5角至人民币8角'], ['人民币8角', '人民币5角至人民币8角'],
  ['人民币5角', '人民币5角2分'], ['人民币5角', '人民币5角度'], ['人民币2分', '人民币2分米'],
  ['人民币5角2分', '人民币5角2分之内'], ['人民币5角', '人民币5角的2倍'],
  ['人民币5角', '人民币5角/月'], ['人民币5角', '人民币5角/周'], ['40000RMB', '最多40000RMB'],
  ['人民币5角', '人民币5角港币'], ['人民币5角', '人民币5角或人民币8角']];
for (const [value, expression] of cropped) for (const style of ['full', 'crop'])
  test(`crop and forced historical exact stay unavailable: ${expression}, ${value}, ${style}`, () => preserved(value, expression, style, null));
for (const [value, expression] of [['人民币5角', '人民币5角至8角'], ['人民币5角2分', '人民币5角2分至8角'],
  ['人民币5角', '人民币5角至8分'], ['40000RMB', '40000RMB的八折'], ['40000RMB', '40000RMB+2000元'],
  ['人民币5角', '人民币5角的50%'], ['人民币5角', '人民币5角+2分'], ['40000RMB', '40000RMB2分'],
  ['人民币5角', '人民币5角至约8角']])
  test(`explicit RMB capability keeps its attached boundaries: ${expression}`, () => preserved(value, expression, 'crop', null));
for (const [blocks, value, blockId, expected] of [
  [['😀王甲收到人民币5角至', '人民币8角'], '人民币8角', 'b2', null],
  [['😀王甲收到人民币5角', '至人民币8角'], '人民币5角', 'b1', null],
  [['😀王甲收到人民币5角至', '8角'], '人民币5角', 'b1', null],
  [['😀王甲收到人民币5角至', '约8角'], '人民币5角', 'b1', null],
  [['😀王甲收到人民币5角', '2分'], '人民币5角', 'b1', null],
  [['😀王甲收到人民币5角。', '王乙等候8分钟。'], '人民币5角', 'b1', '0.50'],
  [['😀王甲收到40000RMB至', '50000CNY'], '50000CNY', 'b2', null],
]) test(`source layout cannot detach a new currency token: ${JSON.stringify(blocks)}`, () => {
  const f = fixture(value), source = { ...f.source, blocks: blocks.map((text, i) => ({ ...f.source.blocks[0], id: `b${i + 1}`, text })) };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [{ ...f.representation, blockId }] });
  const state = ingest(emptyFactState(1), source, { raw }, 'synthetic', 'author', AT), candidate = state.materials[0].candidates[0];
  assert(candidate); assert.equal(candidate.amount, expected); assert.equal(state.materials[0].raw, raw);
  const before = structuredClone(state); assert.equal(review(state, [source]).materials[0].candidates[0].amount, expected);
  assert.deepEqual(state, before); assert.equal(state.calculation, null);
  const block = source.blocks.find(item => item.id === blockId), start = length(block.text.slice(0, block.text.indexOf(value)));
  assert.equal(candidate.start, start); assert.equal(candidate.end, start + length(value));
});
test('proper supported rate keeps its amount while a total cannot borrow the denominator', () => {
  const f = fixture('人民币5角', '人民币5角/月', 'full');
  assert.equal(normalize({ ...f.representation, meaning: 'rate', rateUnit: 'month' }).amount, '0.50');
  assert.equal(normalize(f.representation).amount, null);
});
test('new literals keep the original astral code-point match location inside a narrative value', () => {
  const value = '😀𠮷。王甲收到人民币5角2分。', n = money(value), token = '人民币5角2分';
  assert.equal(n.amount, '0.52'); assert.equal(n.rawValue, value); assert.equal(n.matchedText, token);
  const start = length(value.slice(0, value.indexOf(token))); assert.deepEqual(n.span, { start, end: start + length(token) });
});
for (const suffix of ['内', '之内']) test(`comparison retains the explicit RMB needed by subunits: ${suffix}`, () => {
  const value = `人民币2分${suffix}`;
  assert.equal(money(value).amount, null); assert.equal(canonical(value), `approximate::0.02:${suffix}`);
  assert.equal(canonical(value), canonical(`人民币零元二分${suffix}`));
  assert.equal(canonical(value), canonical(`CNY2分${suffix}`));
  assert.notEqual(canonical(value), canonical('人民币2分'));
});
test('an outer RMB prefix still permits the established finite bound comparison', () => {
  assert.equal(canonical('人民币不满四万元'), canonical('不满40000元'));
  assert.equal(canonical('人民币低于40000元'), canonical('低于四万元'));
  assert.equal(canonical('2分内'), null, 'a comparison key cannot invent RMB for a bare subunit');
});
