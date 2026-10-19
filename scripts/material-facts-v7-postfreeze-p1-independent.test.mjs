import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// New independent red sentinels after formal v7 freeze. This file lives only in
// the isolated review tree. It reads implementation modules, never frozen data,
// real model outputs, or persisted user state. Set V7_REVIEW_ROOT to audit a
// separate corrective checkout; original red evidence stays immutable.
const root = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const moduleAt = path => import(pathToFileURL(resolve(root, path)).href);
const { normalizeMoneyValueV4, normalizeCandidateValueV4, canonicalMonetaryExpression } = await moduleAt('lib/material-money-v4.ts');
const { validateRuntimeCandidateOutput } = await moduleAt('lib/material-fact-runtime-ingest.ts');
const { assessCase, resolveCandidateEvent } = await moduleAt('experiments/material-facts-v7/assess.mjs');
const modes = ['raw_basic', 'raw_relational', 'raw_strict', 'accepted_basic', 'accepted_relational', 'accepted_strict'];
const cp = text => Array.from(text).length;
const sourceFor = text => ({ id: 'postfreeze-independent-source', name: 'synthetic.txt', sha256: 'd'.repeat(64),
  analysisRevision: 7, ready: true, blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] });
const entry = (value, quote, overrides = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲',
  scope: 'individual', meaning: 'due_total', completeness: 'complete', period: '2024年7月', rateUnit: null,
  assertion: 'narrated', ...overrides });
const output = entries => JSON.stringify({ schemaVersion: 3, candidates: entries });
function fixture(text, goldValue, overrides = {}) {
  const source = sourceFor(text), gold = entry(goldValue, text, overrides);
  const start = text.indexOf(goldValue);
  assert.ok(start >= 0);
  const input = { id: 'postfreeze-independent-case', source };
  const label = { id: input.id, schemaVersion: 3, label_status: 'provisional_non_expert', expected: [gold],
    events: [{ id: 'wage-event', anchors: [{ blockId: 'b1', start: cp(text.slice(0, start)), end: cp(text.slice(0, start + goldValue.length)) }] }],
    expected_event_ids: ['wage-event'], acceptable_alternatives: [] };
  return { input, label, gold };
}
function assess(fx, candidate) {
  return assessCase(fx.input, fx.label, { id: fx.input.id, finish_reason: 'stop', raw_output: output([candidate]) });
}
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-source-review.ts', 'lib/material-fact-runtime-ingest.ts', 'experiments/material-facts-v7/assess.mjs']) {
  console.log(JSON.stringify({ evidence: 'implementation_hash', path, sha256: createHash('sha256').update(await readFile(resolve(root, path))).digest('hex') }));
}

test('4305687517: a cropped first endpoint of an RMB-to-RMB range never becomes an exact amount', () => {
  const text = '王甲2024年7月完整应付工资为人民币3万元至人民币4万元。';
  const fx = fixture(text, '人民币3万元至人民币4万元');
  const candidate = entry('人民币3万元', '人民币3万元');
  const normalization = normalizeCandidateValueV4({ ...candidate, quote: text });
  const batch = validateRuntimeCandidateOutput(output([candidate]), fx.input.source);
  const row = assess(fx, candidate);
  console.log(JSON.stringify({ evidence: 'cropped_range', text, raw: candidate,
    whole: normalizeMoneyValueV4(fx.gold.value), normalized_with_full_quote: normalization,
    stored_amount: batch.candidates[0]?.amount, stored_normalization: batch.candidates[0]?.normalization,
    stored_issues: batch.candidates[0]?.reviewIssues, six_counts: Object.fromEntries(modes.map(m => [m, [row[m].tp,row[m].fp,row[m].fn]])),
    production_defense: row.production_defense }));
  assert.equal(batch.candidates.length, 1, 'unsupported range evidence may remain reviewable');
  assert.equal(batch.candidates[0].amount, null, 'full source must constrain the cropped endpoint');
  assert.equal(normalization.amount, null, 'the quote-aware normalizer must also reject an exact endpoint');
  for (const mode of modes) assert.deepEqual([row[mode].tp,row[mode].fp,row[mode].fn], [0,1,1], mode);
});

test('4305687521: a whole narrative paragraph cannot be the value of one anchored amount', () => {
  const text = '王甲声称公司长期拖欠其工资，现要求支付4000元并追究责任。';
  const fx = fixture(text, '4000元', { meaning: 'arrears', completeness: 'not_applicable', period: null, assertion: 'claimed' });
  const candidate = { ...fx.gold, value: text, quote: text };
  const row = assess(fx, candidate);
  console.log(JSON.stringify({ evidence: 'whole_paragraph', text, gold: fx.gold, raw: candidate, anchors: fx.label.events,
    raw_key: canonicalMonetaryExpression(candidate.value), gold_key: canonicalMonetaryExpression(fx.gold.value),
    event: resolveCandidateEvent(candidate, fx.input, fx.label),
    six_counts: Object.fromEntries(modes.map(m => [m, [row[m].tp,row[m].fp,row[m].fn]])), production_defense: row.production_defense }));
  for (const mode of modes) assert.deepEqual([row[mode].tp,row[mode].fp,row[mode].fn], [0,1,1], mode);
});

