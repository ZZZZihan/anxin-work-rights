// ROUND37: attached doubling verbs remain formulas, never evaluated amounts.
// Synthetic module/runtime/history checks only; no scorer, model or HTTP.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OWN = fileURLToPath(new URL('../', import.meta.url));
const BASE = resolve(process.env.MATERIAL_FACT_TEST_ROOT || OWN);
const PATCH = resolve(process.env.MATERIAL_FACT_PATCH_ROOT || OWN);
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-round37-doubling-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(BASE, 'lib'), resolve(temporary, 'lib'), { recursive: true });
await cp(resolve(PATCH, 'lib/material-fact-arithmetic-review.ts'), resolve(temporary, 'lib/material-fact-arithmetic-review.ts'));
const load = name => import(pathToFileURL(resolve(temporary, 'lib', name + '.ts')).href);
const { normalizeMoneyValueV4, normalizeCandidateValueV4 } = await load('material-money-v4');
const { hasAttachedMoneyArithmetic } = await load('material-fact-arithmetic-review');
const { emptyFactState, ingestCandidates, validateCandidateOutput } = await load('material-facts-v3');
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest');
const { reviewFactsAgainstSources } = await load('material-fact-source-review');
const cpLength = text => Array.from(text).length;
const AT = '2026-10-19T00:00:00.000Z';

function fixture(expression, { fullQuote = false, next = null, page = 1, meaning = 'due_total', rateUnit = null } = {}) {
  const source = { id: 'round37-doubling', name: '合成附着翻倍表达', sha256: 'd'.repeat(64), analysisRevision: 37, ready: true,
    blocks: [{ id: 'b1', page: 1, text: '😀王甲工资' + expression + (next === null ? '。' : ''), bbox: null, confidence: null }] };
  if (next !== null) source.blocks.push({ id: 'b2', page, text: next, bbox: null, confidence: null });
  const candidate = { kind: 'money', value: '4000元', quote: fullQuote ? source.blocks[0].text : '4000元', blockId: 'b1', subject: '王甲',
    scope: 'individual', meaning, completeness: meaning === 'rate' ? 'not_applicable' : 'complete', period: null, rateUnit, assertion: 'narrated' };
  return { source, candidate, raw: JSON.stringify({ schemaVersion: 3, candidates: [candidate] }) };
}

function pipeline(f, wanted, status = null) {
  const original = structuredClone(f);
  assert.equal(validateCandidateOutput(f.raw, f.source).rejected.length, 0, 'The synthetic candidate must satisfy the actual schema.');
  function inspect(state, expected, label) {
    const material = state.materials[0];
    assert.equal(material.raw, f.raw); assert.equal(material.rejected.length, 0);
    assert.equal(material.candidates.length, 1, 'The raw observation remains reviewable.');
    assert.equal(state.calculation, null); assert.deepEqual(state.confirmations, { due: null, paid: null });
    const fact = material.candidates[0];
    assert.equal(fact.amount, expected, label + ': amount');
    assert.equal(fact.value, f.candidate.value); assert.equal(fact.quote, f.candidate.quote);
    assert.deepEqual(fact.representation, f.candidate);
    const text = f.source.blocks[0].text, start = cpLength(text.slice(0, text.indexOf(f.candidate.quote)));
    assert.deepEqual([fact.start, fact.end], [start, start + cpLength(f.candidate.quote)]);
    assert.equal(Array.from(text).slice(fact.start, fact.end).join(''), f.candidate.quote);
    if (status && label !== 'stored-null') assert.equal(fact.normalization.status, status, label + ': status');
  }
  inspect(ingestRuntimeCandidates(emptyFactState(37), f.source, { raw: f.raw }, 'synthetic', 'round37-author', AT), wanted, 'fresh');
  for (const oldAmount of ['4000.00', null]) {
    const stored = ingestCandidates(emptyFactState(37), f.source, { raw: f.raw }, 'synthetic', 'round37-author', AT);
    const fact = stored.materials[0].candidates[0];
    fact.amount = oldAmount;
    fact.normalization = { rawValue: f.candidate.value, status: oldAmount === null ? 'unsupported' : 'exact', amount: oldAmount,
      matchedText: f.candidate.value, span: { start: 0, end: cpLength(f.candidate.value) }, reason: 'Synthetic unconfirmed persisted observation.' };
    const before = structuredClone(stored), reviewed = reviewFactsAgainstSources(stored, [f.source]);
    assert.deepEqual(stored, before); assert.deepEqual(reviewed.history, before.history);
    inspect(reviewed, oldAmount === null ? null : wanted, oldAmount === null ? 'stored-null' : 'stored-exact');
  }
  assert.deepEqual(f, original);
}

