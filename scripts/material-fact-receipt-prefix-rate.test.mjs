// PR45 receipt/rate attribution: synthetic source ingestion and stored review.
// No model, HTTP, frozen experiment, inferred year, or total authorization.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.MATERIAL_FACT_TEST_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const EVENT = resolve(process.env.MATERIAL_FACT_EVENT_FILE || resolve(ROOT, 'lib/material-fact-event-review.ts'));
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-pr45-receipt-prefix-rate-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(ROOT, 'lib'), resolve(temporary, 'lib'), { recursive: true });
await cp(EVENT, resolve(temporary, 'lib/material-fact-event-review.ts'));
const load = name => import(pathToFileURL(resolve(temporary, 'lib', name)).href);
const { hasSupportedCandidateAttribution } = await load('material-fact-event-review.ts');
const { emptyFactState, ingestCandidates, normalizeCandidateValue, validateCandidateOutput, buildFactView } = await load('material-facts-v3.ts');
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest.ts');
const { reviewFactsAgainstSources } = await load('material-fact-source-review.ts');
const AT = '2026-10-19T08:00:00.000Z';
const length = value => Array.from(value).length;
console.log(JSON.stringify({ node: process.version, dependency_root: ROOT,
  event_sha256: createHash('sha256').update(await readFile(EVENT)).digest('hex') }));

