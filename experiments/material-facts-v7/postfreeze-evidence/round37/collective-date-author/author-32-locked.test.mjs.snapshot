// R37 event-only synthetic regression. No scorer, HTTP, model or historical CLI.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.MATERIAL_FACT_TEST_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const EVENT = resolve(process.env.MATERIAL_FACT_EVENT_FILE || resolve(ROOT, 'lib/material-fact-event-review.ts'));
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-r37-event-author-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(ROOT, 'lib'), resolve(temporary, 'lib'), { recursive: true });
await cp(EVENT, resolve(temporary, 'lib/material-fact-event-review.ts'));
const load = name => import(pathToFileURL(resolve(temporary, 'lib', name)).href);
const { hasSupportedCandidateAttribution: attribution, hasSupportedTotalRelationship: total } = await load('material-fact-event-review.ts');
const { ingestRuntimeCandidates: fresh } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, buildFactView } = await load('material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('material-fact-source-review.ts');
const cpLength = text => Array.from(text).length;
const AT = '2026-10-19T19:00:00.000Z';
console.log(JSON.stringify({ node: process.version, event_sha256: createHash('sha256').update(await readFile(EVENT)).digest('hex'), dependency_root: ROOT }));

function rawFor(subject, text, full = false, options = {}) {
  return { kind: 'money', value: '4000元', quote: full ? text : '4000元', blockId: 'b1', subject,
    scope: 'individual', meaning: 'due_total', completeness: 'complete', period: '2026年1月',
    rateUnit: null, assertion: 'narrated', ...options };
}
function normalization(raw, amount = '4000.00') {
  return { rawValue: raw.value, status: amount === null ? 'unsupported' : 'exact', amount,
    matchedText: amount === null ? null : raw.value, span: amount === null ? null : { start: 0, end: cpLength(raw.value) }, reason: 'Synthetic stored observation, unconfirmed' };
}
function pure(subject, expected, bridge = '') {
  const text = `😀${subject}${bridge}2026年1月全部应付工资合计4000元`;
  for (const full of [false, true]) {
    const raw = rawFor(subject, text, full), normalized = normalization(raw), before = structuredClone({ raw, normalized, text });
    assert.equal(attribution(raw, text, normalized), expected, 'Individual attribution is not inferred from a surname-shaped label');
    assert.equal(total(raw, text, normalized), expected, 'A complete amount still requires one supported owner');
    assert.deepEqual({ raw, normalized, text }, before);
  }
}
function sourceFor(text) {
  return { id: 'r37-event-author', name: 'synthetic.txt', sha256: '3'.repeat(64), analysisRevision: 37, ready: true,
    blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
}
function eligible(state, source, subject) {
  // Synthetic existing scope review solely exposes the field eligibility gate.
  // No confirmation is created, and no calculation is requested.
  const copy = structuredClone(state);
  copy.scope = { worker: subject, employer: '甲公司', start: '2026-01-01', end: '2026-01-31' };
  copy.scopeReview = { note: 'Synthetic pre-existing scope only', actor: 'fixture', at: AT };
  const view = buildFactView(copy, [source]);
  assert.equal(view.canCalculate, false);
  assert.deepEqual(copy.confirmations, { due: null, paid: null });
  return view.fields.due.values;
}
function runtime(subject, expected, bridge = '') {
  const text = `😀${subject}${bridge}2026年1月全部应付工资合计4000元。`, source = sourceFor(text);
  for (const full of [false, true]) {
    const representation = rawFor(subject, text, full), raw = JSON.stringify({ schemaVersion: 3, candidates: [representation] });
    const current = fresh(emptyFactState(37), source, { raw }, 'synthetic', 'fixture', AT);
    assert.equal(current.materials[0].candidates.length, 1, 'Original candidate is retained, not silently removed');
    const historical = legacy(emptyFactState(37), source, { raw }, 'synthetic', 'fixture', AT);
    Object.assign(historical.materials[0].candidates[0], { amount: '4000.00', normalization: normalization(representation) });
    const before = structuredClone({ historical, source });
    const reviewed = reviewFactsAgainstSources(historical, [source]);
    for (const state of [current, reviewed]) {
      const item = state.materials[0].candidates[0];
      assert.equal(item.amount, '4000.00', 'Literal precision and supported ownership are separate evidence');
      assert.equal(item.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), !expected);
      assert.deepEqual(item.representation, representation);
      const start = cpLength(text.slice(0, text.indexOf(representation.quote)));
      assert.equal(item.start, start); assert.equal(item.end, start + cpLength(representation.quote));
      assert.equal(Array.from(text).slice(item.start, item.end).join(''), representation.quote);
      assert.equal(state.materials[0].raw, raw); assert.equal(state.calculation, null);
      assert.deepEqual(eligible(state, source, subject), expected ? ['4000.00'] : [], 'No usable due-total suggestion for a collective/ambiguous owner');
    }
    assert.deepEqual({ historical, source }, before, 'Read-time review never rewrites original storage');
    historical.materials[0].candidates[0].amount = null;
    historical.materials[0].candidates[0].normalization = normalization(representation, null);
    const oldNull = reviewFactsAgainstSources(historical, [source]);
    assert.equal(oldNull.materials[0].candidates[0].amount, null, 'No upgrade of an older unavailable amount');
    assert.deepEqual(eligible(oldNull, source, subject), []);
  }
}

for (const subject of ['王和欧', '王与平', '王與平', '王及欧', '王和平', '李与诚', '张及春', '甲和乙', '王甲及李乙'])
  test(`nonempty coordinator fragments stay unresolved: ${subject}`, () => pure(subject, false));
for (const subject of ['王甲', '何和', '周及', '王等明'])
  test(`existing bounded single-owner control: ${subject}`, () => pure(subject, true));
test('a model label plus 本人 does not prove that two fragments are one worker', () => pure('王和欧', false, '本人'));
test('ordinary explicit 本人 remains supported without changing a label', () => pure('王甲', true, '本人'));
for (const subject of ['王和欧', '王与平', '王和平'])
  test(`actual fresh/history field cannot suggest collective amount: ${subject}`, () => runtime(subject, false));
for (const subject of ['王甲', '何和', '周及'])
  test(`actual fresh/history individual field control: ${subject}`, () => runtime(subject, true));

function dateCheck(text, expected, options = {}) {
  const value = '2026年1月';
  for (const full of [false, true]) {
    const raw = rawFor('王甲', text, full, { kind: 'date', value, quote: full ? text : value,
      meaning: 'employment_period', completeness: 'not_applicable', period: null, ...options });
    const normalized = normalization(raw, null), before = structuredClone({ raw, normalized });
    assert.equal(attribution(raw, text, normalized), expected);
    assert.equal(total(raw, text, normalized), false);
    assert.deepEqual({ raw, normalized }, before);
  }
}
for (const verb of ['辞职', '辭職', '辭职', '辞職'])
  test(`finite resignation glyph equivalence: ${verb}`, () => dateCheck(`😀王甲於2026年1月${verb}`, true));
for (const [text, options] of [
  ['😀王甲於2026年1月未辭職', {}], ['😀王甲於2026年1月不曾辭職', {}],
  ['😀王乙於2026年1月辭職', {}], ['😀王甲於2026年1月王乙辭職', {}],
  ['😀王甲於2026年1月辭職', { meaning: 'payment_date' }],
  ['😀王和欧於2026年1月辭職', { subject: '王和欧' }],
]) test(`resignation cannot borrow a person, polarity or role: ${text} ${JSON.stringify(options)}`, () => dateCheck(text, false, options));
test('actual fresh/history resignation preserves the raw date and CP', () => {
  for (const full of [false, true]) {
    const text = '😀王甲於2026年1月辭職。', value = '2026年1月', source = sourceFor(text);
    const item = rawFor('王甲', text, full, { kind: 'date', value, quote: full ? text : value,
      meaning: 'employment_period', completeness: 'not_applicable', period: null });
    const raw = JSON.stringify({ schemaVersion: 3, candidates: [item] });
    for (const state of [fresh(emptyFactState(37), source, { raw }, 'synthetic', 'fixture', AT),
      reviewFactsAgainstSources(legacy(emptyFactState(37), source, { raw }, 'synthetic', 'fixture', AT), [source])]) {
      const found = state.materials[0].candidates[0];
      assert.equal(found.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), false);
      assert.equal(found.amount, null); assert.deepEqual(found.representation, item); assert.equal(state.materials[0].raw, raw);
      assert.equal(Array.from(text).slice(found.start, found.end).join(''), item.quote);
      assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
    }
  }
});
