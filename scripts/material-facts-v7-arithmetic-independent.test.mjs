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
const { validateRuntimeCandidateOutput, ingestRuntimeCandidates } = await moduleAt('lib/material-fact-runtime-ingest.ts');
const { reviewFactsAgainstSources } = await moduleAt('lib/material-fact-source-review.ts');
const { emptyFactState, ingestCandidates: ingestFrozen, buildFactView, applyFactAction } = await moduleAt('lib/material-facts-v3.ts');
const { assessCase } = await moduleAt('experiments/material-facts-v7/assess.mjs');
const modes = ['raw_basic', 'raw_relational', 'raw_strict', 'accepted_basic', 'accepted_relational', 'accepted_strict'];
const AT = '2026-10-18T12:00:00.000Z';
const cp = text => Array.from(text).length;
const sourceFor = text => ({ id: 'arithmetic-independent-source', name: 'synthetic-arithmetic.txt', sha256: 'b'.repeat(64),
  analysisRevision: 7, ready: true, blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] });
const entry = (value, quote, overrides = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲',
  scope: 'individual', meaning: 'due_total', completeness: 'complete', period: '2024年7月', rateUnit: null,
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

const expressions = [
  '四万元的2倍', '四万元的两倍', '四万元的2.5倍', '2倍的四万元', '二倍的人民币四万元',
  '四万元乘以2', '2乘以四万元', '四万元除以2', '2除以四万元', '四万元/2', '四万元×2',
  '四万元的２倍', '四万元的2\u200d倍', '四万元的负二倍', '四万元乘以负2',
  '四万元的1/2倍', '四万元的二分之一倍',
];
for (const expression of expressions) {
  test('full arithmetic literal has no exact base amount or exact comparison key: ' + expression, () => {
    const parsed = normalizeMoneyValueV4(expression);
    evidence('full-arithmetic', { expression, parsed, key: canonicalMonetaryExpression(expression) });
    assert.equal(parsed.amount, null, 'Arithmetic is not its displayed base operand.');
    assert.notEqual(parsed.status, 'exact');
    assert.notEqual(canonicalMonetaryExpression(expression), canonicalMonetaryExpression('四万元'));
    assert.equal(parsed.rawValue, expression);
  });

  test('quote-aware normalization cannot lose an attached operation: ' + expression, () => {
    const quote = sourceText(expression), candidate = entry('四万元', quote);
    const normalized = normalizeCandidateValueV4(candidate);
    evidence('cropped-value-full-quote', { expression, normalized });
    assert.equal(normalized.amount, null);
    assert.notEqual(normalized.normalization.status, 'exact');
    assert.equal(normalized.normalization.rawValue, candidate.value);
    assert.equal(candidate.quote, quote);
  });

  test('source review prevents cropping both the operand value and quote: ' + expression, () => {
    const text = sourceText(expression), source = sourceFor(text), candidate = entry('四万元', '四万元');
    const raw = output([candidate]), batch = validateRuntimeCandidateOutput(raw, source);
    const state = ingested(source, [candidate]), stored = state.materials[0].candidates[0];
    evidence('cropped-value-and-quote', { expression, amount: stored?.amount, normalization: stored?.normalization,
      issues: stored?.reviewIssues, accepted: batch.candidates.length, rejected: batch.rejected });
    assert.equal(batch.candidates.length, 1, 'Complex monetary evidence stays reviewable.');
    assert.equal(batch.rejected.length, 0);
    assert.equal(stored.amount, null, 'The original source still governs an operand-only quote.');
    assert.notEqual(stored.normalization.status, 'exact');
    assert.deepEqual(stored.representation, candidate);
    assert.equal(stored.quote, candidate.quote);
    assert.equal(stored.start, cp(text.slice(0, text.indexOf(candidate.quote))));
    assert.equal(stored.end, stored.start + cp(candidate.quote));
  });
}

test('a complete arithmetic candidate remains raw and reviewable without a computed or base amount', () => {
  const expression = '四万元的2倍', text = sourceText(expression), candidate = entry(expression, text);
  const state = ingested(sourceFor(text), [candidate]), stored = state.materials[0].candidates[0];
  assert.equal(state.materials[0].candidates.length, 1);
  assert.equal(stored.amount, null);
  assert.deepEqual(stored.representation, candidate);
  assert.equal(stored.value, expression);
  assert.equal(buildFactView(state, [sourceFor(text)]).canCalculate, false);
});

for (const quoteStyle of ['full', 'cropped']) test('historical exact operand is downgraded for display without editing stored evidence: ' + quoteStyle, () => {
  const text = sourceText('四万元的2倍'), source = sourceFor(text), candidate = entry('四万元', quoteStyle === 'full' ? text : '四万元');
  const historical = ingestFrozen(emptyFactState(7), source, { raw: output([candidate]) }, 'historical-fixture', 'synthetic-owner', AT, null);
  const persisted = historical.materials[0].candidates[0];
  // Simulate an already-persisted exact amount from the defective parser, rather
  // than letting the current parser choose the history that it will review.
  persisted.amount = '40000.00';
  persisted.normalization = { rawValue: '四万元', status: 'exact', amount: '40000.00', matchedText: '四万元',
    span: { start: 0, end: 3 }, reason: 'Synthetic persisted pre-fix exact operand.' };
  const before = structuredClone(historical), reviewed = reviewFactsAgainstSources(historical, [source]);
  const visible = reviewed.materials[0].candidates[0];
  evidence('historical-display', { quoteStyle, amount: visible.amount, normalization: visible.normalization, issues: visible.reviewIssues });
  assert.equal(visible.amount, null);
  assert.notEqual(visible.normalization.status, 'exact');
  assert.equal(reviewed.materials[0].raw, before.materials[0].raw);
  assert.deepEqual(visible.representation, candidate);
  assert.deepEqual(historical, before, 'Read-time review must not rewrite persisted state.');
  const scoped = applyFactAction(reviewed, { action: 'confirm_scope', scope: { worker: '王甲', employer: '甲公司', start: '2024-07-01', end: '2024-07-31' },
    note: 'Independent synthetic scope fixture; no amount confirmed.', verified: true }, [source], 'synthetic-owner', AT);
  const view = buildFactView(scoped, [source]);
  assert.deepEqual(view.fields.due.values, []);
  assert.equal(view.canCalculate, false);
});

test('read-time review never upgrades a historically unsupported operand after a parser change', () => {
  const text = sourceText('四万元'), source = sourceFor(text), candidate = entry('四万元', text);
  const historical = ingestFrozen(emptyFactState(7), source, { raw: output([candidate]) }, 'historical-fixture', 'synthetic-owner', AT, null);
  historical.materials[0].candidates[0].amount = null;
  historical.materials[0].candidates[0].normalization = { rawValue: '四万元', status: 'unsupported', amount: null, matchedText: null, span: null, reason: 'Historical unsupported fixture.' };
  const before = structuredClone(historical), reviewed = reviewFactsAgainstSources(historical, [source]);
  assert.equal(reviewed.materials[0].candidates[0].amount, null);
  assert.deepEqual(reviewed.materials[0].candidates[0].normalization, before.materials[0].candidates[0].normalization);
  assert.deepEqual(historical, before);
});

test('all six scoring layers reject an entire formula borrowing the anchor of its base operand', () => {
  const expression = '四万元的2倍', text = sourceText(expression);
  const row = score(text, [entry(expression, text)], [{ candidate: entry('四万元', text), anchor: '四万元' }]);
  allCounts(row, [0, 1, 1]);
});

test('all six scoring layers reject a cropped operand borrowing the complete formula event', () => {
  const expression = '四万元的2倍', text = sourceText(expression);
  const row = score(text, [entry('四万元', '四万元')], [{ candidate: entry(expression, text), anchor: expression }]);
  allCounts(row, [0, 1, 1]);
  assert.equal(row.production_defense[0].amount, null);
  assert.equal(row.production_defense[0].calculation_authorized, false);
});

test('literal formula extraction can score correctly while providing no derived money amount', () => {
  const expression = '四万元的2倍', text = sourceText(expression), candidate = entry(expression, text);
  const row = score(text, [candidate], [{ candidate, anchor: expression }]);
  allCounts(row, [1, 0, 0]);
  assert.equal(row.production_defense[0].amount, null);
  assert.equal(row.production_defense[0].calculation_authorized, false);
});

test('a formula operand cannot take credit from a different uniquely quoted exact-payment event', () => {
  const first = '王甲2024年7月按四万元的2倍计算工资', second = '王甲2024年8月已收到工资四万元';
  const text = first + '。' + second + '。';
  const candidate = entry('四万元', first, { meaning: 'payment', completeness: 'partial', period: '2024年8月' });
  const gold = entry('四万元', second, { meaning: 'payment', completeness: 'partial', period: '2024年8月' });
  const row = score(text, [candidate], [{ candidate: gold, anchor: '四万元', at: text.lastIndexOf('四万元') }]);
  allCounts(row, [0, 1, 1]);
});

const continuedExpressions = ['四万元的\n2倍', '四万元\n的2倍', '四万元×\n2', '四万元\u2028×2', '四万元的\u20292倍'];
for (const expression of continuedExpressions) test('explicit arithmetic continuation remains unavailable after quote cropping: ' + JSON.stringify(expression), () => {
  const text = sourceText(expression), candidate = entry('四万元', '四万元');
  const state = ingested(sourceFor(text), [candidate]), stored = state.materials[0].candidates[0];
  evidence('explicit-line-continuation', { expression, amount: stored?.amount, normalization: stored?.normalization });
  assert.equal(stored.amount, null);
  assert.notEqual(stored.normalization.status, 'exact');
  assert.deepEqual(stored.representation, candidate);
});

for (const suffix of ['的2倍', '×\n2']) test('explicit arithmetic in the next OCR block is not lost: ' + JSON.stringify(suffix), () => {
  const source = sourceFor('😀王甲2024年7月完整应付工资为四万元');
  source.blocks.push({ id: 'b2', page: 1, text: suffix, bbox: null, confidence: null });
  const candidate = entry('四万元', '四万元'), stored = ingested(source, [candidate]).materials[0].candidates[0];
  assert.equal(stored.amount, null);
  assert.notEqual(stored.normalization.status, 'exact');
  assert.deepEqual(stored.representation, candidate);
});
test('an explicit prefixed multiplier in the previous OCR block cannot be cropped', () => {
  const source = sourceFor('😀王甲2024年7月完整应付工资为2倍的');
  source.blocks.push({ id: 'b2', page: 1, text: '四万元', bbox: null, confidence: null });
  const candidate = entry('四万元', '四万元', { blockId: 'b2' }), stored = ingested(source, [candidate]).materials[0].candidates[0];
  assert.equal(stored.amount, null);
  assert.notEqual(stored.normalization.status, 'exact');
  assert.deepEqual(stored.representation, candidate);
});

const positives = [
  { name: 'a plain literal total', text: sourceText('四万元'), value: '四万元', amount: '40000.00' },
  { name: 'an independent headcount', text: '王甲等三名员工2024年7月工资共四万元。', value: '四万元', amount: '40000.00', overrides: { scope: 'group' } },
  { name: 'a duration count', text: '王甲2024年7月起三个月的工资共四万元。', value: '四万元', amount: '40000.00' },
  { name: 'a genuine monthly rate', text: '王甲2024年7月工资标准4000元/月。', value: '4000元/月', amount: '4000.00', overrides: { meaning: 'rate', completeness: 'not_applicable', rateUnit: 'month' } },
  { name: 'a genuine piece rate with a small numeric numerator', text: '王甲2024年7月计件工资2元/件。', value: '2元/件', amount: '2.00', overrides: { meaning: 'rate', completeness: 'not_applicable', rateUnit: 'piece' } },
  { name: 'a multiplier in another sentence', text: sourceText('四万元') + '李乙的奖金是基本工资的2倍。', value: '四万元', amount: '40000.00' },
  { name: 'a multiplier after an explicit line boundary', text: sourceText('四万元') + '\n另项奖金按2倍计。', value: '四万元', amount: '40000.00' },
  { name: 'the same amount in a later independent arithmetic event', text: sourceText('四万元') + '李乙2024年8月奖金为四万元的2倍。', quote: sourceText('四万元'), value: '四万元', amount: '40000.00' },
  { name: 'the same amount in an earlier independent arithmetic event', text: '李乙2024年8月奖金为四万元的2倍。' + sourceText('四万元'), quote: sourceText('四万元'), value: '四万元', amount: '40000.00' },
  { name: 'a bare multiplier after a line boundary without an explicit continuation', text: '😀王甲2024年7月完整应付工资为四万元\n2倍工资另行讨论。', quote: '四万元', value: '四万元', amount: '40000.00' },
];
for (const example of positives) test('arithmetic guard preserves ' + example.name, () => {
  const source = sourceFor(example.text), candidate = entry(example.value, example.quote ?? example.text, example.overrides);
  const normalization = normalizeCandidateValueV4(candidate), state = ingested(source, [candidate]);
  assert.equal(normalization.amount, example.amount, 'Quote-aware guard leaked across an unrelated expression.');
  assert.equal(state.materials[0].candidates.length, 1);
  assert.equal(state.materials[0].candidates[0].amount, example.amount, 'Full-source guard rejected a legitimate literal.');
  assert.deepEqual(state.materials[0].candidates[0].representation, candidate);
  assert.equal(buildFactView(state, [source]).canCalculate, false);
});