const minimal = process.env.MATERIAL_FACT_ROUND37_MINIMAL === '1';
const expressions = minimal ? ['4000元翻倍', '4000元加倍'] : ['4000元翻倍', '4000元加倍', '4000元翻倍支付', '4000元加倍计算',
  '4000元翻\n倍', '4000元加\n倍', '4000元翻\u200d倍', '4000元 加 倍', '4000元整翻倍', '4000元正加倍',
  '4000元人民币翻倍', '人民币4000元加倍', '4000元工资翻倍', '4000元基本工资加倍', '4000元劳务费翻倍',
  '4000元工\n资加倍', '4000元（翻倍）'];
for (const expression of expressions) {
  test('whole literal does not return the doubling operand: ' + JSON.stringify(expression), () => {
    const result = normalizeMoneyValueV4(expression);
    assert.equal(result.amount, null); assert.equal(result.status, 'unsupported'); assert.equal(result.rawValue, expression);
  });
  test('a full quote cannot crop out doubling: ' + JSON.stringify(expression), () => {
    const f = fixture(expression, { fullQuote: true });
    const result = normalizeCandidateValueV4(f.candidate);
    assert.equal(result.amount, null); assert.equal(result.normalization.status, 'unsupported');
    assert.equal(result.value, '4000元'); assert.equal(result.normalization.rawValue, '4000元');
  });
}

if (!minimal) {
  for (const expression of expressions) test('source and persisted exact observation preserve doubling context: ' + JSON.stringify(expression), () => {
    for (const fullQuote of [false, true]) pipeline(fixture(expression, { fullQuote }), null, 'unsupported');
  });
  for (const tail of ['翻倍。', '加倍。', '翻\n倍。', '加\u200d倍。', '工资翻倍。']) test('same-page adjacent fragment cannot make the base amount payable: ' + JSON.stringify(tail), () => {
    pipeline(fixture('4000元', { next: tail }), null);
  });
  for (const after of ['。李乙工资加倍。', '，另一人工资翻倍。', '\n李乙工资加倍。', '工资已付，另一人加倍。',
    '加班费已付', '翻译费已付', '翻阅记录', '工资另行加倍', '工资，翻倍事宜另议', '/月', '/小时', '2名工人']) {
    test('bounded arithmetic does not scan unrelated prose: ' + JSON.stringify(after), () => {
      assert.equal(hasAttachedMoneyArithmetic('', after), false);
    });
  }
  for (const expression of ['4000元。李乙工资加倍', '4000元，另一人工资翻倍', '4000元工资已付，另一人加倍']) {
    test('sentence or owner separation preserves the original amount: ' + expression, () => {
      assert.equal(normalizeMoneyValueV4(expression).amount, '4000.00');
      pipeline(fixture(expression), '4000.00');
    });
  }
  for (const prefix of ['加倍工资共', '翻倍后工资合计', '两倍工资共']) test('a stated result is not its earlier multiplier operand: ' + prefix, () => {
    assert.equal(normalizeMoneyValueV4(prefix + '4000元').amount, '4000.00');
    pipeline(fixture(prefix + '4000元'), '4000.00');
  });
  test('genuine supported rates retain their declared denominator', () => {
    pipeline(fixture('4000元/月', { meaning: 'rate', rateUnit: 'month' }), '4000.00');
    pipeline(fixture('4000元/小时', { meaning: 'rate', rateUnit: 'hour' }), '4000.00');
    pipeline(fixture('4000元/月'), null);
  });
  test('explicit doubling does not cross page metadata', () => {
    pipeline(fixture('4000元', { next: '翻倍。', page: 2 }), '4000.00');
  });
  test('existing direct arithmetic remains non-exact', () => {
    for (const after of ['的2倍', '工资的两倍', '×2', '×\n2', '乘以提成率', '工资×2', '的半成', '加上2000元'])
      assert.equal(hasAttachedMoneyArithmetic('', after), true, after);
  });
}
