import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const IMPLEMENTATION = fileURLToPath(new URL('../', import.meta.url));
const SOURCE = resolve(process.env.MATERIAL_FACT_TEST_ROOT || IMPLEMENTATION);
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-arithmetic-noun-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(SOURCE, 'lib'), resolve(temporary, 'lib'), { recursive: true });
// Only the shared helper is replaced. Parser, source review, currency and the
// historical stores are the integration tree's unchanged dependencies.
await cp(resolve(IMPLEMENTATION, 'lib/material-fact-arithmetic-review.ts'), resolve(temporary, 'lib/material-fact-arithmetic-review.ts'));
const load = name => import(pathToFileURL(resolve(temporary, 'lib', name)).href);
const { normalizeMoneyValueV4, normalizeCandidateValueV4 } = await load('material-money-v4.ts');
const { hasAttachedMoneyArithmetic } = await load('material-fact-arithmetic-review.ts');
const { reviewCandidateAgainstSource } = await load('material-fact-source-review.ts');
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates } = await load('material-facts-v3.ts');
const { ingestCandidates: ingestV2, validateCandidateOutput: validateV2 } = await load('material-facts-v2.ts');
const AT = '2026-10-18T00:00:00.000Z';

function fixture(text, value = '四万元') {
  const source = { id: 'noun-arithmetic-synthetic', name: '合成工资名词倍数', sha256: 'b'.repeat(64), analysisRevision: 1, ready: true,
    blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
  const representation = { kind: 'money', value, quote: value, blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'arrears',
    completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [representation] });
  const stored = ingestCandidates(emptyFactState(1), source, { raw }, 'synthetic', 'audit', AT);
  const candidate = stored.materials[0].candidates[0];
  assert(candidate);
  const normalization = normalizeMoneyValueV4(value);
  assert.equal(normalization.amount, '40000.00');
  Object.assign(candidate, { amount: normalization.amount, normalization });
  return { source, representation, raw, stored, candidate };
}

for (const expression of ['四万元工资的2倍', '四万元基本工资的2倍']) {
  test(`complete literal rejects the monetary operand: ${expression}`, () => {
    const normalized = normalizeMoneyValueV4(expression);
    assert.equal(normalized.amount, null);
    assert.equal(normalized.status, 'unsupported'); assert.equal(normalized.rawValue, expression);
  });
  test(`a full quote cannot make a cropped operand precise: ${expression}`, () => {
    const { representation } = fixture(`王甲欠薪为${expression}。`);
    const normalized = normalizeCandidateValueV4({ ...representation, quote: `王甲欠薪为${expression}。` });
    assert.equal(normalized.amount, null); assert.equal(normalized.normalization.status, 'unsupported');
    assert.equal(normalized.value, '四万元'); assert.equal(normalized.normalization.rawValue, '四万元');
  });
  test(`historical precision cannot bypass the full source block: ${expression}`, () => {
    const f = fixture(`😀王甲欠薪为${expression}。`), before = structuredClone(f);
    const reviewed = reviewCandidateAgainstSource(f.candidate, f.source);
    assert.equal(reviewed.amount, null); assert.equal(reviewed.normalization.status, 'unsupported');
    assert(reviewed.reviewIssues.some(issue => issue.code === 'source_amount_context_mismatch'));
    assert.deepEqual(f, before); assert.deepEqual(reviewed.representation, f.representation);
    assert.equal(reviewed.start, Array.from(`😀王甲欠薪为`).length);
    assert.equal(reviewed.end, reviewed.start + Array.from('四万元').length);
    const fresh = ingestRuntimeCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'audit', AT);
    assert.equal(fresh.materials[0].candidates.length, 1);
    assert.equal(fresh.materials[0].candidates[0].amount, null); assert.equal(fresh.materials[0].raw, f.raw);
  });
}

const nouns = ['工资', '基本工资', '月工资', '工资款', '工资总额', '应发工资', '应付工资', '实发工资', '欠付工资', '拖欠工资',
  '薪资', '薪酬', '奖金', '津贴', '补贴', '劳务费', '劳动报酬', '加班费', '经济补偿金', '赔偿金'];
