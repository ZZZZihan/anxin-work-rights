import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Synthetic-only independent integration review. No frozen data/answers, model,
// Worker, network, build, production state, or historical receipt is touched.
const root = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const moduleAt = path => import(pathToFileURL(resolve(root, path)).href);
const { normalizeMoneyValueV4, normalizeCandidateValueV4, canonicalMonetaryExpression } = await moduleAt('lib/material-money-v4.ts');
const { ingestRuntimeCandidates } = await moduleAt('lib/material-fact-runtime-ingest.ts');
const { reviewFactsAgainstSources } = await moduleAt('lib/material-fact-source-review.ts');
const { emptyFactState, ingestCandidates: ingestFrozen, buildFactView } = await moduleAt('lib/material-facts-v3.ts');
const { assessCase } = await moduleAt('experiments/material-facts-v7/assess.mjs');
const modes = ['raw_basic', 'raw_relational', 'raw_strict', 'accepted_basic', 'accepted_relational', 'accepted_strict'];
const AT = '2026-10-18T12:00:00.000Z';
const cp = text => Array.from(text).length;
const sourceFor = text => ({ id: 'round7-independent-source', name: 'synthetic-round7.txt', sha256: 'b'.repeat(64),
  analysisRevision: 7, ready: true, blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] });
const entry = (value, quote, overrides = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲',
  scope: 'individual', meaning: 'due_total', completeness: 'complete', period: null, rateUnit: null,
  assertion: 'narrated', ...overrides });
const output = entries => JSON.stringify({ schemaVersion: 3, candidates: entries });
const sourceText = expression => '😀王甲2024年7月完整应付工资为' + expression + '。';
function ingested(source, candidates) {
  const raw = output(candidates);
  const state = ingestRuntimeCandidates(emptyFactState(7), source, { raw }, 'independent-arithmetic', 'synthetic-owner', AT, null);
  assert.equal(state.materials[0].raw, raw, 'Arithmetic output remains byte-for-byte in raw evidence.');
  assert.deepEqual(JSON.parse(state.materials[0].raw).candidates, candidates);
  assert.deepEqual(state.confirmations, { due: null, paid: null });
  assert.equal(state.calculation, null);
  return state;
}
function score(text, candidates, specs) {
  const input = { id: 'arithmetic-independent-case', source: sourceFor(text) };
  const label = { id: input.id, schemaVersion: 3, label_status: 'provisional_non_expert',
    expected: specs.map(spec => spec.candidate),
    events: specs.map((spec, i) => {
      const at = spec.at ?? text.indexOf(spec.anchor);
      assert(at >= 0 && text.slice(at, at + spec.anchor.length) === spec.anchor);
      return { id: 'event-' + i, anchors: [{ blockId: 'b1', start: cp(text.slice(0, at)), end: cp(text.slice(0, at + spec.anchor.length)) }] };
    }), expected_event_ids: specs.map((_, i) => 'event-' + i), acceptable_alternatives: [] };
  const result = { id: input.id, finish_reason: 'stop', raw_output: output(candidates) };
  const before = structuredClone({ input, label, result });
  const row = assessCase(input, label, result);
  assert.deepEqual({ input, label, result }, before, 'Scoring must not repair source, labels or saved output.');
  return row;
}
function allCounts(row, expected) {
  for (const mode of modes) assert.deepEqual([row[mode].tp, row[mode].fp, row[mode].fn], expected, mode);
}
function evidence(name, value) { console.log(JSON.stringify({ evidence: name, ...value })); }
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-source-review.ts', 'lib/material-fact-runtime-ingest.ts', 'experiments/material-facts-v7/assess.mjs']) {
  evidence('implementation_hash', { path, sha256: createHash('sha256').update(await readFile(resolve(root, path))).digest('hex') });
}


