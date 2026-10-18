import test from 'node:test';
import assert from 'node:assert/strict';

// Synthetic source-review regression, not model or business acceptance. The
// override permits the isolated patch to use the frozen integration dependencies.
const reviewUrl = new URL(process.env.MATERIAL_FACT_REVIEW_MODULE ?? '../lib/material-fact-source-review.ts', import.meta.url);
const { reviewCandidateAgainstSource } = await import(reviewUrl.href);
const { emptyFactState, ingestCandidates } = await import(new URL('./material-facts-v3.ts', reviewUrl).href);

function review(text, { meaning = 'due_total', rateUnit = null, period = null, subject = '王甲' } = {}) {
  const source = {
    id: 'relative-month-synthetic', name: '合成相对月份原文', sha256: 'a'.repeat(64),
    analysisRevision: 1, ready: true,
    blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }],
  };
  const representation = {
    kind: 'money', value: '1000元', quote: '1000元', blockId: 'b1',
    subject, scope: 'individual', meaning,
    completeness: meaning === 'rate' ? 'not_applicable' : 'unknown',
    period, rateUnit, assertion: 'narrated',
  };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [representation] });
  const state = ingestCandidates(emptyFactState(1), source, { raw }, 'synthetic', 'synthetic-owner', '2026-10-18T00:00:00.000Z');
  const candidate = state.materials[0].candidates[0];
  assert.ok(candidate, 'fixture must enter the candidate store');
  assert.equal(candidate.amount, '1000.00', 'fixture starts with an exact RMB amount');
  const before = structuredClone({ source, state, candidate });
  const reviewed = reviewCandidateAgainstSource(candidate, source);
  assert.deepEqual({ source, state, candidate }, before, 'review must not mutate source, stored raw or candidate');
  assert.deepEqual(reviewed.representation, representation, 'review must retain all model fields');
  assert.equal(reviewed.value, '1000元');
  assert.equal(reviewed.quote, '1000元');
  assert.equal(reviewed.start, Array.from(text.slice(0, text.indexOf('1000元'))).length);
  assert.equal(reviewed.end, reviewed.start + Array.from('1000元').length);
  assert.equal(state.materials[0].raw, raw);
  return reviewed;
}

for (const month of ['上月', '本月', '下月', '上个月', '下个月', '上一个月', '下一个月', '这个月', '这月', '当月', '该月']) {
  test(`${month}工资 is a period amount, including when the quote crops the month`, () => {
    const reviewed = review(`😀王甲${month}工资1000元。`, { period: month });
    assert.equal(reviewed.amount, '1000.00');
    assert.equal(reviewed.normalization.status, 'exact');
    assert.ok(!reviewed.reviewIssues.some(issue => issue.code === 'rate_unit_mismatch'));
  });
}

for (const month of ['2026年1月', '一月', '正月', '腊月']) {
  test(`${month}工资 remains a calendar period rather than a monthly rate`, () => {
    const reviewed = review(`王甲${month}工资1000元。`, { period: month });
    assert.equal(reviewed.amount, '1000.00');
    assert.ok(!reviewed.reviewIssues.some(issue => issue.code === 'rate_unit_mismatch'));
  });
}

for (const wage of ['月工资1000元', '月薪1000元', '每月工资1000元', '每月1000元', '1000元/月', '1000元每月']) {
  test(`a cropped total cannot hide the real monthly rate: ${wage}`, () => {
    const reviewed = review(`王甲${wage}。`);
    assert.equal(reviewed.amount, null);
    assert.equal(reviewed.normalization.status, 'rate_unit_mismatch');
    assert.ok(reviewed.reviewIssues.some(issue => issue.code === 'rate_unit_mismatch'));
  });
  test(`a correctly declared monthly rate remains exact: ${wage}`, () => {
    const reviewed = review(`王甲${wage}。`, { meaning: 'rate', rateUnit: 'month' });
    assert.equal(reviewed.amount, '1000.00');
    assert.ok(!reviewed.reviewIssues.some(issue => issue.code === 'rate_unit_mismatch'));
  });
}

test('an explicit rate suffix still governs an amount associated with a relative month', () => {
  const reviewed = review('王甲上月工资1000元/月。', { period: '上月' });
  assert.equal(reviewed.amount, null);
  assert.ok(reviewed.reviewIssues.some(issue => issue.code === 'rate_unit_mismatch'));
});

test('a real monthly rate still rejects a mismatched declared day rate', () => {
  const reviewed = review('王甲本月月工资1000元。', { meaning: 'rate', rateUnit: 'day', period: '本月' });
  assert.equal(reviewed.amount, null);
  assert.equal(reviewed.normalization.status, 'rate_unit_mismatch');
});

test('a relative-month word inside the complete subject cannot hide a real monthly rate', () => {
  const reviewed = review('张本月工资1000元。', { subject: '张本' });
  assert.equal(reviewed.amount, null);
  assert.equal(reviewed.normalization.status, 'rate_unit_mismatch');
});

test('a relative month following that complete subject still names a period', () => {
  const reviewed = review('张本本月工资1000元。', { subject: '张本', period: '本月' });
  assert.equal(reviewed.amount, '1000.00');
  assert.ok(!reviewed.reviewIssues.some(issue => issue.code === 'rate_unit_mismatch'));
});

test('an explicit 月薪 rate is not exempted by a preceding relative-month word', () => {
  const reviewed = review('王甲本月薪1000元。');
  assert.equal(reviewed.amount, null);
  assert.equal(reviewed.normalization.status, 'rate_unit_mismatch');
});