function check({ text, value = '1月15日', kind = 'date', meaning = kind === 'date' ? 'payment_date' : 'rate',
  subject = '王甲', scope = 'individual', rateUnit = kind === 'date' ? null : 'month', period = null,
  expected = true, amount = kind === 'date' ? null : '400.00', status = kind === 'date' ? 'not_money' : 'exact' }) {
  const source = { id: 'pr45-receipt-prefix-rate', name: 'synthetic.txt', sha256: '5'.repeat(64), analysisRevision: 45, ready: true,
    blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
  for (const quote of [value, text]) {
    const entry = { kind, value, quote, blockId: 'b1', subject, scope, meaning,
      completeness: ['due_total', 'paid_total'].includes(meaning) ? 'complete' : 'not_applicable', period, rateUnit, assertion: 'narrated' };
    const raw = JSON.stringify({ schemaVersion: 3, candidates: [entry] });
    assert.equal(validateCandidateOutput(raw, source).rejected.length, 0, 'Use the actual extraction schema.');
    const normalization = normalizeCandidateValue({ ...entry, quote: value }).normalization;
    const directInput = structuredClone({ entry, normalization, source });
    const direct = hasSupportedCandidateAttribution(entry, text.replace(/。$/u, ''), normalization);
    const stored = ingestCandidates(emptyFactState(45), source, { raw }, 'synthetic', 'fixture', AT);
    const before = structuredClone({ source, stored });
    const fresh = ingestRuntimeCandidates(emptyFactState(45), source, { raw }, 'synthetic', 'fixture', AT);
    const reviewed = reviewFactsAgainstSources(stored, [source]);
    const relations = { direct };
    for (const [mode, state] of [['fresh', fresh], ['stored-read', reviewed]]) {
      assert.equal(state.materials[0].candidates.length, 1, 'A warning retains the source candidate.');
      const fact = state.materials[0].candidates[0];
      relations[mode] = !fact.reviewIssues.some(issue => issue.code === 'source_relation_unresolved');
      assert.equal(fact.amount, amount, mode + ' preserves the independent amount constraint');
      assert.equal(fact.normalization.status, status, mode + ' amount normalization');
      assert.deepEqual(fact.representation, entry);
      assert.equal(fact.value, value); assert.equal(fact.quote, quote);
      assert.equal(fact.normalization.rawValue, value, 'No missing year or rate denominator is invented.');
      assert.equal(state.materials[0].raw, raw);
      const start = length(text.slice(0, text.indexOf(quote)));
      assert.equal(fact.start, start); assert.equal(fact.end, start + length(quote));
      assert.equal(Array.from(text).slice(fact.start, fact.end).join(''), quote);
      assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
      assert.equal(buildFactView(state, [source]).canCalculate, false);
    }
    assert.deepEqual({ source, stored }, before, 'Stored source, literals and history remain unchanged.');
    assert.deepEqual({ entry, normalization, source }, directInput, 'Direct detection never rewrites its inputs.');
    assert.deepEqual(relations, { direct: expected, fresh: expected, 'stored-read': expected }, text);
  }
}

for (const verb of ['到账', '入账', '收到', '领取', '实际到账', '實際入帳'])
  test(`yearless wage receipt: ${verb}`, () => check({ text: `😀王甲工資於1月15日${verb}。` }));
for (const value of ['十二月三十一日', '１２月３１日'])
  test(`bounded yearless receipt literal: ${value}`, () => check({ text: `王甲工资在${value}收到。`, value }));
for (const value of ['13月15日', '0月15日', '1月0日', '1月32日', '1月15', '1月15日前', '1月15日至20日'])
  test(`invalid or cropped yearless receipt remains unresolved: ${value}`, () => check({ text: `王甲工资于${value}到账。`, value, expected: false }));
for (const [text, options] of [
  ['王甲工资待核。李乙工资于1月15日到账。', {}], ['李王甲工资于1月15日到账。', {}],
  ['王甲工资由李乙于1月15日到账。', {}], ['王甲工资于1月15日李乙收到。', {}],
  ['王甲工资于1月15日未到账。', {}], ['王甲工资于1月15日到账给李乙。', {}],
  ['王甲工资于1月15日。李乙到账。', {}],
  ['王甲工资于1月15日到账。', { meaning: 'employment_period' }],
  ['王甲工资于1月15日到账。', { meaning: 'wage_period' }],
  ['王甲工资于1月15日到账。', { scope: 'organization' }],
]) test(`yearless receipt cannot borrow subject, role or polarity: ${text} ${JSON.stringify(options)}`,
  () => check({ text, ...options, expected: false }));
test('a recurring receipt day keeps its existing receipt layout', () => check({ text: '王甲每月15日收到工资。', value: '每月15日' }));
test('recurring actual-arrival prose is not a yearless point', () => check({ text: '王甲工资于每月15日到账。', value: '每月15日', expected: false }));
test('recurring payment schedule keeps its existing distinct envelope', () => check({ text: '王甲工资于每月15日支付。', value: '每月15日' }));
test('a cropped recurring day cannot become a point receipt', () => check({ text: '王甲工资于每月15日到账。', value: '15日', expected: false }));

const rates = [
  ['月工资为', 'month'], ['日工资为', 'day'], ['小时工资为', 'hour'], ['计件工资为', 'piece'],
  ['月基本工资标准为', 'month'], ['日基本工資約定為', 'day'], ['時工資標準為', 'hour'], ['計件單價為', 'piece'],
];
for (const [label, unit] of rates)
  test(`explicit source rate label: ${label}`, () => check({ text: `😀王甲${label}400元。`, value: '400元', kind: 'money', rateUnit: unit }));
for (const [label, unit] of rates.slice(0, 4)) {
  const wrong = unit === 'month' ? 'day' : 'month';
  test(`source rate rejects mismatched enum: ${label}/${wrong}`, () => check({ text: `王甲${label}400元。`, value: '400元', kind: 'money',
    rateUnit: wrong, expected: false, amount: null, status: 'rate_unit_mismatch' }));
  test(`a source rate cannot become arrears: ${label}`, () => check({ text: `王甲${label}400元。`, value: '400元', kind: 'money',
    meaning: 'arrears', rateUnit: null, expected: false, amount: null, status: 'rate_unit_mismatch' }));
}
for (const [text, options] of [
  ['李王甲月工资为400元。', {}], ['王甲李乙月工资为400元。', {}], ['王甲月工资为400元但未核实。', {}],
  ['王甲月工资为400元。', { rateUnit: 'unknown' }],
]) test(`prefix rate cannot absorb an owner, qualification or unknown enum: ${text} ${JSON.stringify(options)}`,
  () => check({ text, value: '400元', kind: 'money', ...options, expected: false }));
test('a wage period is not a monthly rate prefix', () => check({ text: '王甲2026年1月工资为400元。', value: '400元', kind: 'money', expected: false }));
for (const [period, unit, text] of [
  ['2026年1', 'month', '王甲2026年1月工资为400元。'],
  ['2026年1月15', 'day', '王甲2026年1月15日工资为400元。'],
  ['２０２６年１', 'month', '王甲２０２６年１月工资为400元。'],
  ['二〇二六年一', 'month', '王甲二〇二六年一月工资为400元。'],
]) test(`a cropped period cannot lend its calendar unit to the rate prefix: ${period}`, () => check({
  text, value: '400元', kind: 'money', period, rateUnit: unit, expected: false,
}));
for (const [period, unit, label] of [
  ['2026年', 'month', '月工资'], ['2026年1月', 'month', '的月工资'], ['2026年1月15日', 'day', '日工资'],
]) test(`a complete period preserves its separate rate label: ${period}/${label}`, () => check({
  text: `王甲${period}${label}为400元。`, value: '400元', kind: 'money', period, rateUnit: unit,
}));
test('a matching explicit suffix retains the prefix rate', () => check({ text: '王甲月工资为400元/月。', value: '400元', kind: 'money' }));
test('a conflicting suffix cannot override the declared prefix rate', () => check({ text: '王甲月工资为400元/日。', value: '400元', kind: 'money',
  expected: false, amount: null, status: 'rate_unit_mismatch' }));
