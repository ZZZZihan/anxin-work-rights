// ROUND39: an attached halving operation is an operand, never its result.
// Synthetic module/runtime/read-time review only; no scorer, model or HTTP.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OWN = fileURLToPath(new URL('../', import.meta.url));
const BASE = resolve(process.env.MATERIAL_FACT_TEST_ROOT || OWN);
const PATCH = resolve(process.env.MATERIAL_FACT_PATCH_ROOT || OWN);
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-round39-halving-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(BASE, 'lib'), resolve(temporary, 'lib'), { recursive: true });
await cp(resolve(PATCH, 'lib/material-fact-arithmetic-review.ts'), resolve(temporary, 'lib/material-fact-arithmetic-review.ts'));
const load = name => import(pathToFileURL(resolve(temporary, 'lib', name + '.ts')).href);
const { normalizeMoneyValueV4: money, normalizeCandidateValueV4: candidateValue, canonicalMonetaryExpression: canonical } = await load('material-money-v4');
const { hasAttachedMoneyArithmetic: arithmetic } = await load('material-fact-arithmetic-review');
const { emptyFactState, ingestCandidates, validateCandidateOutput, buildFactView } = await load('material-facts-v3');
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest');
const { reviewFactsAgainstSources } = await load('material-fact-source-review');
const cpLength = text => Array.from(text).length;
const minimal = process.env.MATERIAL_FACT_ROUND39_MINIMAL === '1';
const AT = '2026-10-19T04:00:00.000Z';

function fixture(expression, { fullQuote = false, fullValue = false, next = null, page = 1,
  meaning = 'other_money', rateUnit = null } = {}) {
  const source = { id: 'round39-halving', name: '合成附着减半表达', sha256: '9'.repeat(64), analysisRevision: 39, ready: true,
    blocks: [{ id: 'b1', page: 1, text: '😀王甲工资' + expression + (next === null ? '。' : ''), bbox: null, confidence: null }] };
  if (next !== null) source.blocks.push({ id: 'b2', page, text: next, bbox: null, confidence: null });
  const value = fullValue ? expression : '4000元';
  const candidate = { kind: 'money', value, quote: fullQuote ? source.blocks[0].text : value, blockId: 'b1', subject: '王甲', scope: 'individual',
    meaning, completeness: meaning === 'rate' || meaning === 'other_money' ? 'not_applicable' : 'complete',
    period: null, rateUnit, assertion: 'narrated' };
  return { source, candidate, raw: JSON.stringify({ schemaVersion: 3, candidates: [candidate] }) };
}

function check(f, amount, status = null) {
  const original = structuredClone(f);
  assert.equal(validateCandidateOutput(f.raw, f.source).rejected.length, 0, 'The candidate must pass the real input schema.');
  function inspect(state, expected, label) {
    const material = state.materials[0], fact = material.candidates[0];
    assert.equal(material.raw, f.raw); assert.equal(material.rejected.length, 0); assert.equal(material.candidates.length, 1);
    assert.equal(fact.amount, expected, label + ': amount');
    assert.equal(fact.value, f.candidate.value); assert.equal(fact.quote, f.candidate.quote);
    assert.deepEqual(fact.representation, f.candidate);
    const text = f.source.blocks[0].text, start = cpLength(text.slice(0, text.indexOf(f.candidate.quote)));
    assert.deepEqual([fact.start, fact.end], [start, start + cpLength(f.candidate.quote)]);
    assert.equal(Array.from(text).slice(fact.start, fact.end).join(''), f.candidate.quote);
    if (status && label !== 'stored-null') assert.equal(fact.normalization.status, status, label + ': status');
    assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
    assert.equal(buildFactView(state, [f.source]).canCalculate, false);
  }
  inspect(ingestRuntimeCandidates(emptyFactState(39), f.source, { raw: f.raw }, 'synthetic', 'round39-author', AT), amount, 'fresh');
  for (const oldAmount of ['4000.00', null]) {
    const stored = ingestCandidates(emptyFactState(39), f.source, { raw: f.raw }, 'synthetic', 'round39-author', AT);
    const fact = stored.materials[0].candidates[0];
    fact.amount = oldAmount;
    fact.normalization = { rawValue: f.candidate.value, status: oldAmount === null ? 'unsupported' : 'exact', amount: oldAmount,
      matchedText: f.candidate.value, span: { start: 0, end: cpLength(f.candidate.value) }, reason: 'Unconfirmed synthetic stored observation.' };
    const before = structuredClone(stored), reviewed = reviewFactsAgainstSources(stored, [f.source]);
    assert.deepEqual(stored, before, 'Read-time review cannot rewrite storage or original raw.');
    assert.deepEqual(reviewed.history, before.history);
    inspect(reviewed, oldAmount === null ? null : amount, oldAmount === null ? 'stored-null' : 'stored-exact');
  }
  assert.deepEqual(f, original);
}