for (const noun of nouns) test(`finite amount noun requires a multiplier after explicit 的: ${noun}`, () => {
  for (const factor of ['2', '二', '两', '2.5', '２．５', '负二']) {
    const expression = `四万元${noun}的${factor}倍`;
    assert(hasAttachedMoneyArithmetic('', `${noun}的${factor}倍`), expression);
    assert.equal(normalizeMoneyValueV4(expression).amount, null, expression);
    const { representation } = fixture(`王甲欠薪为${expression}。`);
    assert.equal(normalizeCandidateValueV4({ ...representation, quote: expression }).amount, null, expression);
  }
});

for (const suffix of ['工资的\n2倍', '\n工资的两倍', '基本工资\n的2倍', '基本\n工资的二倍',
  '工\u200d资的２\u2060倍', ' 基 本 工 资 的 （ ２．５ 倍 ）', '（工资）的（二倍）', '工资的\u20282倍',
  '工资的\u2029二倍', '劳动\n报酬的二倍', '劳务费的\n两倍']) {
  test(`layout/Unicode detection preserves the raw quote: ${JSON.stringify(suffix)}`, () => {
    const expression = `四万元${suffix}`, { representation } = fixture(`王甲欠薪为${expression}。`);
    assert.equal(normalizeMoneyValueV4(expression).amount, null);
    const normalized = normalizeCandidateValueV4({ ...representation, quote: expression });
    assert.equal(normalized.amount, null); assert.equal(normalized.normalization.rawValue, representation.value);
    const f = fixture(`😀王甲欠薪为${expression}。`), before = structuredClone(f);
    assert.equal(reviewCandidateAgainstSource(f.candidate, f.source).amount, null);
    assert.deepEqual(f, before);
  });
}

test('v2 persisted exact amounts are downgraded without changing the original record', () => {
  const f = fixture('王甲欠薪为40000元劳动报酬的2倍。', '40000元');
  const raw = JSON.stringify({ schemaVersion: 2, candidates: [f.representation] });
  const state = ingestV2(emptyFactState(1), f.source, validateV2(raw, f.source), 'synthetic', 'audit', AT);
  const candidate = state.materials[0].candidates[0], original = structuredClone(state);
  assert.equal(candidate.amount, '40000.00');
  const reviewed = reviewCandidateAgainstSource(candidate, f.source);
  assert.equal(reviewed.amount, null); assert.equal(reviewed.schemaVersion, 2);
  assert.equal(Object.hasOwn(reviewed, 'normalization'), false); assert.deepEqual(state, original);
});

for (const suffix of ['工资×2', '基本工资＊２', '工资x2', '劳务费乘以二', '劳动报酬乘\n以2',
  '工资除以二', '工资／２', '基本工资+\n2000元', '工资加上二', '工资−二', '劳动报酬减\n去2',
  '工资×\n２\u2060', '工资乘以负二']) {
  test(`a named amount followed by an explicit operator is still an operand: ${JSON.stringify(suffix)}`, () => {
    const expression = `四万元${suffix}`;
    assert(hasAttachedMoneyArithmetic('', suffix), suffix);
    assert.equal(normalizeMoneyValueV4(expression).amount, null);
    const f = fixture(`😀王甲欠薪为${expression}。`), before = structuredClone(f);
    assert.equal(normalizeCandidateValueV4({ ...f.representation, quote: f.source.blocks[0].text }).amount, null);
    assert.equal(reviewCandidateAgainstSource(f.candidate, f.source).amount, null);
    const fresh = ingestRuntimeCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'audit', AT);
    assert.equal(fresh.materials[0].candidates[0].amount, null); assert.equal(fresh.materials[0].raw, f.raw);
    assert.deepEqual(f, before);
  });
}

