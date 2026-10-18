import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Synthetic runtime/store checks only; no model, HTTP server or business approval.
// A separate dependency root supports an isolated patch without mutating either
// checkout. In the integrated repository both variables can simply be omitted.
const root = resolve(process.env.MATERIAL_FACT_TEST_ROOT ?? fileURLToPath(new URL('../', import.meta.url)));
const runtimeSource = resolve(process.env.MATERIAL_FACT_RUNTIME_MODULE ?? resolve(root, 'lib/material-fact-runtime-ingest.ts'));
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-dedup-review-'));
after(async () => { await rm(temporary, { recursive: true, force: true }); });
await cp(resolve(root, 'lib'), resolve(temporary, 'lib'), { recursive: true });
await cp(runtimeSource, resolve(temporary, 'lib/material-fact-runtime-ingest.ts'));
const { validateRuntimeCandidateOutput, ingestRuntimeCandidates } = await import(pathToFileURL(resolve(temporary, 'lib/material-fact-runtime-ingest.ts')).href);
const { emptyFactState } = await import(pathToFileURL(resolve(temporary, 'lib/material-facts-v3.ts')).href);

const sourceFor = (...texts) => ({
  id: 'dedup-review-synthetic', name: '合成去重材料', sha256: 'b'.repeat(64), analysisRevision: 1, ready: true,
  blocks: texts.map((text, index) => ({ id: `b${index + 1}`, page: index + 1, text, bbox: null, confidence: null })),
});
const entry = (value, quote, overrides = {}) => ({
  kind: 'money', value, quote, blockId: 'b1', subject: null, scope: 'unknown', meaning: 'payment',
  completeness: 'partial', period: null, rateUnit: null, assertion: 'narrated', ...overrides,
});

function check(source, entries, count, rejected = []) {
  const raw = JSON.stringify({ schemaVersion: 3, candidates: entries });
  const before = structuredClone({ source, entries });
  const checked = validateRuntimeCandidateOutput(raw, source);
  const initial = emptyFactState(1);
  const state = ingestRuntimeCandidates(initial, source, { raw }, 'synthetic-test', 'synthetic-owner', '2026-10-18T00:00:00.000Z', 'no-model');
  const material = state.materials[0];
  assert.equal(checked.raw, raw);
  assert.equal(material.raw, raw);
  assert.deepEqual(JSON.parse(material.raw).candidates, entries, 'retain every raw value, quote and candidate in original order');
  assert.deepEqual({ source, entries }, before, 'never modify original source or model fields');
  assert.deepEqual(initial, emptyFactState(1), 'ingestion must not mutate the prior state');
  assert.deepEqual(state.confirmations, { due: null, paid: null });
  assert.equal(state.calculation, null);
  assert.equal(checked.candidates.length, count);
  assert.equal(material.candidates.length, count, 'the real ingestion state must retain the expected observations');
  assert.deepEqual(checked.rejected.map(item => item.index), rejected);
  assert.deepEqual(material.rejected, checked.rejected);
  assert.deepEqual(material.candidates.map(item => item.representation), entries.filter((_, index) => !rejected.includes(index)));
  assert.equal(checked.coverage.rawCount, entries.length);
  assert.equal(checked.coverage.acceptedCount, count);
  return material.candidates;
}

test('two non-unique bare quotes retain both same-attribute payments for review', () => {
  const source = sourceFor('第一次支付四万元。第二次支付四万元。');
  const observations = check(source, [entry('四万元', '四万元'), entry('四万元', '四万元')], 2);
  assert.ok(observations.every(item => item.amount === null));
  assert.ok(observations.every(item => item.reviewIssues.some(issue => issue.code === 'local_context_ambiguous')));
});

test('a unique quote with two possible value positions cannot prove duplicate identity', () => {
  const text = '第一次支付四万元。第二次支付四万元。';
  check(sourceFor(text), [entry('四万元', text), entry('四万元', text)], 2);
});

for (const reverse of [false, true]) {
  test(`an arbitrary narrative cannot evict the minimal amount, reversed=${reverse}`, () => {
    const text = '😀王甲声称公司长期拖欠其工资，现要求支付四万元并追究责任。';
    const entries = [entry(text, text), entry('四万元', text)];
    if (reverse) entries.reverse();
    const observations = check(sourceFor(text), entries, 2);
    assert.ok(observations.every(item => item.amount === '40000.00'), 'fixture reaches the exact-value collision');
    assert.ok(observations.some(item => item.value === '四万元'), 'the legal minimal literal must survive');
  });

  test(`a unique finite RMB wrapper still identifies one occurrence, reversed=${reverse}`, () => {
    const text = '😀第一次支付人民币四万元。';
    const entries = [entry('人民币四万元', text), entry('四万元', '四万元')];
    if (reverse) entries.reverse();
    const observations = check(sourceFor(text), entries, 1, [1]);
    assert.equal(observations[0].amount, '40000.00');
  });

  test(`the same unique value with different quote extents still collapses, reversed=${reverse}`, () => {
    const text = '😀王甲收到工资四万元。';
    const entries = [entry('四万元', text), entry('四万元', '四万元')];
    if (reverse) entries.reverse();
    check(sourceFor(text), entries, 1, [1]);
  });

  test(`non-overlapping same-attribute payment events remain distinct, reversed=${reverse}`, () => {
    const first = '😀第一次支付四万元。', second = '𠮷第二次支付四万元。';
    const entries = [entry('四万元', first), entry('四万元', second)];
    if (reverse) entries.reverse();
    const observations = check(sourceFor(first + second), entries, 2);
    assert.ok(observations.every(item => item.amount === '40000.00'));
    assert.equal(new Set(observations.map(item => item.start)).size, 2, 'Unicode positions must identify separate quoted events');
  });
}

test('equal values in separate source blocks remain distinct', () => {
  const first = '第一次支付四万元。', second = '第二次支付四万元。';
  check(sourceFor(first, second), [entry('四万元', first), entry('四万元', second, { blockId: 'b2' })], 2);
});

test('different assertions at one unique position remain separate observations', () => {
  const text = '王甲收到工资四万元。';
  check(sourceFor(text), [entry('四万元', text, { assertion: 'claimed' }), entry('四万元', text)], 2);
});