const expressions = minimal ? ['4000元减半', '4000元減半', '4000元折半'] : [
  '4000元减半', '4000元減半', '4000元折半', '4000元减半支付', '4000元折半计算',
  '4000元減\n半', '4000元减\u200d半', '4000元 折 半', '4000元整减半', '4000元正折半',
  '人民币4000元減半', '4000元人民币折半', '4000元基本工资折半', '4000元劳务费减半',
  '4000元工\n资減半', '4000元（折半）',
];
for (const expression of expressions) {
  test('whole halving expression cannot return its base: ' + JSON.stringify(expression), () => {
    const result = money(expression);
    assert.equal(result.amount, null); assert.equal(result.status, 'unsupported'); assert.equal(result.rawValue, expression);
    assert.equal(canonical(expression), null, 'A formula cannot obtain the exact base canonical key.');
  });
  test('a full quote cannot crop off halving: ' + JSON.stringify(expression), () => {
    const f = fixture(expression, { fullQuote: true }), result = candidateValue(f.candidate);
    assert.equal(result.amount, null); assert.equal(result.normalization.status, 'unsupported');
    assert.equal(result.value, '4000元'); assert.equal(result.normalization.rawValue, '4000元');
  });
}

if (!minimal) {
  for (const expression of expressions) test('source and read-time exact downgrade preserve raw and CP: ' + JSON.stringify(expression), () => {
    for (const fullQuote of [false, true]) check(fixture(expression, { fullQuote }), null, 'unsupported');
    check(fixture(expression, { fullValue: true }), null, 'unsupported');
  });
  for (const tail of ['减半。', '減半。', '折半。', '减\n半。', '工资折半。'])
    test('same-page adjacent halving remains an operation: ' + JSON.stringify(tail), () => {
      for (const fullQuote of [false, true]) check(fixture('4000元', { next: tail, fullQuote }), null);
    });
  test('an explicit halving word can continue within the same page', () => {
    for (const head of ['4000元减', '4000元減', '4000元折']) check(fixture(head, { next: '半。' }), null);
  });
  for (const after of ['。李乙工资减半', '，另一人工资折半', '\n李乙工资減半', '工资已付，另一人减半',
    '工资另行折半', '减薪后另议', '折旧费用', '半年度总结', '/月', '/小时', '2名工人'])
    test('the helper does not search another statement or ordinary prose: ' + JSON.stringify(after), () => {
      assert.equal(arithmetic('', after), false);
    });
  for (const expression of ['4000元。李乙工资减半', '4000元，另一人工资折半', '4000元工资已付，另一人減半'])
    test('sentence or other-owner separation preserves the anchored amount: ' + expression, () => {
      assert.equal(money(expression).amount, '4000.00'); check(fixture(expression), '4000.00');
    });
  for (const prefix of ['减半后工资合计', '減半后工资合计', '折半后工资共'])
    test('an expressly stated result is not the earlier base: ' + prefix, () => {
      assert.equal(money(prefix + '4000元').amount, '4000.00'); check(fixture(prefix + '4000元'), '4000.00');
    });
  test('page metadata prevents halving composition', () => {
    for (const next of ['减半。', '減半。', '工资折半。']) check(fixture('4000元', { next, page: 2 }), '4000.00');
  });
  test('a sentence-ending block prevents halving composition', () => {
    check(fixture('4000元。', { next: '折半。' }), '4000.00');
  });
  test('genuine supported rates retain their denominator while total claims stay unavailable', () => {
    for (const [suffix, rateUnit] of [['/月', 'month'], ['/小时', 'hour']]) {
      check(fixture('4000元' + suffix, { meaning: 'rate', rateUnit }), '4000.00');
      check(fixture('4000元' + suffix, { meaning: 'due_total' }), null);
    }
  });
  test('existing formulas, currency, unknown and range guards remain non-exact', () => {
    for (const expression of ['4000元翻倍', '4000元加倍', '4000元翻一倍', '4000元的2倍', '4000元的二分之一',
      '4000元×2', '4000元乘以提成率', '4000元待定', '约4000元', '4000元至5000元', '4000港元'])
      assert.equal(money(expression).amount, null, expression);
  });
}