for (const suffix of ['工资2倍', '基本工资２倍']) {
  test(`same-line bare noun multiplier rejects the complete monetary operand: ${suffix}`, () => {
    const expression = `四万元${suffix}`, normalized = normalizeMoneyValueV4(expression);
    assert.equal(normalized.amount, null);
    assert.equal(normalized.status, 'unsupported'); assert.equal(normalized.rawValue, expression);
  });
  test(`same-line bare noun multiplier cannot be made precise by cropping: ${suffix}`, () => {
    const f = fixture(`😀王甲欠薪为四万元${suffix}。`), before = structuredClone(f);
    const normalized = normalizeCandidateValueV4({ ...f.representation, quote: f.source.blocks[0].text });
    assert.equal(normalized.amount, null); assert.equal(normalized.normalization.rawValue, '四万元');
    assert.equal(reviewCandidateAgainstSource(f.candidate, f.source).amount, null);
    const fresh = ingestRuntimeCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'audit', AT);
    assert.equal(fresh.materials[0].candidates[0].amount, null); assert.equal(fresh.materials[0].raw, f.raw);
    assert.deepEqual(f, before);
  });
}

for (const suffix of ['工资二倍', '工资两倍', '工资2.5倍', '基本工资２．５倍', '工\u200d资２\u2060倍',
  ' 基 本 工 资 ２ 倍', '工资款2倍', '工资总额2倍', '劳务费负二倍', '劳动报酬2倍']) {
  test(`a bare factor may attach only directly to a finite noun on the same line: ${JSON.stringify(suffix)}`, () => {
    assert(hasAttachedMoneyArithmetic('', suffix), suffix);
    const expression = `四万元${suffix}`, f = fixture(`王甲欠薪为${expression}。`);
    assert.equal(normalizeMoneyValueV4(expression).amount, null);
    assert.equal(normalizeCandidateValueV4({ ...f.representation, quote: f.source.blocks[0].text }).amount, null);
    assert.equal(reviewCandidateAgainstSource(f.candidate, f.source).amount, null);
  });
}

for (const after of ['。另一工人工资的2倍另案处理。', '，另一工人劳务费的2倍另案处理。',
  '\n另一工人工资的2倍另案处理。', '工资已付。另一人工资的两倍。', '基本工资，共2名工人。',
  '\n2倍工资另案处理。', '工资另案处理按2倍。', '工资2人', '基本工资２名工人',
  '工资\n2倍', '\n工资2倍', '基\n本工资2倍', '工资2\n倍', '工资\u20282倍', '工资2\u2029倍',
  '/月', '/日', '/小时', '/件']) {
  test(`sentence breaks, other prose and genuine rates do not create noun arithmetic: ${JSON.stringify(after)}`, () => {
    assert.equal(hasAttachedMoneyArithmetic('', after), false);
  });
}

test('established multiplier wages, counts and independent amounts stay precise', () => {
  for (const text of ['王甲两倍工资共四万元。', '王甲起算后两倍工资四万元。', '王甲四万元工资，另一工人按2倍计算。',
    '王甲工资四万元，已工作2个月。']) {
    const f = fixture(text), reviewed = reviewCandidateAgainstSource(f.candidate, f.source);
    assert.equal(reviewed.amount, '40000.00', text);
  }
  for (const [suffix, rateUnit] of [['月', 'month'], ['日', 'day'], ['小时', 'hour'], ['件', 'piece']]) {
    const f = fixture(`王甲工资四万元/${suffix}。`);
    Object.assign(f.candidate.representation, { meaning: 'rate', rateUnit });
    assert.equal(reviewCandidateAgainstSource(f.candidate, f.source).amount, '40000.00', suffix);
  }
});

test('the existing direct operator/fraction grammar remains intact', () => {
  for (const suffix of ['的2倍', '的二分之一', '的一半', '的50%', '的百分之五十', '×\n2', '+\n2000元', '除\n以二'])
    assert(hasAttachedMoneyArithmetic('', suffix), suffix);
  for (const prefix of ['2倍的', '２\u200d×', '二乘以', '二加\n上']) assert(hasAttachedMoneyArithmetic(prefix, ''), prefix);
});
