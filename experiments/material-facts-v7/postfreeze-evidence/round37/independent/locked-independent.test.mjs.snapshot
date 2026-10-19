import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Append-only ROUND37 independent finite acceptance fixtures, locked before implementation.
// Independent synthetic module/runtime checks, not HTTP, human acceptance,
// a scorer CLI, model inference, a build or a historical verification chain.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(ROOT, path)));
const { normalizeMoneyValueV4: money } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates: fresh } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, applyFactAction, ingestCandidates: legacy, validateCandidateOutput, buildFactView } = await load('lib/material-facts-v3.ts');
const { assessCase, resolveCandidateEvent } = await load('experiments/material-facts-v7/assess.mjs');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const cp = text => Array.from(text).length;
const rawFor = candidate => JSON.stringify({ schemaVersion: 3, candidates: [candidate] });
const sourceFor = (texts, pages) => ({ id: 'round37-independent', name: 'synthetic.txt', sha256: 'c'.repeat(64), ready: true, analysisRevision: 37,
  blocks: (Array.isArray(texts) ? texts : [texts]).map((text, index) => ({ id: 'b' + (index + 1), page: pages?.[index] ?? 1,
    text, bbox: null, confidence: null })) });
const entry = (value, quote = value, extra = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual',
  meaning: 'other_money', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated', ...extra });
const date = (value, quote = value, extra = {}) => entry(value, quote, { kind: 'date', meaning: 'payment_date', ...extra });
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-source-review.ts', 'lib/material-fact-event-review.ts', 'lib/material-fact-arithmetic-review.ts', 'experiments/material-facts-v7/assess.mjs'])
  console.log(JSON.stringify({ evidence: 'round37_independent_implementation', path,
    sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));
function factFor(source, candidate, state) {
  assert.equal(state.materials[0].candidates.length, 1);
  const fact = state.materials[0].candidates[0], text = source.blocks.find(block => block.id === candidate.blockId).text;
  const at = text.indexOf(candidate.quote); assert(at >= 0); assert.equal(text.indexOf(candidate.quote, at + 1), -1);
  assert.deepEqual(fact.representation, candidate);
  assert.equal(fact.start, cp(text.slice(0, at))); assert.equal(fact.end, fact.start + cp(candidate.quote));
  assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
  assert.equal(buildFactView(state, [source]).canCalculate, false);
  return fact;
}
function stateFor(source, candidate, old = false) {
  assert.equal(validateCandidateOutput(rawFor(candidate), source).rejected.length, 0, 'A semantic fixture must first pass the actual schema.');
  const before = structuredClone(source), state = (old ? legacy : fresh)(emptyFactState(37), source, { raw: rawFor(candidate) },
    'independent', 'synthetic', '2026-10-19T00:00:00.000Z', null);
  assert.deepEqual(source, before); assert.equal(state.materials[0].raw, rawFor(candidate)); return state;
}
function reviewedOld(source, candidate, amount) {
  const state = stateFor(source, candidate, true), fact = factFor(source, candidate, state);
  if (candidate.kind === 'money') {
    fact.amount = amount;
    fact.normalization = { rawValue: candidate.value, status: amount === null ? 'unsupported' : 'exact', amount,
      matchedText: candidate.value, span: { start: 0, end: cp(candidate.value) }, reason: 'Synthetic unconfirmed stored candidate.' };
  }
  const before = structuredClone(state), reviewed = reviewFactsAgainstSources(state, [source]);
  assert.deepEqual(state, before); assert.equal(reviewed.materials[0].raw, rawFor(candidate));
  return factFor(source, candidate, reviewed);
}
function observation(source, candidate) {
  const rows = { fresh: factFor(source, candidate, stateFor(source, candidate)), oldExact: reviewedOld(source, candidate, '4000.00'),
    oldUnavailable: reviewedOld(source, candidate, null) };
  console.log(JSON.stringify({ evidence: 'round37_independent_observation', source, candidate, ...rows })); return rows;
}
function checkAmount(source, candidate, amount) {
  const rows = observation(source, candidate);
  assert.equal(rows.fresh.amount, amount); assert.equal(rows.oldExact.amount, amount);
  assert.equal(rows.oldUnavailable.amount, null, 'Historical null is not upgraded by read-time review.'); return rows;
}
const relation = fact => fact.reviewIssues.some(issue => issue.code === 'source_relation_unresolved');
function checkRelation(source, candidate, supported) {
  const rows = observation(source, candidate);
  for (const fact of [rows.fresh, rows.oldExact]) assert.equal(relation(fact), !supported);
  if (candidate.kind === 'money') {
    assert.equal(rows.fresh.amount, '4000.00'); assert.equal(rows.oldUnavailable.amount, null);
  }
}
function variants(source, value, extra = {}, kind = 'money') {
  const block = source.blocks.find(row => row.id === (extra.blockId ?? 'b1'));
  return [...new Set([value, block.text])].map(quote => (kind === 'date' ? date : entry)(value, quote, extra));
}

const total = subject => ({ subject, meaning: 'due_total', completeness: 'complete', period: '2026年1月' });
function scopedDue(source, candidate) {
  const state = stateFor(source, candidate);
  const scoped = applyFactAction(state, { action: 'confirm_scope', scope: { worker: candidate.subject,
    employer: '测试单位', start: '2026-01-01', end: '2026-01-31' }, note: 'Synthetic scope review only; no amount confirmation.', verified: true },
  [source], 'independent', '2026-10-19T00:00:00.000Z');
  assert(scoped.scopeReview); assert.deepEqual(scoped.confirmations, { due: null, paid: null }); assert.equal(scoped.calculation, null);
  const view = buildFactView(scoped, [source]); assert.equal(view.canCalculate, false);
  console.log(JSON.stringify({ evidence: 'round37_scope_reviewed_due', candidate, view }));
  return view.fields.due.values;
}
for (const subject of ['王和欧', '王与平', '王與平', '王及欧'])
  test('a short internal connector is not evidence of one complete individual total: ' + subject, () => {
    const source = sourceFor('😀' + subject + '2026年1月全部应付工资合计4000元。');
    for (const candidate of variants(source, '4000元', total(subject))) {
      assert.deepEqual(scopedDue(source, candidate), []);
      checkRelation(source, candidate, false);
    }
  });
test('explicit two-person short names stay unresolved as an individual complete total', () => {
  for (const subject of ['甲和乙', '张和李', '王甲和王乙']) {
    const source = sourceFor('😀' + subject + '2026年1月全部应付工资合计4000元。');
    const candidate = entry('4000元', '4000元', total(subject));
    assert.deepEqual(scopedDue(source, candidate), []); checkRelation(source, candidate, false);
  }
});
test('a terminal connector with no second person fragment keeps the finite single-name controls', () => {
  for (const subject of ['何和', '周及', '王甲']) {
    const source = sourceFor('😀' + subject + '2026年1月全部应付工资合计4000元。');
    for (const candidate of variants(source, '4000元', total(subject))) {
      assert.deepEqual(scopedDue(source, candidate), ['4000.00']); checkRelation(source, candidate, true);
    }
  }
});
test('traditional 辭職 retains the already supported simplified resignation-date relation', () => {
  for (const text of ['😀王甲於2026年1月辭職。', '😀王甲于2026年1月辞职。']) {
    const source = sourceFor(text);
    for (const candidate of variants(source, '2026年1月', { meaning: 'employment_period' }, 'date')) checkRelation(source, candidate, true);
  }
});
test('negation, another owner and a different date role cannot borrow a resignation cue', () => {
  for (const text of ['😀王甲未於2026年1月辭職。', '😀李乙於2026年1月辭職。王甲仍在職。'])
    checkRelation(sourceFor(text), date('2026年1月', '2026年1月', { meaning: 'employment_period' }), false);
  checkRelation(sourceFor('😀王甲於2026年1月辭職。'), date('2026年1月'), false);
});
for (const suffix of ['翻倍', '加倍']) test('an attached explicit doubling cue cannot preserve its base amount: ' + suffix, () => {
  assert.equal(money('4000元' + suffix).amount, null, 'A doubling expression does not report its computed result.');
  const source = sourceFor('😀王甲工资4000元' + suffix + '。');
  for (const value of ['4000元', '4000元' + suffix])
    for (const candidate of variants(source, value)) checkAmount(source, candidate, null);
});
test('same-page adjacent OCR doubling fragments remain unavailable in fresh and historical reads', () => {
  for (const suffix of ['翻倍', '加倍']) {
    const source = sourceFor(['😀王甲工资4000元', suffix + '。']);
    checkAmount(source, entry('4000元'), null);
  }
});
test('a different sentence or page cannot lend another worker doubling to an independent amount', () => {
  checkAmount(sourceFor('😀王甲收到工资4000元。王乙工资另加倍。'), entry('4000元'), '4000.00');
  checkAmount(sourceFor(['😀王甲收到工资4000元', '王乙工资加倍。'], [1, 2]), entry('4000元'), '4000.00');
});

const six = ['raw_basic', 'raw_relational', 'raw_strict', 'accepted_basic', 'accepted_relational', 'accepted_strict'];
function anchor(source, blockId, value) {
  const text = source.blocks.find(block => block.id === blockId).text, at = text.indexOf(value);
  assert(at >= 0); assert.equal(text.indexOf(value, at + 1), -1);
  return { blockId, start: cp(text.slice(0, at)), end: cp(text.slice(0, at)) + cp(value) };
}
function score(source, expected, candidate, events, expectedEvent = 'expected') {
  const input = { id: 'round37-synthetic', source }, label = { id: input.id, expected: [expected], events,
    expected_event_ids: [expectedEvent], acceptable_alternatives: [] };
  const before = structuredClone({ source, label, candidate });
  const result = assessCase(input, label, { id: input.id, raw_output: rawFor(candidate), finish_reason: 'stop' });
  assert.deepEqual({ source, label, candidate }, before);
  assert.equal(result.protocol, true); assert.equal(result.raw_count, 1); assert.equal(result.accepted_count, 1);
  assert(result.production_defense.every(row => row.calculation_authorized === false));
  console.log(JSON.stringify({ evidence: 'round37_independent_score', source, label, candidate, result })); return result;
}
function checkSix(result, expected) {
  for (const mode of six) assert.deepEqual([result[mode].tp, result[mode].fp, result[mode].fn], expected, mode);
}
for (const suffix of ['以前', '以后', '之前', '之后', '为止'])
  test('a finite complete date boundary can align with its own calendar anchor: ' + suffix, () => {
    const value = '2026年1月' + suffix, source = sourceFor('😀王甲于' + value + '入职。');
    const expected = date(value, value, { meaning: 'employment_period' });
    const events = [{ id: 'expected', anchors: [anchor(source, 'b1', '2026年1月')] }];
    const input = { id: 'round37-synthetic', source }, label = { expected: [expected], events, expected_event_ids: ['expected'] };
    // This is a synthetic containment contract. Original value equality and
    // all occurrence/event constraints still apply; no frozen gold is edited.
    assert.equal(resolveCandidateEvent(expected, input, label).event, 'expected');
    checkSix(score(source, expected, expected, events), [1, 0, 0]);
  });
test('existing single-character date boundary containment remains valid', () => {
  const value = '2026年1月前', source = sourceFor('😀王甲于' + value + '入职。');
  const candidate = date(value, value, { meaning: 'employment_period' });
  checkSix(score(source, candidate, candidate, [{ id: 'expected', anchors: [anchor(source, 'b1', '2026年1月')] }]), [1, 0, 0]);
});
test('cropping a complete date boundary does not become equal to the full date value', () => {
  const value = '2026年1月之前', source = sourceFor('😀王甲于' + value + '入职。');
  const expected = date(value, value, { meaning: 'employment_period' });
  checkSix(score(source, expected, date('2026年1月', '2026年1月', { meaning: 'employment_period' }),
    [{ id: 'expected', anchors: [anchor(source, 'b1', value)] }]), [0, 1, 1]);
});
test('opposite date boundaries preserve literal inequality even in the same declared event', () => {
  const source = sourceFor(['😀王甲2026年1月之前入职。', '王甲2026年1月之后入职。']);
  const expected = date('2026年1月之前', '2026年1月之前', { meaning: 'employment_period' });
  const candidate = date('2026年1月之后', '2026年1月之后', { blockId: 'b2', meaning: 'employment_period' });
  checkSix(score(source, expected, candidate, [{ id: 'expected', anchors: [anchor(source, 'b1', expected.value), anchor(source, 'b2', candidate.value)] }]), [0, 1, 1]);
});
test('the same complete date in another registered event cannot borrow a gold match', () => {
  const value = '2026年1月之前', source = sourceFor(['😀王甲' + value + '入职。', '王甲' + value + '入职。']);
  const expected = date(value, value, { meaning: 'employment_period' });
  checkSix(score(source, expected, { ...expected, blockId: 'b2' }, [
    { id: 'expected', anchors: [anchor(source, 'b1', value)] }, { id: 'other', anchors: [anchor(source, 'b2', value)] }]), [0, 1, 1]);
});
test('a repeated same-block date quote spanning two events stays ambiguous', () => {
  const value = '2026年1月', text = '😀王甲2026年1月入职。王甲2026年1月离职。', source = sourceFor(text);
  const quote = '王甲2026年1月入职', expected = date(value, quote, { meaning: 'employment_period' });
  const first = text.indexOf(value), last = text.lastIndexOf(value);
  const events = [{ id: 'expected', anchors: [{ blockId: 'b1', start: cp(text.slice(0, first)), end: cp(text.slice(0, first)) + cp(value) }] },
    { id: 'other', anchors: [{ blockId: 'b1', start: cp(text.slice(0, last)), end: cp(text.slice(0, last)) + cp(value) }] }];
  const result = score(source, expected, date(value, value, { meaning: 'employment_period' }), events);
  assert.equal(result.event_alignment.raw[0].status, 'ambiguous_event'); checkSix(result, [0, 1, 1]);
});
test('a same-valued independent money event cannot borrow an extraction match from a doubled base', () => {
  const source = sourceFor(['😀王甲工资4000元加倍。', '王甲收到工资4000元。']);
  const expected = entry('4000元', '4000元', { blockId: 'b2', meaning: 'paid_total', completeness: 'unknown' });
  const candidate = { ...expected, blockId: 'b1' };
  checkSix(score(source, expected, candidate, [{ id: 'expected', anchors: [anchor(source, 'b2', '4000元')] },
    { id: 'other', anchors: [anchor(source, 'b1', '4000元')] }]), [0, 1, 1]);
});

