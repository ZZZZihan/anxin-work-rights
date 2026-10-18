// ROUND38 finite bound and numeric lexical multiplier regressions.
// Synthetic module/runtime/read-time review only: no experiment/scorer CLI.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OWN = fileURLToPath(new URL('../', import.meta.url));
const BASE = resolve(process.env.MATERIAL_FACT_TEST_ROOT || OWN);
const PATCH = resolve(process.env.MATERIAL_FACT_PATCH_ROOT || OWN);
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-round38-bounds-multiplier-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(BASE, 'lib'), resolve(temporary, 'lib'), { recursive: true });
for (const name of ['material-fact-range-review', 'material-fact-arithmetic-review'])
  await cp(resolve(PATCH, 'lib', name + '.ts'), resolve(temporary, 'lib', name + '.ts'));
const load = name => import(pathToFileURL(resolve(temporary, 'lib', name + '.ts')).href);
const { normalizeMoneyValueV4: money, normalizeCandidateValueV4: candidateValue, canonicalMonetaryExpression: canonical } = await load('material-money-v4');
const { attachedMoneyQualifierStatus: qualifier, isMoneyRangeEndpoint } = await load('material-fact-range-review');
const { hasAttachedMoneyArithmetic: arithmetic } = await load('material-fact-arithmetic-review');
const { emptyFactState, ingestCandidates, validateCandidateOutput, buildFactView } = await load('material-facts-v3');
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest');
const { reviewFactsAgainstSources } = await load('material-fact-source-review');
const cpLength = text => Array.from(text).length;
const minimal = process.env.MATERIAL_FACT_ROUND38_MINIMAL === '1';
const AT = '2026-10-19T03:00:00.000Z';

function fixture(expression, { value = '4000元', fullQuote = false, before = null, next = null, otherPage = false,
  meaning = 'other_money', rateUnit = null } = {}) {
  const source = { id: 'round38-bounds-multiplier', name: '合成界限与翻倍表达', sha256: '8'.repeat(64), analysisRevision: 38, ready: true, blocks: [] };
  if (before !== null) source.blocks.push({ id: 'before', page: 1, text: '😀王甲工资' + before, bbox: null, confidence: null });
  const block = { id: 'amount', page: otherPage && before !== null ? 2 : 1,
    text: (before === null ? '😀王甲工资' : '') + expression + (next === null ? '。' : ''), bbox: null, confidence: null };
  source.blocks.push(block);
  if (next !== null) source.blocks.push({ id: 'after', page: otherPage ? 2 : 1, text: next, bbox: null, confidence: null });
  const candidate = { kind: 'money', value, quote: fullQuote ? block.text : value, blockId: block.id, subject: '王甲', scope: 'individual',
    meaning, completeness: meaning === 'rate' || meaning === 'other_money' ? 'not_applicable' : 'complete',
    period: null, rateUnit, assertion: 'narrated' };
  return { source, candidate, raw: JSON.stringify({ schemaVersion: 3, candidates: [candidate] }) };
}

function check(f, amount) {
  const original = structuredClone(f);
  assert.equal(validateCandidateOutput(f.raw, f.source).rejected.length, 0, 'The candidate must pass the real input schema.');
  function inspect(state, expected, label) {
    const material = state.materials[0], fact = material.candidates[0];
    assert.equal(material.raw, f.raw); assert.equal(material.rejected.length, 0); assert.equal(material.candidates.length, 1);
    assert.equal(fact.amount, expected, label + ': amount');
    assert.equal(fact.value, f.candidate.value); assert.equal(fact.quote, f.candidate.quote);
    assert.deepEqual(fact.representation, f.candidate);
    const text = f.source.blocks.find(block => block.id === f.candidate.blockId).text;
    const start = cpLength(text.slice(0, text.indexOf(f.candidate.quote)));
    assert.deepEqual([fact.start, fact.end], [start, start + cpLength(f.candidate.quote)]);
    assert.equal(Array.from(text).slice(fact.start, fact.end).join(''), f.candidate.quote);
    assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
    assert.equal(buildFactView(state, [f.source]).canCalculate, false);
  }
  inspect(ingestRuntimeCandidates(emptyFactState(38), f.source, { raw: f.raw }, 'synthetic', 'round38-author', AT), amount, 'fresh');
  for (const oldAmount of ['4000.00', null]) {
    const stored = ingestCandidates(emptyFactState(38), f.source, { raw: f.raw }, 'synthetic', 'round38-author', AT);
    const fact = stored.materials[0].candidates[0];
    fact.amount = oldAmount;
    fact.normalization = { rawValue: f.candidate.value, status: oldAmount === null ? 'unsupported' : 'exact', amount: oldAmount,
      matchedText: f.candidate.value, span: { start: 0, end: cpLength(f.candidate.value) }, reason: 'Unconfirmed synthetic stored observation.' };
    const before = structuredClone(stored), reviewed = reviewFactsAgainstSources(stored, [f.source]);
    assert.deepEqual(stored, before, 'Read-time review cannot rewrite storage or original raw.');
    assert.deepEqual(reviewed.history, before.history);
    inspect(reviewed, oldAmount === null ? null : amount, oldAmount === null ? 'stored-null' : 'stored-exact');
  }
  assert.deepEqual(f, original);
}

const bounds = minimal ? ['高达4000元', '高達4000元', '低至4000元'] : [
  '高达4000元', '高達4000元', '低至4000元', '高\u200d达4000元', '高 达4000元', '低\n至4000元',
  '高达人民币4000元', '人民幣高達4000元', '低至人民币4000元', '高达4000元工资',
];
const operations = minimal ? ['4000元翻一倍'] : [
  '4000元翻一倍', '4000元翻两倍', '4000元翻2倍', '4000元翻２．５倍', '4000元加一倍', '4000元加两倍',
  '4000元翻\n一\n倍', '4000元翻\u200d1倍', '4000元 翻 一 倍', '人民币4000元正翻一倍',
  '4000元人民币翻一倍', '4000元（翻一倍）', '4000元基本工资加1倍', '4000元工\n资翻一倍',
];

