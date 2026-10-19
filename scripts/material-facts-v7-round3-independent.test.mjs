import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Independent synthetic review of third-round PR45 findings. No frozen input,
// label, real model answer, service or existing user state is read or changed.
const root = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const moduleAt = path => import(pathToFileURL(resolve(root, path)).href);
const { validateRuntimeCandidateOutput, ingestRuntimeCandidates } = await moduleAt('lib/material-fact-runtime-ingest.ts');
const { emptyFactState } = await moduleAt('lib/material-facts-v3.ts');
const { classifyMonetaryExpression } = await moduleAt('lib/material-money-v4.ts');
const { assessCase } = await moduleAt('experiments/material-facts-v7/assess.mjs');
const modes = ['raw_basic', 'raw_relational', 'raw_strict', 'accepted_basic', 'accepted_relational', 'accepted_strict'];
const cp = text => Array.from(text).length;
const output = entries => JSON.stringify({ schemaVersion: 3, candidates: entries });
const sourceFor = text => ({ id: 'round3-independent-source', name: 'synthetic-round3.txt', sha256: 'e'.repeat(64),
  analysisRevision: 7, ready: true, blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] });
const entry = (value, quote, overrides = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲',
  scope: 'individual', meaning: 'due_total', completeness: 'complete', period: null, rateUnit: null,
  assertion: 'narrated', ...overrides });
const occurrences = (text, literal) => {
  const spans = [];
  for (let at = text.indexOf(literal); at >= 0; at = text.indexOf(literal, at + 1)) {
    spans.push({ blockId: 'b1', start: cp(text.slice(0, at)), end: cp(text.slice(0, at + literal.length)) });
  }
  return spans;
};
function evaluate(text, entries, goldSpecs = []) {
  const source = sourceFor(text), raw = output(entries);
  const input = { id: 'round3-independent-case', source };
  const expected = goldSpecs.map(spec => spec.candidate);
  const label = { id: input.id, schemaVersion: 3, label_status: 'provisional_non_expert', expected,
    events: goldSpecs.map((spec, index) => ({ id: 'event-' + index, anchors: [spec.anchor] })),
    expected_event_ids: goldSpecs.map((_, index) => 'event-' + index), acceptable_alternatives: [] };
  const before = structuredClone({ input, label, entries });
  const batch = validateRuntimeCandidateOutput(raw, source);
  const state = ingestRuntimeCandidates(emptyFactState(7), source, { raw }, 'independent-round3', 'synthetic-owner',
    '2026-10-18T12:00:00.000Z', null);
  const material = state.materials[0];
  const row = assessCase(input, label, { id: input.id, finish_reason: 'stop', raw_output: raw });
  assert.deepEqual({ input, label, entries }, before, 'audit must not mutate evidence or gold');
  assert.equal(material.raw, raw, 'all original candidates remain byte-for-byte in raw output');
  assert.equal(row.raw_count, entries.length);
  assert.equal(material.candidates.length, batch.candidates.length);
  return { source, raw, batch, material, row };
}
function allCounts(row, raw, accepted = raw) {
  for (const mode of modes) assert.deepEqual([row[mode].tp, row[mode].fp, row[mode].fn],
    mode.startsWith('raw_') ? raw : accepted, mode);
}
function record(name, result) {
  console.log(JSON.stringify({ evidence: name, raw_count: result.row.raw_count, accepted_count: result.row.accepted_count,
    accepted_values: result.material.candidates.map(c => c.representation.value),
    accepted_amounts: result.material.candidates.map(c => c.amount), rejected: result.batch.rejected,
    six_counts: Object.fromEntries(modes.map(mode => [mode, [result.row[mode].tp, result.row[mode].fp, result.row[mode].fn]])),
    event_alignment: result.row.event_alignment }));
}
for (const path of ['lib/material-fact-runtime-ingest.ts', 'lib/material-money-v4.ts',
  'lib/material-fact-source-review.ts', 'experiments/material-facts-v7/assess.mjs']) {
  console.log(JSON.stringify({ evidence: 'implementation_hash', path,
    sha256: createHash('sha256').update(await readFile(resolve(root, path))).digest('hex') }));
}

for (const quoteStyle of ['repeated-short-quote', 'unique-quote-repeated-value']) {
  test('4305746125: unresolved occurrences retain both observations: ' + quoteStyle, () => {
    const first = '王甲首次支付工资四万元', second = '王甲第二次支付工资四万元';
    const text = '😀' + first + '；' + second + '。';
    const attributes = { meaning: 'payment', completeness: 'partial' };
    const quote = quoteStyle === 'repeated-short-quote' ? '四万元' : text;
    const candidates = [entry('四万元', quote, attributes), entry('四万元', quote, attributes)];
    const spans = occurrences(text, '四万元');
    assert.equal(spans.length, 2);
    const gold = [first, second].map((q, i) => ({ candidate: entry('四万元', q, attributes), anchor: spans[i] }));
    const result = evaluate(text, candidates, gold);
    record(quoteStyle, result);
    assert.equal(result.batch.candidates.length, 2, 'a null/ambiguous anchor is not proof that the observations duplicate');
    assert.equal(result.batch.rejected.length, 0);
    allCounts(result.row, [0, 2, 2]);
    for (const layer of ['raw', 'accepted']) {
      assert.equal(result.row.event_alignment[layer].length, 2);
      assert.ok(result.row.event_alignment[layer].every(item => item.event === null));
    }
  });
}

