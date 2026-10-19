import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Synthetic source-review regression only. Use a temporary dependency copy so
// an isolated patch can read integration dependencies without changing them.
const IMPLEMENTATION_ROOT = fileURLToPath(new URL('../', import.meta.url));
const ROOT = resolve(process.env.MATERIAL_FACT_TEST_ROOT || IMPLEMENTATION_ROOT);
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-arithmetic-source-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(ROOT, 'lib'), resolve(temporary, 'lib'), { recursive: true });
for (const path of ['material-fact-source-review.ts', 'material-fact-arithmetic-review.ts'])
  await cp(resolve(IMPLEMENTATION_ROOT, 'lib', path), resolve(temporary, 'lib', path));
const load = name => import(pathToFileURL(resolve(temporary, 'lib', name)).href);
const { reviewCandidateAgainstSource } = await load('material-fact-source-review.ts');
const { hasAttachedMoneyArithmetic } = await load('material-fact-arithmetic-review.ts');
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates } = await load('material-facts-v3.ts');
const { ingestCandidates: ingestV2, validateCandidateOutput: validateV2 } = await load('material-facts-v2.ts');
const { normalizeMoneyValueV4 } = await load('material-money-v4.ts');
const ACTOR = 'synthetic-owner', AT = '2026-10-18T00:00:00.000Z';

