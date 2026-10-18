import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Synthetic, nonimplementer integration checks. No model, service or frozen case.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const at = path => import(pathToFileURL(resolve(ROOT, path)));
const { normalizeMoneyValueV4, normalizeCandidateValueV4, canonicalMonetaryExpression } = await at('lib/material-money-v4.ts');
const { ingestRuntimeCandidates } = await at('lib/material-fact-runtime-ingest.ts');
const { reviewFactsAgainstSources } = await at('lib/material-fact-source-review.ts');
const { emptyFactState, ingestCandidates: ingestHistorical, buildFactView } = await at('lib/material-facts-v3.ts');
const { assessCase } = await at('experiments/material-facts-v7/assess.mjs');
const cp = text => Array.from(text).length;
const WHEN = '2026-10-18T15:00:00.000Z';
const sourceFor = text => ({ id: 'round11-independent-source', name: 'synthetic-money-boundaries.txt',
  sha256: 'd'.repeat(64), analysisRevision: 11, ready: true,
  blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] });
const entry = (value, quote, changes = {}) => ({ kind: 'money', value, quote, blockId: 'b1',
  subject: '王甲', scope: 'individual', meaning: 'due_total', completeness: 'complete',
  period: null, rateUnit: null, assertion: 'narrated', ...changes });