for (const relative of ['上月','本月','下月']) test('4305687523: ' + relative + '工资 identifies a period rather than a rate', () => {
  // Keep the exact reported triggering wording 月工资 adjacent; the period is
  // in the original source and the model literal is only the monetary token.
  const trigger = '王甲' + relative + '工资为4000元。';
  const source = sourceFor(trigger), candidate = entry('4000元', trigger, { period: relative });
  const batch = validateRuntimeCandidateOutput(output([candidate]), source);
  console.log(JSON.stringify({ evidence: 'relative_wage_period', relative, text: trigger, raw: candidate,
    amount: batch.candidates[0]?.amount, normalization: batch.candidates[0]?.normalization, issues: batch.candidates[0]?.reviewIssues }));
  assert.equal(batch.candidates.length, 1);
  assert.equal(batch.candidates[0].amount, '4000.00');
  assert.ok(!batch.candidates[0].reviewIssues.some(issue => issue.code === 'rate_unit_mismatch'));
});


for (const prefix of ['人民币', 'RMB', 'CNY', '¥', '￥']) {
  test('finite RMB prefix aligns at the same Unicode amount occurrence: ' + prefix, () => {
    const text = '😀王甲工资' + prefix + '4000元。', fx = fixture(text, '4000元', { period: null });
    const candidate = { ...fx.gold, value: prefix + '4000元' };
    const row = assess(fx, candidate);
    for (const mode of modes) assert.deepEqual([row[mode].tp,row[mode].fp,row[mode].fn], [1,0,0], mode);
    const position = row.event_alignment.raw[0].positions[0];
    assert.equal(position.start, cp('😀王甲工资'));
    assert.equal(position.end, cp('😀王甲工资' + candidate.value));
  });
}

test('finite RMB prefix and wage suffix permit both containment directions', () => {
  const text = '王甲工资人民币4000元工资。';
  const minimal = fixture(text, '4000元', { period: null }), expanded = fixture(text, '人民币4000元工资', { period: null });
  for (const [fx,value] of [[minimal, '人民币4000元工资'], [expanded, '4000元']]) {
    const row = assess(fx, { ...fx.gold, value });
    for (const mode of modes) assert.deepEqual([row[mode].tp,row[mode].fp,row[mode].fn], [1,0,0], mode);
  }
});

for (const [text,value] of [
  ['王甲声称应支付4000元。','王甲声称应支付4000元'],
  ['王甲声称应支付4000元并追究责任。','4000元并追究责任'],
  ['王甲声称应支付4000元执行款。','4000元执行款'],
]) test('a narrative or object phrase around an exact amount cannot borrow its anchor: ' + value, () => {
  const fx = fixture(text, '4000元', { period: null }), candidate = { ...fx.gold, value };
  const row = assess(fx, candidate);
  assert.equal(row.raw_count, 1);
  assert.equal(row.accepted_count, 1, 'this check concerns source-event scoring, not schema rejection');
  for (const mode of modes) assert.deepEqual([row[mode].tp,row[mode].fp,row[mode].fn], [0,1,1], mode);
});

test('a bare-number clipping cannot borrow the event of a complete monetary value', () => {
  const fx = fixture('王甲工资4000元。', '4000元', { period: null }), row = assess(fx, { ...fx.gold, value: '4000' });
  for (const mode of modes) assert.deepEqual([row[mode].tp,row[mode].fp,row[mode].fn], [0,1,1], mode);
});

test('date boundary wrappers align an event but never replace exact date-value equality', () => {
  const fx = fixture('王甲截至2024年7月1日前正常工作。', '2024年7月1日',
    { kind: 'date', meaning: 'employment_period', completeness: 'not_applicable', period: null });
  const candidate = { ...fx.gold, value: '截至2024年7月1日前' }, row = assess(fx, candidate);
  assert.equal(row.event_alignment.raw[0].event, 'wage-event');
  for (const mode of modes) assert.deepEqual([row[mode].tp,row[mode].fp,row[mode].fn], [0,1,1], mode);
});

test('a year clipped out of a full date is not its registered event', () => {
  const fx = fixture('王甲2024年7月1日入职。', '2024年7月1日',
    { kind: 'date', meaning: 'employment_period', completeness: 'not_applicable', period: null });
  const row = assess(fx, { ...fx.gold, value: '2024年' });
  assert.equal(row.event_alignment.raw[0].event, null);
  for (const mode of modes) assert.deepEqual([row[mode].tp,row[mode].fp,row[mode].fn], [0,1,1], mode);
});

for (const [complete,cropped] of [['八百零四元六角整','八百零四元六角'], ['四万元正','四万元']]) {
  test('postfreeze currency grammar permits an optional exactness terminator: ' + complete, () => {
    const text = '王甲工资' + complete + '。';
    for (const [goldValue,value] of [[complete,cropped], [cropped,complete]]) {
      const fx = fixture(text, goldValue, { period: null }), row = assess(fx, { ...fx.gold, value });
      assert.equal(canonicalMonetaryExpression(value), canonicalMonetaryExpression(goldValue));
      for (const mode of modes) assert.deepEqual([row[mode].tp,row[mode].fp,row[mode].fn], [1,0,0], mode);
    }
  });
}
for (const [complete,cropped] of [['八百零四元六角整','八百零四元'], ['四万元五角整','四万元'], ['四万元整','四万']]) {
  test('currency containment still rejects clipped cents, units or magnitude: ' + complete + '/' + cropped, () => {
    const fx = fixture('王甲工资' + complete + '。', complete, { period: null }), row = assess(fx, { ...fx.gold, value: cropped });
    assert.equal(row.event_alignment.raw[0].event, null);
    for (const mode of modes) assert.deepEqual([row[mode].tp,row[mode].fp,row[mode].fn], [0,1,1], mode);
  });
}