function fixture(text, value, options = {}) {
  const { blockIndex = 0, ...attributes } = options;
  const texts = Array.isArray(text) ? text : [text];
  const source = { id: 'arithmetic-source-synthetic', name: '合成金额运算源文', sha256: 'a'.repeat(64), analysisRevision: 1, ready: true,
    blocks: texts.map((text, index) => ({ id: `b${index + 1}`, page: 1, text, bbox: null, confidence: null })) };
  const representation = { kind: 'money', value, quote: value, blockId: `b${blockIndex + 1}`, subject: '王甲', scope: 'individual', meaning: 'arrears',
    completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated', ...attributes };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [representation] });
  const state = ingestCandidates(emptyFactState(1), source, { raw }, 'synthetic', ACTOR, AT);
  const candidate = state.materials[0].candidates[0];
  assert.ok(candidate, 'synthetic candidate must enter the store');
  // Reconstruct a previously stored precise v3 amount. Source review must only
  // downgrade this field, including when a prior parser accepted a cropped value.
  const normalization = normalizeMoneyValueV4(value);
  assert.equal(normalization.amount, '40000.00');
  Object.assign(candidate, { amount: normalization.amount, normalization });
  return { source, representation, raw, state, candidate };
}

const unsafe = [
  ['四万元的2倍', '四万元'], ['四万元的二倍', '四万元'], ['四万元的两倍', '四万元'],
  ['四万元的2.5倍', '四万元'], ['四万元的２．５倍', '四万元'], ['四万元\u200b的２\u2060倍', '四万元'],
  ['四万元 的 ( 二 倍 )', '四万元'], ['四万元整的2倍', '四万元'],
  ['2倍的四万元', '四万元'], ['二倍的四万元', '四万元'], ['２\u2060倍的（人民币四万元）', '四万元'],
  ['2×四万元', '四万元'], ['四万元×2', '四万元'], ['四万元＊２', '四万元'], ['四万元x2', '四万元'],
  ['四万元乘以二', '四万元'], ['四万元除以二', '四万元'], ['四万元/2', '四万元'], ['四万元／２', '四万元'],
  ['2乘以人民币四万元', '四万元'], ['2÷四万元', '四万元'],
  ['40000元的2倍', '40000元'], ['40000元的2倍', '40000'],
  ['40000人民币的2倍', '40000'], ['2倍的人民币40000元', '40000'],
  ['40000元乘以2', '40000元'], ['40000元÷2', '40000元'],
  ['40000元+2000元', '40000元'], ['40000元加2000元', '40000元'], ['40000元减2000元', '40000元'],
  ['二加上四万元', '四万元'], ['二减去四万元', '四万元'], ['四万元加上二', '四万元'], ['四万元减去二', '四万元'],
  ['四万元的\n2倍', '四万元'], ['四万元\n的2倍', '四万元'], ['四万元×\n2', '四万元'], ['四万元\n×2', '四万元'],
  ['四万元乘以\n二', '四万元'], ['2倍的\n四万元', '四万元'], ['2×\n四万元', '四万元'],
  ['四万元+\n2000元', '四万元'], ['四万元\u2028的2倍', '四万元'], ['四万元的\u20292倍', '四万元'],
  ['四万元的负二倍', '四万元'], ['四万元的負２倍', '四万元'], ['四万元乘以负2', '四万元'],
  ['四万元的二分之一', '四万元'], ['四万元的一半', '四万元'], ['四万元的半', '四万元'],
  ['四万元的50%', '四万元'], ['四万元的５０％', '四万元'], ['四万元的百分之五十', '四万元'],
  ['四万元的\n二分之一', '四万元'], ['四万元\n的50%', '四万元'], ['四万元的（二\u200b分之一）', '四万元'],
  ['四万元乘\n以2', '四万元'], ['四万元除\n以二', '四万元'],
  ['四万元加\n上二', '四万元'], ['四万元的二\n分\n之一', '四万元'],
  ['四万元的1/2倍', '四万元'], ['四万元的二分之一倍', '四万元'], ['四万元的１／２', '四万元'],
];

for (const [expression, value] of unsafe) {
  test(`a cropped ${value} cannot hide attached arithmetic: ${expression}`, () => {
    const text = `😀王甲本期欠薪为${expression}。`;
    const { source, representation, raw, state, candidate } = fixture(text, value);
    const unchanged = structuredClone({ source, state });
    const reviewed = reviewCandidateAgainstSource(candidate, source);
    assert.equal(reviewed.amount, null);
    assert.equal(reviewed.normalization.status, 'unsupported');
    assert.ok(reviewed.reviewIssues.some(issue => issue.code === 'source_amount_context_mismatch'));
    assert.deepEqual({ source, state }, unchanged, 'historical review must not mutate stored evidence or authorization');
    assert.deepEqual(reviewed.representation, representation);
    assert.equal(reviewed.value, value); assert.equal(reviewed.quote, value);
    assert.equal(reviewed.start, Array.from(text.slice(0, text.indexOf(value))).length);
    assert.equal(reviewed.end, reviewed.start + Array.from(value).length);
    const fresh = ingestRuntimeCandidates(emptyFactState(1), source, { raw }, 'synthetic', ACTOR, AT);
    assert.equal(fresh.materials[0].candidates.length, 1, 'unavailable money remains visible for review');
    assert.equal(fresh.materials[0].candidates[0].amount, null);
    assert.equal(fresh.materials[0].raw, raw);
    assert.deepEqual(fresh.materials[0].candidates[0].representation, representation);
    assert.deepEqual(fresh.confirmations, emptyFactState(1).confirmations);
    assert.deepEqual(reviewCandidateAgainstSource(reviewed, source), reviewed, 'review is idempotent');
  });
}

for (const expression of ['40000元的2倍', '2倍的40000元', '40000元/2']) {
  test(`a historical v2 precise amount is also constrained: ${expression}`, () => {
    const { source, representation } = fixture(`王甲欠薪为${expression}。`, '40000元');
    const raw = JSON.stringify({ schemaVersion: 2, candidates: [representation] });
    const original = ingestV2(emptyFactState(1), source, validateV2(raw, source), 'synthetic', ACTOR, AT);
    const candidate = original.materials[0].candidates[0];
    assert.equal(candidate.amount, '40000.00');
    const reviewed = reviewCandidateAgainstSource(candidate, source);
    assert.equal(reviewed.amount, null); assert.equal(reviewed.schemaVersion, 2);
    assert.equal(Object.hasOwn(reviewed, 'normalization'), false);
    assert.deepEqual(reviewed.representation, representation);
    assert.equal(original.materials[0].raw, raw); assert.equal(candidate.amount, '40000.00');
  });
}

for (const expression of [
  '王甲欠薪四万元。另一工人按2倍计算。', '另一工人按2倍计算。王甲欠薪四万元。',
  '王甲欠薪四万元，另一工人按2倍计算。', '王甲欠薪四万元\n2倍工资另案处理。',
  '2倍的\n王甲欠薪四万元。', '王甲起算后两倍工资四万元。', '王甲两倍工资共四万元。',
  '王甲欠薪四万元。另一工人工资的50%。', '王甲欠薪四万元\n50%工资另案处理。',
  '王甲欠薪四万元，另一工人工资的二分之一。',
]) {
  test(`other prose, events or line boundaries do not attach arithmetic: ${expression}`, () => {
    const { source, candidate } = fixture(expression, '四万元');
    assert.equal(reviewCandidateAgainstSource(candidate, source).amount, '40000.00');
  });
}

for (const [unit, rateUnit] of [['月', 'month'], ['日', 'day'], ['小时', 'hour'], ['件', 'piece']]) {
  test(`a real /${unit} rate remains precise`, () => {
    const { source, candidate } = fixture(`王甲工资四万元/${unit}。`, '四万元', { meaning: 'rate', rateUnit });
    const reviewed = reviewCandidateAgainstSource(candidate, source);
    assert.equal(reviewed.amount, '40000.00'); assert.equal(reviewed.normalization.status, 'exact');
  });
}

test('shared detection views fold compatibility/control characters without joining lines or events', () => {
  assert.equal(hasAttachedMoneyArithmetic('２\u2060倍的人民币', ''), true);
  assert.equal(hasAttachedMoneyArithmetic('', '元整的（２\u200b倍）'), true);
  assert.equal(hasAttachedMoneyArithmetic('两倍工资共', ''), false);
  assert.equal(hasAttachedMoneyArithmetic('', '/月'), false);
  assert.equal(hasAttachedMoneyArithmetic('2倍的\n', ''), true);
  assert.equal(hasAttachedMoneyArithmetic('', '的\n2倍'), true);
  assert.equal(hasAttachedMoneyArithmetic('', '\n×2'), true);
  assert.equal(hasAttachedMoneyArithmetic('', '\n2倍工资'), false);
  assert.equal(hasAttachedMoneyArithmetic('', '\u20282倍工资'), false);
  assert.equal(hasAttachedMoneyArithmetic('', '。的2倍'), false);
});

for (const [blocks, blockIndex] of [
  [['王甲欠薪四万元的', '2倍'], 0], [['王甲欠薪四万元', '的2倍'], 0],
  [['王甲欠薪四万元', '×2'], 0], [['王甲欠薪四万元×', '2'], 0],
  [['王甲欠薪四万元乘以', '二'], 0], [['王甲欠薪四万元', '加上2000元'], 0],
  [['王甲欠薪2倍的', '四万元'], 1], [['王甲欠薪2×', '四万元'], 1],
  [['王甲欠薪四万元的', '二分之一'], 0], [['王甲欠薪四万元', '的一半'], 0],
  [['王甲欠薪四万元', '的50%'], 0],
]) {
  test(`adjacent source blocks continue explicit arithmetic: ${JSON.stringify(blocks)}`, () => {
    const { source, raw, candidate } = fixture(blocks, '四万元', { blockIndex });
    const before = structuredClone({ source, candidate });
    const reviewed = reviewCandidateAgainstSource(candidate, source);
    assert.equal(reviewed.amount, null); assert.equal(reviewed.normalization.status, 'unsupported');
    assert.deepEqual({ source, candidate }, before);
    assert.equal(reviewed.blockId, `b${blockIndex + 1}`);
    assert.equal(reviewed.start, Array.from(blocks[blockIndex].split('四万元')[0]).length);
    const fresh = ingestRuntimeCandidates(emptyFactState(1), source, { raw }, 'synthetic', ACTOR, AT);
    assert.equal(fresh.materials[0].candidates[0].amount, null);
    assert.equal(fresh.materials[0].raw, raw);
  });
}

for (const blocks of [
  ['王甲欠薪四万元', '2倍工资另案处理'], ['王甲欠薪四万元。', '的2倍另案处理'],
  ['王甲欠薪四万元', '王乙工资2倍'], ['王甲欠薪四万元', '另一工人工资', '的2倍'],
]) {
  test(`source-block boundaries do not connect an unrelated event: ${JSON.stringify(blocks)}`, () => {
    const { source, candidate } = fixture(blocks, '四万元');
    assert.equal(reviewCandidateAgainstSource(candidate, source).amount, '40000.00');
  });
}