const output = candidates => JSON.stringify({ schemaVersion: 3, candidates });
function ingest(source, candidates, historical = false) {
  const raw = output(candidates);
  const state = (historical ? ingestHistorical : ingestRuntimeCandidates)(emptyFactState(11), source,
    { raw }, 'independent-round11', 'synthetic-owner', WHEN, null);
  assert.equal(state.materials[0].raw, raw);
  assert.deepEqual(JSON.parse(raw).candidates, candidates);
  assert.deepEqual(state.confirmations, { due: null, paid: null });
  assert.equal(state.calculation, null);
  assert.equal(buildFactView(state, [source]).canCalculate, false);
  return state;
}
function stored(source, candidate, state, amount) {
  assert.equal(state.materials[0].candidates.length, 1, 'Complex money remains reviewable.');
  const fact = state.materials[0].candidates[0];
  assert.equal(fact.amount, amount);
  assert.deepEqual(fact.representation, candidate);
  const block = source.blocks.find(block => block.id === candidate.blockId);
  const index = block.text.indexOf(candidate.quote);
  assert(index >= 0);
  assert.equal(fact.start, cp(block.text.slice(0, index)));
  assert.equal(fact.end, fact.start + cp(candidate.quote));
  return fact;
}
function unavailableInSource(text, value, changes = {}) {
  const source = sourceFor(text);
  for (const quote of [text, value]) {
    const candidate = entry(value, quote, changes);
    if (quote === text) assert.equal(normalizeCandidateValueV4(candidate).amount, null, 'Full quote cannot hide the modifier.');
    stored(source, candidate, ingest(source, [candidate]), null);
    const old = ingest(source, [candidate], true), prior = old.materials[0].candidates[0];
    prior.amount = normalizeMoneyValueV4(value).amount ?? '40000.00';
    prior.normalization = { rawValue: value, status: 'exact', amount: prior.amount, matchedText: value,
      span: { start: 0, end: cp(value) }, reason: 'Synthetic pre-fix exact history.' };
    const before = structuredClone(old), reviewed = reviewFactsAgainstSources(old, [source]);
    stored(source, candidate, reviewed, null);
    assert.deepEqual(old, before, 'Read-time review does not rewrite stored evidence.');
    assert.equal(reviewed.materials[0].raw, before.materials[0].raw);
  }
}
function allScores(text, candidate, expected, anchor, counts) {
  const input = { id: 'round11-score', source: sourceFor(text) }, start = text.indexOf(anchor);
  assert(start >= 0);
  const label = { id: input.id, schemaVersion: 3, label_status: 'provisional_non_expert',
    expected: [expected], events: [{ id: 'e1', anchors: [{ blockId: 'b1', start: cp(text.slice(0, start)),
      end: cp(text.slice(0, start + anchor.length)) }] }], expected_event_ids: ['e1'], acceptable_alternatives: [] };
  const result = { id: input.id, finish_reason: 'stop', raw_output: output([candidate]) };
  const before = structuredClone({ input, label, result }), row = assessCase(input, label, result);
  for (const scope of ['raw', 'accepted']) for (const layer of ['basic', 'relational', 'strict']) {
    const score = row[scope + '_' + layer];
    assert.deepEqual([score.tp, score.fp, score.fn], counts, scope + '_' + layer);
  }
  assert.deepEqual({ input, label, result }, before);
  assert(row.production_defense.every(item => item.calculation_authorized === false));
  return row;
}
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-source-review.ts', 'lib/material-fact-currency-review.ts',
  'lib/material-fact-arithmetic-review.ts', 'lib/material-fact-runtime-ingest.ts', 'experiments/material-facts-v7/assess.mjs'])
  console.log(JSON.stringify({ evidence: 'implementation_hash', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));

const foreign = [
  '😀王甲工资以港币计四万元。', '😀王甲工资按美元计算四万元。', '😀王甲工资以新台币折算四万元。',
  '😀王甲工资以港幣計四万元。', '😀王甲工资以港幣計算四万元。', '😀王甲工资以港\u200b币 计四万元。',
  '😀王甲工资四万元按港币计算。', '😀王甲工资四万元以美元折算。',
];
for (const text of foreign) test('foreign currency calculation wording remains unavailable after value and quote cropping: ' + text, () => {
  assert.equal(normalizeMoneyValueV4(text).amount, null);
  unavailableInSource(text, '四万元');
});

const namedArithmetic = ['四万元乘以出勤系数', '出勤系数乘以四万元', '四万元工资乘以工资系数',
  '四万元×支付比例', '四万元除以计薪天数', '件数*四万元', '四万元乘\n以出勤系数', '四万元乘以出\u200b勤系数'];
for (const expression of namedArithmetic) test('a named symbolic operand is not its literal money operand: ' + expression, () => {
  const parsed = normalizeMoneyValueV4(expression);
  assert.equal(parsed.amount, null);
  assert.notEqual(parsed.status, 'exact');
  assert.notEqual(canonicalMonetaryExpression(expression), canonicalMonetaryExpression('四万元'));
  unavailableInSource('😀王甲应付工资为' + expression + '。', '四万元');
});
test('a named operand after an explicit operator in the next OCR block cannot be cropped', () => {
  const source = sourceFor('😀王甲应付工资为四万元');
  source.blocks.push({ id: 'b2', page: 1, text: '乘以出勤系数', bbox: null, confidence: null });
  const candidate = entry('四万元', '四万元');
  stored(source, candidate, ingest(source, [candidate]), null);
});

const ranges = [
  ['在3万元和4万元之间', '3万元', '4万元'], ['介于3万元与4万元之间', '3万元', '4万元'],
  ['在三万元和四万元之间', '三万元', '四万元'], ['介于人民币三万元与人民币四万元之间', '三万元', '四万元'],
  ['在3万元及4万元之间', '3万元', '4万元'], ['在3万元和4万元之内', '3万元', '4万元'],
];
for (const [expression, first, second] of ranges) test('neither endpoint of a conjunction range becomes an exact wage: ' + expression, () => {
  const text = '😀王甲的工资' + expression + '。';
  assert.equal(normalizeMoneyValueV4(expression).amount, null);
  for (const value of [first, second]) unavailableInSource(text, value);
});

for (const [value, amount] of [["5元５角", "5.50"], ["５元5角", "5.50"], ['5元5角', '5.50'], ['5元5角2分', '5.52'], ['0元5角', '0.50'], ['12元3分', '12.03'],
  ['1,005元2角3分', '1005.23'], ['人民币5元5角2分整', '5.52'], ['5元0角0分', '5.00']])
  test('a complete yuan/jiao/fen literal has exact cents without an automatic historical upgrade: ' + value, () => {
    const normalized = normalizeMoneyValueV4(value);
    assert.equal(normalized.amount, amount);
    assert.equal(normalized.status, 'exact');
    assert.equal(normalized.rawValue, value);
    const text = '😀王甲工资为' + value + '。', source = sourceFor(text);
    for (const quote of [text, value]) {
      const candidate = entry(value, quote);
      assert.equal(normalizeCandidateValueV4(candidate).amount, amount);
      stored(source, candidate, ingest(source, [candidate]), amount);
      const old = ingest(source, [candidate], true), prior = old.materials[0].candidates[0];
      prior.amount = null;
      prior.normalization = { rawValue: value, status: 'unsupported', amount: null, matchedText: null,
        span: null, reason: 'Synthetic previously unsupported money.' };
      const before = structuredClone(old);
      stored(source, candidate, reviewFactsAgainstSources(old, [source]), null);
      assert.deepEqual(old, before);
    }
  });

for (const expression of ['5元5角2分', '5元５角２分', '5.5元5角', '5万元5角', '5元五角'])
  test('cropping an adjacent subunit never returns the yuan-only amount: ' + expression, () => {
    const value = expression.startsWith('5.5') ? '5.5元' : expression.startsWith('5万') ? '5万元' : '5元';
    unavailableInSource('😀王甲工资为' + expression + '。', value);
  });
for (const value of ['5.5元5角', '5万元5角'])
  test('unsupported mixed, scaled, decimal or fullwidth subunits do not become precise fragments: ' + value, () => {
    assert.equal(normalizeMoneyValueV4(value).amount, null);
    const text = '😀王甲工资为' + value + '。', candidate = entry(value, value), source = sourceFor(text);
    stored(source, candidate, ingest(source, [candidate]), null);
  });

test('complete Arabic yuan with Chinese jiao is supported after round13', () => {
  const value = '5元五角', text = '😀王甲工资为' + value + '。';
  assert.equal(normalizeMoneyValueV4(value).amount, '5.50');
  const source = sourceFor(text), candidate = entry(value, value);
  stored(source, candidate, ingest(source, [candidate]), '5.50');
});

const positives = [
  ['an ordinary RMB total', '😀王甲工资人民币四万元。', '四万元', '四万元'],
  ['a separate foreign event with the same amount', '李乙工资以港币计四万元。😀王甲工资人民币四万元。', '四万元', '😀王甲工资人民币四万元。'],
  ['a coefficient in separate prose', '😀王甲工资四万元，出勤系数另行核对。', '四万元', '四万元'],
  ['an independent headcount', '😀王甲等三名员工工资共四万元。', '四万元', '四万元', { scope: 'group' }],
  ['a conversion explicitly stating the RMB result', '王甲工资先以美元计，折算人民币四万元。', '四万元', '四万元'],
];
for (const [name, text, value, quote, changes] of positives) test('finite guards preserve ' + name, () => {
  const candidate = entry(value, quote, changes), source = sourceFor(text);
  assert.equal(normalizeCandidateValueV4(candidate).amount, '40000.00');
  stored(source, candidate, ingest(source, [candidate]), '40000.00');
});
test('an actual monthly rate still has its stated amount', () => {
  const text = '😀王甲工资标准4000元/月。', candidate = entry('4000元/月', text,
    { meaning: 'rate', completeness: 'not_applicable', rateUnit: 'month' }), source = sourceFor(text);
  stored(source, candidate, ingest(source, [candidate]), '4000.00');
});
test('two separately enumerated payments joined by 和 are not a range', () => {
  const source = sourceFor('😀王甲分别收到工资3万元和4万元。');
  const candidates = ['3万元', '4万元'].map(value => entry(value, value, { meaning: 'payment', completeness: 'partial' }));
  const state = ingest(source, candidates);
  assert.deepEqual(state.materials[0].candidates.map(candidate => candidate.amount), ['30000.00', '40000.00']);
  assert.deepEqual(state.materials[0].candidates.map(candidate => candidate.representation), candidates);
});
test('a whole named formula cannot borrow its operand event in any scoring layer', () => {
  const expression = '四万元乘以出勤系数', text = '😀王甲工资为' + expression + '。';
  allScores(text, entry(expression, text), entry('四万元', text), '四万元', [0, 1, 1]);
});
test('a cropped range endpoint cannot borrow a whole range event in any scoring layer', () => {
  const expression = '3万元和4万元之间', text = '😀王甲工资在' + expression + '。';
  allScores(text, entry('3万元', '3万元'), entry(expression, text), expression, [0, 1, 1]);
});
test('a whole ASCII subunit literal has the Chinese-equivalent key and scores its own source event', () => {
  const text = '😀王甲工资为5元5角2分。', candidate = entry('5元5角2分', text);
  assert.equal(canonicalMonetaryExpression('5元5角2分'), canonicalMonetaryExpression('五元五角二分'));
  const row = allScores(text, candidate, candidate, '5元5角2分', [1, 0, 0]);
  assert.equal(row.production_defense[0].amount, '5.52');
});

// ROUND30 adds complete fullwidth numerals; all malformed/cropped cases retain their assertions.