for (const reverse of [false, true]) {
  test('4305746130: narrative containment cannot suppress the valid minimum in ' + (reverse ? 'minimum-first' : 'narrative-first') + ' order', () => {
    const text = '😀王甲2024年7月完整应付工资为四万元。';
    const minimal = entry('四万元', text), narrative = entry(text, text);
    const entries = reverse ? [minimal, narrative] : [narrative, minimal];
    const result = evaluate(text, entries, [{ candidate: minimal, anchor: occurrences(text, '四万元')[0] }]);
    record('illegal-wrapper-' + reverse, result);
    assert.equal(result.batch.candidates.length, 2, 'arbitrary narrative and an exact literal are not proven duplicate values');
    assert.ok(result.material.candidates.some(c => c.representation.value === '四万元'), 'valid minimum must survive either order');
    allCounts(result.row, [1, 1, 0]);
  });

  test('a true unique finite RMB wrapper still deduplicates in ' + (reverse ? 'cropped-first' : 'full-first') + ' order', () => {
    const text = '😀王甲2024年7月完整应付工资为人民币四万元。';
    const full = entry('人民币四万元', text), minimal = entry('四万元', text);
    const entries = reverse ? [minimal, full] : [full, minimal];
    const result = evaluate(text, entries, [{ candidate: minimal, anchor: occurrences(text, '四万元')[0] }]);
    record('unique-finite-wrapper-' + reverse, result);
    assert.equal(result.batch.candidates.length, 1);
    assert.equal(result.batch.rejected.length, 1);
    allCounts(result.row, [1, 1, 0], [1, 0, 0]);
  });

  test('two distinct uniquely quoted equal payments survive in ' + (reverse ? 'reverse' : 'source') + ' order', () => {
    const first = '王甲首次支付工资四万元', second = '王甲第二次支付工资四万元';
    const text = '😀' + first + '；' + second + '。', attributes = { meaning: 'payment', completeness: 'partial' };
    const candidates = [entry('四万元', first, attributes), entry('四万元', second, attributes)];
    const spans = occurrences(text, '四万元');
    const gold = candidates.map((candidate, i) => ({ candidate, anchor: spans[i] }));
    const result = evaluate(text, reverse ? candidates.toReversed() : candidates, gold);
    assert.equal(result.batch.candidates.length, 2);
    allCounts(result.row, [2, 0, 0]);
  });

  test('different assertions at a unique occurrence never deduplicate in ' + (reverse ? 'reverse' : 'source') + ' order', () => {
    const text = '王甲自称完整应付工资四万元。';
    const narrated = entry('四万元', text), claimed = entry('四万元', text, { assertion: 'claimed' });
    const result = evaluate(text, reverse ? [claimed, narrated] : [narrated, claimed],
      [{ candidate: claimed, anchor: occurrences(text, '四万元')[0] }]);
    assert.equal(result.batch.candidates.length, 2);
    allCounts(result.row, [1, 1, 0]);
  });
}

const nonMoneyPeriods = ['这个月工资', '这月工资', '当月工资', '该月工资', '上个月工资', '下个月工资',
  '上一个月工资', '下一个月工资', '这个月的工资', '下一个月的工资'];
for (const value of nonMoneyPeriods) test('4305746128: a relative wage period without any amount stays raw FP: ' + value, () => {
  const text = '王甲材料仅记载“' + value + '”。', candidate = entry(value, text, { completeness: 'unknown' });
  const result = evaluate(text, [candidate]);
  console.log(JSON.stringify({ evidence: 'non-money-period', value, classification: classifyMonetaryExpression(value),
    accepted: result.batch.candidates.length, raw: result.material.raw }));
  record('non-money-period-' + value, result);
  assert.equal(classifyMonetaryExpression(value).kind, 'not_monetary');
  assert.equal(result.batch.candidates.length, 0);
  assert.equal(result.batch.rejected.length, 1);
  allCounts(result.row, [0, 1, 0], [0, 0, 0]);
});

for (const value of ['工资金额不详', '这个月工资金额不详', '工资金额另议', '新型工资口径待核', '四万元至五万元', '四万元港币']) {
  test('absence gate keeps genuinely unknown or unsupported money reviewable: ' + value, () => {
    const text = '王甲原文记载“' + value + '”。', candidate = entry(value, text, { completeness: 'unknown' });
    const result = evaluate(text, [candidate]);
    assert.notEqual(classifyMonetaryExpression(value).kind, 'not_monetary');
    assert.equal(result.batch.candidates.length, 1, 'unknown is not an established absence of an amount');
    assert.equal(result.batch.rejected.length, 0);
    assert.equal(result.material.candidates[0].amount, null);
    assert.equal(result.material.candidates[0].representation.value, value);
    allCounts(result.row, [0, 1, 0]);
  });
}