for (const expression of bounds) {
  test('whole bound is conservatively non-exact: ' + JSON.stringify(expression), () => {
    const result = money(expression);
    assert.equal(result.amount, null); assert.equal(result.status, 'approximate'); assert.equal(result.rawValue, expression);
  });
  test('a full quote cannot crop off the bound: ' + JSON.stringify(expression), () => {
    const f = fixture(expression, { fullQuote: true }), result = candidateValue(f.candidate);
    assert.equal(result.amount, null); assert.equal(result.normalization.rawValue, '4000元');
    assert.equal(result.value, '4000元');
  });
}
for (const expression of operations) {
  test('whole explicit numeric multiplier does not return its base: ' + JSON.stringify(expression), () => {
    const result = money(expression);
    assert.equal(result.amount, null); assert.equal(result.status, 'unsupported'); assert.equal(result.rawValue, expression);
  });
  test('a full quote cannot crop off the numeric multiplier: ' + JSON.stringify(expression), () => {
    const f = fixture(expression, { fullQuote: true }), result = candidateValue(f.candidate);
    assert.equal(result.amount, null); assert.equal(result.normalization.status, 'unsupported');
    assert.equal(result.value, '4000元'); assert.equal(result.normalization.rawValue, '4000元');
  });
}

if (!minimal) {
  for (const expression of [...bounds, ...operations]) test('fresh/source/read-time exact downgrade keeps original raw and CP: ' + JSON.stringify(expression), () => {
    for (const fullQuote of [false, true]) check(fixture(expression, { fullQuote }), null);
  });
  for (const before of ['高达', '高達', '低至', '高\n达', '低\u200d至']) test('same-page preceding prefix fragment is unavailable: ' + JSON.stringify(before), () => {
    for (const fullQuote of [false, true]) check(fixture('4000元', { before, fullQuote }), null);
  });
  for (const next of ['翻一倍。', '加2倍。', '翻\n两\n倍。', '工资翻一倍。']) test('same-page following multiplier fragment cannot expose base: ' + JSON.stringify(next), () => {
    for (const fullQuote of [false, true]) check(fixture('4000元', { next, fullQuote }), null);
  });
  test('page metadata prevents qualifier/formula composition', () => {
    for (const before of ['高达', '低至']) check(fixture('4000元', { before, otherPage: true }), '4000.00');
    for (const next of ['翻一倍。', '工资加两倍。']) check(fixture('4000元', { next, otherPage: true }), '4000.00');
  });
  for (const prefix of ['高达三个月工资合计', '工作低至三个月工资合计', '高达公司工资合计', '翻一倍后工资合计', '加两倍后工资共']) {
    test('unrelated duration/name or explicitly stated result keeps its amount: ' + prefix, () => {
      assert.equal(money(prefix + '4000元').amount, '4000.00');
      // The unchanged source review conservatively reads 裸“月工资” as a rate
      // in these two duration phrases, in both fixed d963 and this patch.
      // Keep that existing source limitation separate from literal attachment.
      check(fixture(prefix + '4000元'), prefix.includes('三个月') ? null : '4000.00');
    });
  }
  for (const tail of ['。李乙工资翻一倍', '，另一人工资加两倍', '工资已付，另一人翻一倍']) {
    test('sentence/owner separation does not attach a multiplier: ' + tail, () => {
      assert.equal(money('4000元' + tail).amount, '4000.00');
      check(fixture('4000元' + tail), '4000.00');
    });
  }
  test('finite ordinary words and separate statements do not trigger lexical arithmetic', () => {
    for (const tail of ['翻译记录', '翻阅记录', '翻一页', '加班费已付', '工资另行翻一倍', '工资，翻一倍事宜另议', '。翻一倍', '，加一倍', '/月', '2名工人'])
      assert.equal(arithmetic('', tail), false, tail);
    for (const before of ['高达公司工资', '高达三个月工资', '低至三天后的工资', '。李乙工资'])
      assert.equal(qualifier(before, ''), null, before);
  });
  test('new shared bound grammar protects qualified range endpoints', () => {
    for (const before of ['3000元至高达', '3000元至高達', '3000元至低至'])
      assert.equal(isMoneyRangeEndpoint(before, '4000元', ''), true, before);
    assert.equal(isMoneyRangeEndpoint('2024年3月至', '4000元', ''), false);
  });
  test('comparison-only bound keys cannot equal a precise base or opposite limit', () => {
    assert.notEqual(canonical('高达4000元'), canonical('4000元'));
    assert.notEqual(canonical('高达4000元'), canonical('低至4000元'));
    assert.equal(canonical('高達四千元'), canonical('高达4000元'));
    assert.equal(canonical('4000元翻一倍'), null);
  });
  test('supported rates and existing non-exact guards retain their contracts', () => {
    for (const [unit, rateUnit] of [['/月', 'month'], ['/小时', 'hour']]) {
      check(fixture('4000元' + unit, { meaning: 'rate', rateUnit }), '4000.00');
      check(fixture('4000元' + unit, { meaning: 'due_total' }), null);
    }
    for (const expression of ['4000元翻倍', '4000元加倍', '4000元的2倍', '4000元×2', '4000元乘以提成率',
      '4000元待定', '约4000元', '4000元至5000元', '4000港元']) assert.equal(money(expression).amount, null, expression);
  });
}