const unsupportedSources = [
  ['currency prefix payment', '王甲的工资以港币支付四万元'],
  ['currency prefix wage', '王甲港币工资四万元'],
  ['currency prefix valuation', '王甲港币计价工资四万元'],
  ['currency suffix payment', '王甲工资四万元以港币支付'],
  ['currency suffix valuation', '王甲工资四万元工资以美元计价'],
  ['currency suffix declared', '王甲工资四万元币种为港币'],
  ['monthly standard', '王甲月工资标准为四万元'],
  ['monthly agreed', '王甲月工资约定为四万元'],
  ['monthly basic standard', '王甲每月基本工资标准为四万元'],
];
function unavailable(text, quote, history = false) {
  const source = sourceFor(text), candidate = entry('四万元', quote);
  let state = ingested(source, [candidate]);
  if (history) {
    state = ingestFrozen(emptyFactState(7), source, { raw: output([candidate]) }, 'historical-round7', 'synthetic-owner', AT, null);
    const saved = state.materials[0].candidates[0];
    saved.amount = '40000.00'; saved.normalization = {rawValue:'四万元',status:'exact',amount:'40000.00',matchedText:'四万元',span:{start:0,end:3},reason:'Synthetic pre-fix persisted operand.'};
  }
  const before = structuredClone(state), reviewed = reviewFactsAgainstSources(state, [source]);
  const stored = reviewed.materials[0].candidates[0];
  evidence('unavailable-round7', { text, quote, history, amount: stored?.amount, issues: stored?.reviewIssues });
  assert.equal(reviewed.materials[0].candidates.length, 1, 'The evidence remains reviewable.');
  assert.equal(stored.amount, null);
  assert.notEqual(stored.normalization.status, 'exact');
  assert.deepEqual(stored.representation, candidate);
  assert.equal(stored.start, cp(text.slice(0, text.indexOf(quote))));
  assert.equal(stored.end, stored.start + cp(quote));
  assert.equal(reviewed.materials[0].raw, before.materials[0].raw);
  assert.deepEqual(state, before, 'Read-time review must not change persisted evidence.');
  assert.equal(buildFactView(reviewed, [source]).canCalculate, false);
}
for (const [name, clause] of unsupportedSources) for (const style of ['full', 'cropped', 'historical-cropped']) test(name + ' cannot survive source cropping: ' + style, () => {
  const text = '😀' + clause + '。';
  unavailable(text, style === 'full' ? text : '四万元', style === 'historical-cropped');
});
const expressions = ['四万元工资的2倍', '四万元劳务费的两倍', '四万元劳动报酬的2.5倍', '四万元工资款的二分之一倍', '四万元工资总额×2', '四万元工资乘以2', '四万元工资2倍', '四万元基本工资２倍'];
for (const expression of expressions) {
  test('wage-noun arithmetic cannot normalize to its operand: ' + expression, () => {
    const normalized = normalizeMoneyValueV4(expression);
    assert.equal(normalized.amount, null);
    assert.notEqual(normalized.status, 'exact');
    assert.notEqual(canonicalMonetaryExpression(expression), canonicalMonetaryExpression('四万元'));
    assert.equal(normalized.rawValue, expression);
    const candidate = entry('四万元', sourceText(expression));
    assert.equal(normalizeCandidateValueV4(candidate).amount, null);
  });
  for (const style of ['full', 'cropped', 'historical-cropped']) test('wage-noun source arithmetic remains unavailable: ' + expression + ' / ' + style, () => {
    const text = sourceText(expression);
    unavailable(text, style === 'full' ? text : '四万元', style === 'historical-cropped');
  });
  test('six layers cannot borrow the base event through a wage-noun formula: ' + expression, () => {
    const text = sourceText(expression);
    allCounts(score(text, [entry(expression, text)], [{candidate:entry('四万元', text),anchor:'四万元'}]), [0,1,1]);
    allCounts(score(text, [entry('四万元', '四万元')], [{candidate:entry(expression, text),anchor:expression}]), [0,1,1]);
  });
}
const positives = [
  ['ordinary calendar basic wages', '王甲2024年7月基本工资为四万元。', {}],
  ['relative calendar basic wages', '王甲本月基本工资为四万元。', {}],
  ['a bare next-line multiplier after a wage noun', '王甲人民币工资四万元工资\n2倍工资另行讨论。', {}],
  ['ordinary total over three months', '王甲三个月的工资合计四万元。', {}],
  ['genuine monthly standard', '王甲月工资标准为四万元。', {meaning:'rate',completeness:'not_applicable',rateUnit:'month'}],
  ['genuine monthly basic standard', '王甲每月基本工资标准为四万元。', {meaning:'rate',completeness:'not_applicable',rateUnit:'month'}],
  ['foreign currency in earlier event', '李乙的工资以港币支付三万元，王甲人民币工资四万元。', {}],
  ['foreign currency in later event', '王甲人民币工资四万元。李乙的工资以港币支付三万元。', {}],
  ['multiplier in later event', '王甲人民币工资四万元。李乙的工资款按基本工资的2倍计算。', {}],
  ['same amount and multiplier in later event', '王甲完整应付工资四万元。李乙的工资款为四万元工资的2倍。', {}, '王甲完整应付工资四万元'],
  ['same amount and foreign currency in later event', '王甲人民币工资四万元。李乙港币工资四万元。', {}, '王甲人民币工资四万元'],
];
for (const [name,text,overrides,quote] of positives) test('finite guards preserve ' + name, () => {
  const source = sourceFor(text), candidate = entry('四万元', quote ?? text, overrides);
  const state = ingested(source, [candidate]);
  const stored = state.materials[0].candidates[0];
  assert.equal(stored.amount, '40000.00');
  assert.deepEqual(stored.representation,candidate);
  assert.equal(buildFactView(state,[source]).canCalculate,false);
});
for (const value of ['工资若干元','四万余元','四万至五万元','****元']) test('unresolved money stays raw and reviewable: ' + value, () => {
  const text='王甲工资为'+value+'。', candidate=entry(value,text), source=sourceFor(text);
  const state=ingested(source,[candidate]);
  assert.equal(state.materials[0].candidates.length,1);
  assert.equal(state.materials[0].candidates[0].amount,null);
  assert.deepEqual(state.materials[0].candidates[0].representation,candidate);
});
