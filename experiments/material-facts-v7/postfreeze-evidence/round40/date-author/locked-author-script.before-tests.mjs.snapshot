// R40 two date envelopes only; no scorer, HTTP, model, or invented calendar year.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.MATERIAL_FACT_TEST_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const EVENT = resolve(process.env.MATERIAL_FACT_EVENT_FILE || resolve(ROOT, 'lib/material-fact-event-review.ts'));
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-r40-date-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(ROOT, 'lib'), resolve(temporary, 'lib'), { recursive: true });
await cp(EVENT, resolve(temporary, 'lib/material-fact-event-review.ts'));
const load = name => import(pathToFileURL(resolve(temporary, 'lib', name)).href);
const { hasSupportedCandidateAttribution: attributed } = await load('material-fact-event-review.ts');
const { normalizeCandidateValue, emptyFactState, ingestCandidates: legacy, validateCandidateOutput, buildFactView } = await load('material-facts-v3.ts');
const { ingestRuntimeCandidates: fresh } = await load('material-fact-runtime-ingest.ts');
const { reviewFactsAgainstSources } = await load('material-fact-source-review.ts');
const cpLength = text => Array.from(text).length;
const AT = '2026-10-19T04:00:00.000Z';
const candidate = (value, quote, options = {}) => ({ kind: 'date', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual',
  meaning: 'payment_date', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated', ...options });
console.log(JSON.stringify({ node: process.version, dependency_root: ROOT, event_sha256: createHash('sha256').update(await readFile(EVENT)).digest('hex') }));

function direct(value, text, expected, options = {}) {
  for (const quote of [value, text]) {
    const raw = candidate(value, quote, options), normalization = normalizeCandidateValue(raw).normalization;
    const before = structuredClone({ raw, normalization, text });
    const actual = attributed(raw, text, normalization);
    console.log(JSON.stringify({ evidence: 'r40_date_module', raw, text, expected, actual }));
    assert.equal(actual, expected);
    assert.deepEqual({ raw, normalization, text }, before);
  }
}

function runtime(value, texts, expected, options = {}, pages) {
  const blocks = (Array.isArray(texts) ? texts : [texts]).map((text, i) => ({ id: `b${i + 1}`, text, page: pages?.[i] ?? 1, bbox: null, confidence: null }));
  const source = { id: 'r40-date-author', name: 'synthetic.txt', sha256: '4'.repeat(64), ready: true, analysisRevision: 40, blocks };
  const text = blocks[0].text;
  for (const quote of [value, text]) {
    const entry = candidate(value, quote, options), raw = JSON.stringify({ schemaVersion: 3, candidates: [entry] });
    assert.equal(validateCandidateOutput(raw, source).rejected.length, 0, 'Use the actual valid extraction schema.');
    const stored = legacy(emptyFactState(40), source, { raw }, 'synthetic', 'fixture', AT);
    const before = structuredClone({ source, stored });
    for (const [mode, state] of [['fresh', fresh(emptyFactState(40), source, { raw }, 'synthetic', 'fixture', AT)],
      ['stored-read', reviewFactsAgainstSources(stored, [source])]]) {
      assert.equal(state.materials[0].candidates.length, 1);
      const fact = state.materials[0].candidates[0];
      console.log(JSON.stringify({ evidence: 'r40_date_source_review', mode, entry, source, fact }));
      assert.equal(fact.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), !expected);
      assert.equal(fact.amount, null);
      assert.equal(fact.normalization.rawValue, value, 'No missing year is invented in the retained literal.');
      assert.deepEqual(fact.representation, entry); assert.equal(state.materials[0].raw, raw);
      const start = cpLength(text.slice(0, text.indexOf(quote)));
      assert.equal(fact.start, start); assert.equal(fact.end, start + cpLength(quote));
      assert.equal(Array.from(text).slice(fact.start, fact.end).join(''), quote);
      assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
      const view = buildFactView(state, [source]);
      assert.equal(view.canCalculate, false); assert.deepEqual(view.fields.due.values, []); assert.deepEqual(view.fields.paid.values, []);
    }
    assert.deepEqual({ source, stored }, before);
  }
}

for (const [value, verb, prep] of [['1月15日', '支付', '于'], ['十二月三十一日', '发放', '在'],
  ['二月十五日', '給付', '於'], ['１２月３１日', '付清', '于']])
  test(`yearless point is retained in its complete wage payment envelope: ${value}${verb}`, () => direct(value, `😀王甲工資${prep}${value}${verb}`, true));
test('the existing year-bearing payment envelope stays supported', () => direct('2026年1月15日', '😀王甲工资于2026年1月15日支付', true));
for (const join of ['与', '與', '和', '及']) {
  const value = `2026年1月${join}2月`;
  test(`complete parallel wage-period list: ${join}`, () => direct(value, `😀王甲${value}工资所属期间`, true, { meaning: 'wage_period' }));
}
for (const value of ['13月15日', '0月15日', '1月0日', '1月32日'])
  test(`new yearless envelope refuses an invalid month/day: ${value}`, () => direct(value, `😀王甲工资于${value}支付`, false));
for (const [text, options] of [
  ['😀王甲工资于1月15日未支付', {}], ['😀李乙工资于1月15日支付', {}],
  ['😀王甲工资于1月15日李乙支付', {}], ['😀王甲工资于1月15日支付', { meaning: 'employment_period' }],
  ['😀王甲工资于1月15日支付', { meaning: 'wage_period' }], ['😀王甲工资于1月15日支付', { scope: 'organization' }],
]) test(`yearless date does not borrow polarity, owner, role or scope: ${text} ${JSON.stringify(options)}`, () => direct('1月15日', text, false, options));
for (const [value, text] of [
  ['2026年1月', '😀王甲2026年1月与2月工资所属期间'], ['2月', '😀王甲2026年1月与2月工资所属期间'],
  ['2026年1月与2月', '😀李乙2026年1月与2月工资所属期间'], ['2026年1月与2月', '😀王甲2026年1月与2月李乙工资所属期间'],
]) test(`parallel-period source must retain every event boundary: ${value} / ${text}`, () => direct(value, text, false, { meaning: 'wage_period' }));
test('fresh and stored yearless payment date keeps raw precision and never authorizes money', () => runtime('1月15日', '😀王甲工资于1月15日支付。', true));
test('fresh and stored traditional parallel wage periods keep the whole literal', () => runtime('2026年1月與2月', '😀王甲2026年1月與2月工資所屬期間。', true, { meaning: 'wage_period' }));
test('fresh and stored invalid yearless dates retain their review issue', () => runtime('1月32日', '😀王甲工资于1月32日支付。', false));
test('fresh and stored negation cannot become a payment event', () => runtime('1月15日', '😀王甲工资于1月15日未支付。', false));
test('a different owner cannot complete the located payment date', () => runtime('1月15日', '😀王甲工资于1月15日李乙支付。', false));
test('a different sentence cannot lend its payment verb', () => runtime('1月15日', '😀王甲工资于1月15日。李乙支付。', false));
test('a verb on another page cannot complete the yearless payment envelope', () => runtime('1月15日', ['😀王甲工资于1月15日', '支付。'], false, {}, [1, 2]));
