import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Synthetic runtime/read-time source review. No model, HTTP, gold or original
// experiment artifact is read or written. Only the two owned modules are overlaid.
const IMPLEMENTATION = fileURLToPath(new URL('../', import.meta.url));
const SOURCE = resolve(process.env.MATERIAL_FACT_TEST_ROOT || IMPLEMENTATION);
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-currency-rate-review-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(SOURCE, 'lib'), resolve(temporary, 'lib'), { recursive: true });
for (const name of ['material-fact-currency-review.ts', 'material-fact-source-review.ts'])
  await cp(resolve(IMPLEMENTATION, 'lib', name), resolve(temporary, 'lib', name));
const load = name => import(pathToFileURL(resolve(temporary, 'lib', name)).href);
const { reviewCandidateAgainstSource } = await load('material-fact-source-review.ts');
const { sourceMoneyHasUnsupportedCurrency } = await load('material-fact-currency-review.ts');
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates } = await load('material-facts-v3.ts');
const { ingestCandidates: ingestV2, validateCandidateOutput: validateV2 } = await load('material-facts-v2.ts');
const { normalizeMoneyValueV4 } = await load('material-money-v4.ts');
const ACTOR = 'synthetic-owner', AT = '2026-10-18T00:00:00.000Z';

function fixture(text, attributes = {}, value = '四万元') {
  const source = { id: 'synthetic-currency-rate-source', name: '合成币种与工资标准来源', sha256: 'b'.repeat(64), analysisRevision: 1, ready: true,
    blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
  const representation = { kind: 'money', value, quote: value, blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'arrears',
    completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated', ...attributes };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [representation] });
  const state = ingestCandidates(emptyFactState(1), source, { raw }, 'synthetic', ACTOR, AT), candidate = state.materials[0].candidates[0];
  assert.ok(candidate, 'Synthetic candidate enters the actual store');
  // Reconstruct a historically stored exact amount independently of the new
  // source guard. Review must downgrade it without rewriting stored evidence.
  const normalization = normalizeMoneyValueV4(value); assert.equal(normalization.amount, '40000.00');
  Object.assign(candidate, { amount: normalization.amount, normalization });
  return { source, raw, state, candidate, representation };
}

function unavailable(text, status, attributes = {}) {
  const f = fixture(text, attributes), snapshot = structuredClone({ source: f.source, state: f.state });
  const reviewed = reviewCandidateAgainstSource(f.candidate, f.source);
  assert.equal(reviewed.amount, null); assert.equal(reviewed.normalization.status, status);
  assert.ok(reviewed.reviewIssues.some(issue => issue.code === 'source_amount_context_mismatch'));
  if (status === 'rate_unit_mismatch') assert.ok(reviewed.reviewIssues.some(issue => issue.code === 'rate_unit_mismatch'));
  assert.deepEqual({ source: f.source, state: f.state }, snapshot);
  assert.deepEqual(reviewed.representation, f.representation);
  assert.equal(reviewed.value, '四万元'); assert.equal(reviewed.quote, '四万元');
  assert.equal(reviewed.start, Array.from(text.slice(0, text.indexOf('四万元'))).length);
  assert.equal(reviewed.end, reviewed.start + 3);
  assert.deepEqual(reviewCandidateAgainstSource(reviewed, f.source), reviewed);
  const fresh = ingestRuntimeCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', ACTOR, AT);
  assert.equal(fresh.materials[0].candidates.length, 1); assert.equal(fresh.materials[0].candidates[0].amount, null);
  assert.equal(fresh.materials[0].raw, f.raw); assert.deepEqual(fresh.materials[0].candidates[0].representation, f.representation);
  assert.deepEqual(fresh.confirmations, emptyFactState(1).confirmations);
}

const currencies = ['港币', '港幣', '美元', 'HKD', 'ＨＫＤ', '港\u200b币'];
for (const currency of currencies) for (const bridge of ['支付', '工资', '计价工资']) {
  test(`a cropped wage value cannot erase ${currency}${bridge} currency attribution`, () => {
    unavailable(`😀王甲的工资以${currency}${bridge}四万元。`, 'unsupported');
  });
}
for (const phrase of ['港币发放', '港币结算工资', '港币基本工资为', '港币计价的工资为', '港币支付共计', '港币工资：', '港币 工资 为 ']) {
  test(`a finite same-event currency bridge remains unavailable: ${phrase}`, () => unavailable(`王甲${phrase}四万元。`, 'unsupported'));
}
for (const tail of ['以港币支付', '工资以美元计价', '工资以美元支付', '币种为港币', '币种：ＨＫＤ', ' 工资 以 港\u200b币 发放', '按美元结算']) {
  test(`a postposed same-event currency cannot be cropped: ${tail}`, () => unavailable(`😀王甲工资四万元${tail}。`, 'unsupported'));
}
for (const tail of ['，王乙工资以港币支付三万元', '。另一工人的币种为美元', '\n以港币支付王乙工资', '\u2028币种为美元', '\u2029工资以美元计价', '王乙工资以港币支付三万元']) {
  test(`a postposed currency on another event does not change RMB: ${JSON.stringify(tail)}`, () => {
    const { source, candidate } = fixture(`王甲人民币欠薪四万元${tail}。`);
    assert.equal(reviewCandidateAgainstSource(candidate, source).amount, '40000.00');
  });
}

for (const separator of ['，', ',', '。', '；', ';', '\n', '\r\n', '\u2028', '\u2029']) {
  for (const order of ['before', 'after']) test(`foreign wages in another clause do not change RMB (${JSON.stringify(separator)}, ${order})`, () => {
    const foreign = '王乙的工资以港币支付三万元', rmb = '王甲人民币欠薪四万元';
    const { source, candidate } = fixture(order === 'before' ? foreign + separator + rmb : rmb + separator + foreign);
    assert.equal(reviewCandidateAgainstSource(candidate, source).amount, '40000.00');
  });
}

const monthly = ['月工资标准为', '月薪标准：', '每月基本工资', '月工资约定为', '月工资标准是', '月薪约定为', '每月基本工资标准为', '每月工资标准：', '月基本工资标准为', '月 工资 标准 为 '];
for (const prefix of monthly) {
  test(`cropped monthly wage standard is not an arrears amount: ${prefix}`, () => unavailable(`😀王甲${prefix}四万元。`, 'rate_unit_mismatch'));
  test(`a declared month rate matches its finite source standard: ${prefix}`, () => {
    const { source, candidate } = fixture(`王甲${prefix}四万元。`, { meaning: 'rate', rateUnit: 'month' });
    const reviewed = reviewCandidateAgainstSource(candidate, source);
    assert.equal(reviewed.amount, '40000.00'); assert.equal(reviewed.normalization.status, 'exact');
  });
  test(`a declared day rate cannot borrow a monthly standard: ${prefix}`, () => unavailable(`王甲${prefix}四万元。`, 'rate_unit_mismatch', { meaning: 'rate', rateUnit: 'day' }));
}

for (const month of ['2024年7月', '２０２４年７月', '二〇二四年七月', '上月', '本月', '下月', '该月', '上个月', '这月']) {
  for (const tail of ['工资合计', '基本工资为']) test(`${month}${tail} remains a bounded wage-period amount`, () => {
    const { source, candidate } = fixture(`王甲${month}${tail}四万元。`);
    const reviewed = reviewCandidateAgainstSource(candidate, source);
    assert.equal(reviewed.amount, '40000.00'); assert.ok(!reviewed.reviewIssues.some(issue => issue.code === 'rate_unit_mismatch'));
  });
}
for (const period of ['2026年1', '本', '上']) for (const wage of ['月工资标准为', '月薪标准：']) {
  test(`an explicit wage standard remains a rate after ${period}${wage}`, () => unavailable(`王甲${period}${wage}四万元。`, 'rate_unit_mismatch'));
  test(`a correct monthly rate survives the period-qualified standard ${period}${wage}`, () => {
    const { source, candidate } = fixture(`王甲${period}${wage}四万元。`, { meaning: 'rate', rateUnit: 'month' });
    assert.equal(reviewCandidateAgainstSource(candidate, source).amount, '40000.00');
  });
}
for (const separator of ['，', '。', '\n', '\u2028', '\u2029']) test(`a monthly standard in a separate clause cannot lend its rate (${JSON.stringify(separator)})`, () => {
  const { source, candidate } = fixture(`另一工人月工资标准为三万元${separator}王甲欠薪四万元。`);
  assert.equal(reviewCandidateAgainstSource(candidate, source).amount, '40000.00');
});
for (const separator of ['\n', '\u2028', '\u2029']) test(`rate-prefix detection does not erase a line boundary (${JSON.stringify(separator)})`, () => {
  const { source, candidate } = fixture(`王甲月工资标准为${separator}四万元。`);
  assert.equal(reviewCandidateAgainstSource(candidate, source).amount, '40000.00');
});

for (const [text, status] of [['王甲港币工资40000元。', 'unsupported'], ['王甲月工资标准为40000元。', 'rate_unit_mismatch']]) {
  test(`historical v2 amount also obeys source attribution: ${text}`, () => {
    const { source, representation } = fixture(text, {}, '40000元');
    const raw = JSON.stringify({ schemaVersion: 2, candidates: [representation] });
    const state = ingestV2(emptyFactState(1), source, validateV2(raw, source), 'synthetic', ACTOR, AT), candidate = state.materials[0].candidates[0];
    assert.equal(candidate.amount, '40000.00'); const original = structuredClone(state);
    const reviewed = reviewCandidateAgainstSource(candidate, source);
    assert.equal(reviewed.amount, null); assert.equal(Object.hasOwn(reviewed, 'normalization'), false);
    assert.ok(reviewed.reviewIssues.some(issue => issue.code === 'source_amount_context_mismatch'));
    if (status === 'rate_unit_mismatch') assert.ok(reviewed.reviewIssues.some(issue => issue.code === 'rate_unit_mismatch'));
    assert.deepEqual(state, original); assert.deepEqual(reviewed.representation, representation);
  });
}

test('direct currency guard uses the anchored token, not arbitrary earlier text', () => {
  const normalization = normalizeMoneyValueV4('四万元');
  for (const text of ['王甲港币工资四万元', '王甲以港币支付四万元', '王甲港币计价工资四万元'])
    assert.equal(sourceMoneyHasUnsupportedCurrency({ blockText: text, valueStart: text.indexOf('四万元') }, normalization), true);
  const text = '港币支付另一工人的工资，王甲人民币四万元';
  assert.equal(sourceMoneyHasUnsupportedCurrency({ blockText: text, valueStart: text.indexOf('四万元') }, normalization), false);
});
