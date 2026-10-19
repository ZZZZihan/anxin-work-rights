import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ROUND36 independent synthetic tests. They import modules only: no model,
// HTTP server, build, historical verification CLI or experiment write/check.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(ROOT, path)));
const { normalizeMoneyValueV4: money, canonicalMonetaryExpression: canonical } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates: fresh } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, validateCandidateOutput, buildFactView } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
// This is the exported synthetic scoring function, not a scorer CLI or real data.
const { assessCase } = await load('experiments/material-facts-v7/assess.mjs');
const cp = text => Array.from(text).length;
const rawFor = candidates => JSON.stringify({ schemaVersion: 3, candidates });
const sourceFor = (texts, pages) => ({ id: 'round36-independent', name: 'synthetic.txt', sha256: '6'.repeat(64), ready: true, analysisRevision: 36,
  blocks: (Array.isArray(texts) ? texts : [texts]).map((text, index) => ({ id: 'b' + (index + 1), page: pages?.[index] ?? 1,
    text, bbox: null, confidence: null })) });
const entry = (value, quote = value, extra = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual',
  meaning: 'other_money', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated', ...extra });
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-range-review.ts', 'lib/material-fact-source-review.ts',
  'lib/material-fact-event-review.ts', 'experiments/material-facts-v7/assess.mjs'])
  console.log(JSON.stringify({ evidence: 'round36_implementation', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));

function factFor(source, candidate, state) {
  assert.equal(state.materials[0].candidates.length, 1, 'An accepted review candidate is distinct from a usable amount.');
  const fact = state.materials[0].candidates[0], text = source.blocks.find(block => block.id === candidate.blockId).text;
  const at = text.indexOf(candidate.quote);
  assert(at >= 0); assert.equal(text.indexOf(candidate.quote, at + 1), -1);
  assert.deepEqual(fact.representation, candidate);
  assert.equal(fact.start, cp(text.slice(0, at))); assert.equal(fact.end, fact.start + cp(candidate.quote));
  assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
  assert.equal(buildFactView(state, [source]).canCalculate, false);
  return fact;
}
function stateFor(source, candidate, historical = false) {
  const raw = rawFor([candidate]);
  assert.equal(validateCandidateOutput(raw, source).rejected.length, 0, 'The fixture must pass the real input schema.');
  const before = structuredClone(source), state = (historical ? legacy : fresh)(emptyFactState(36), source, { raw },
    'independent', 'synthetic', '2026-10-19T00:00:00.000Z', null);
  assert.deepEqual(source, before); assert.equal(state.materials[0].raw, raw);
  return state;
}
function oldReview(source, candidate, amount) {
  const state = stateFor(source, candidate, true), fact = factFor(source, candidate, state);
  fact.amount = amount;
  fact.normalization = { rawValue: candidate.value, status: amount === null ? 'unsupported' : 'exact', amount,
    matchedText: candidate.value, span: { start: 0, end: cp(candidate.value) }, reason: 'Unconfirmed synthetic stored candidate.' };
  const before = structuredClone(state), reviewed = reviewFactsAgainstSources(state, [source]);
  assert.deepEqual(state, before, 'Read-time review cannot rewrite the supplied stored state.');
  assert.equal(reviewed.materials[0].raw, rawFor([candidate]));
  return factFor(source, candidate, reviewed);
}
function observe(source, candidate) {
  const rows = { fresh: factFor(source, candidate, stateFor(source, candidate)), oldExact: oldReview(source, candidate, '4000.00'),
    oldUnavailable: oldReview(source, candidate, null) };
  console.log(JSON.stringify({ evidence: 'round36_observation', source, candidate, ...rows }));
  return rows;
}
function check(source, candidate, amount) {
  const rows = observe(source, candidate);
  assert.equal(rows.fresh.amount, amount); assert.equal(rows.oldExact.amount, amount);
  assert.equal(rows.oldUnavailable.amount, null, 'Historical unavailable amounts are never automatically upgraded.');
  return rows;
}
function quotes(source, value, extra = {}) {
  const block = source.blocks.find(row => row.id === (extra.blockId ?? 'b1'));
  return [...new Set([value, block.text])].map(quote => entry(value, quote, extra));
}

for (const suffix of ['及以上', '或以下']) test('a conjunction-linked bound stays non-exact in full value and both quote crops: ' + suffix, () => {
  const value = '4000元' + suffix, source = sourceFor('😀王甲工资' + value + '。');
  const normalized = money(value); console.log(JSON.stringify({ evidence: 'round36_literal_bound', value, normalized }));
  assert.equal(normalized.amount, null); assert.equal(normalized.status, 'approximate');
  for (const literal of [value, '4000元']) for (const candidate of quotes(source, literal)) check(source, candidate, null);
  assert.notEqual(canonical(value), canonical('4000元'));
  assert.equal(canonical(value), canonical('四千元' + suffix), 'Only equivalent number spellings share the qualified key.');
});
for (const suffix of ['及以上', '或以下']) test('same-page directly adjacent bound fragments remain unavailable: ' + suffix, () => {
  const source = sourceFor(['😀王甲工资4000元', suffix + '。']);
  for (const candidate of quotes(source, '4000元')) check(source, candidate, null);
});
test('a different page does not attach a conjunction bound to the first-page payment', () => {
  for (const suffix of ['及以上', '或以下']) {
    const source = sourceFor(['😀王甲收到工资4000元', suffix + '材料属于李乙。'], [1, 2]);
    for (const candidate of quotes(source, '4000元')) check(source, candidate, '4000.00');
  }
});

for (const unit of ['每个月', '/个月', '每個月']) test('a complete classifier-bearing monthly denominator supports a declared monthly rate: ' + unit, () => {
  const value = '4000元' + unit, source = sourceFor('😀王甲工资' + value + '。');
  for (const literal of [value, '4000元']) for (const candidate of quotes(source, literal, { meaning: 'rate', rateUnit: 'month' }))
    check(source, candidate, '4000.00');
  // Event/subject relation warnings are deliberately not declared solved here.
});
for (const unit of ['每个月', '/个月', '每個月']) test('a monthly denominator cannot become a total or an hourly rate: ' + unit, () => {
  const source = sourceFor('😀王甲工资4000元' + unit + '。');
  for (const role of [{ meaning: 'other_money', rateUnit: null }, { meaning: 'rate', rateUnit: 'hour' }])
    for (const candidate of quotes(source, '4000元', role)) check(source, candidate, null);
});
test('an explicit slash joins same-page OCR denominator fragments without granting a total', () => {
  for (const unit of ['个月', '個月']) {
    const source = sourceFor(['😀王甲工资4000元/', unit + '。']);
    check(source, entry('4000元', '4000元', { meaning: 'rate', rateUnit: 'month' }), '4000.00');
    check(source, entry('4000元'), null);
  }
});
test('a monthly denominator on a separate page cannot suppress an independent amount', () => {
  const source = sourceFor(['😀王甲收到工资4000元', '/个月为李乙的计价单位。'], [1, 2]);
  for (const candidate of quotes(source, '4000元')) check(source, candidate, '4000.00');
});

for (const prose of ['及以下内容无争议', '及以上海为工作地点']) test('a supported ordinary continuation is not a money bound: ' + prose, () => {
  const source = sourceFor('😀王甲收到工资4000元' + prose + '。');
  assert.equal(money('4000元' + prose).amount, '4000.00');
  for (const candidate of quotes(source, '4000元')) check(source, candidate, '4000.00');
});
test('a complete longer classifier word cannot borrow a monthly unit prefix', () => {
  for (const unit of ['每个月亮', '/个月份', '每個月份']) {
    const source = sourceFor('😀王甲工资4000元' + unit + '。');
    for (const candidate of quotes(source, '4000元', { meaning: 'rate', rateUnit: 'month' })) check(source, candidate, null);
  }
});
test('existing plain monthly units keep rate versus total distinctions', () => {
  for (const unit of ['每月', '/月']) {
    const source = sourceFor('😀王甲工资4000元' + unit + '。');
    check(source, entry('4000元', source.blocks[0].text, { meaning: 'rate', rateUnit: 'month' }), '4000.00');
    check(source, entry('4000元', source.blocks[0].text), null);
  }
});
test('a bound or denominator in another sentence cannot modify an independent payment', () => {
  for (const prose of ['李乙另按4000元每个月计价。', '李乙工资4000元及以上。']) {
    const source = sourceFor('😀王甲收到工资4000元。' + prose);
    check(source, entry('4000元', '王甲收到工资4000元'), '4000.00');
  }
});

function anchor(source, blockId, value) {
  const text = source.blocks.find(block => block.id === blockId).text, at = text.indexOf(value);
  assert(at >= 0); return { blockId, start: cp(text.slice(0, at)), end: cp(text.slice(0, at)) + cp(value) };
}
function six(row, expected) {
  console.log(JSON.stringify({ evidence: 'round36_six_layers', row }));
  for (const scope of ['raw', 'accepted']) for (const mode of ['basic', 'relational', 'strict']) {
    const score = row[scope + '_' + mode]; assert.deepEqual([score.tp, score.fp, score.fn], expected);
  }
  assert(row.production_defense.every(candidate => candidate.calculation_authorized === false));
}
test('all six layers distinguish an exact numeric crop from the bound even when event alignment is deliberately held constant', () => {
  for (const suffix of ['及以上', '或以下']) {
    const value = '4000元' + suffix, source = sourceFor('😀王甲工资' + value + '。');
    const expected = entry(value), observed = entry('4000元');
    // Synthetic anchors deliberately register both nested fragments to one event
    // so the comparison-key distinction, rather than a failed anchor, is tested.
    const label = { expected: [expected], expected_event_ids: ['bound'], events: [{ id: 'bound',
      anchors: [anchor(source, 'b1', value), anchor(source, 'b1', '4000元')] }] };
    const row = assessCase({ id: 'r36-bound-key', source }, label, { raw_output: rawFor([observed]), finish_reason: 'stop' });
    assert(row.event_alignment.raw.every(event => event.event === 'bound'));
    assert(row.event_alignment.accepted.every(event => event.event === 'bound'));
    six(row, [0, 1, 1]);
  }
  assert.notEqual(canonical('4000元及以上'), canonical('4000元或以下'), 'Upper and lower bounds must not share a comparison key.');
});
test('all six layers reject borrowing an equal numeric amount from another occurrence/event', () => {
  const source = sourceFor(['😀王甲工资4000元及以上。', '王甲另收到4000元。']);
  const expected = entry('4000元', '4000元', { blockId: 'b2' }), observed = entry('4000元');
  const label = { expected: [expected], expected_event_ids: ['paid'], events: [
    { id: 'bound', anchors: [anchor(source, 'b1', '4000元')] }, { id: 'paid', anchors: [anchor(source, 'b2', '4000元')] }] };
  six(assessCase({ id: 'r36-no-cross-event', source }, label, { raw_output: rawFor([observed]), finish_reason: 'stop' }), [0, 1, 1]);
});
