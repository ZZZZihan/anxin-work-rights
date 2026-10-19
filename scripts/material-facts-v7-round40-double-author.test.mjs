// ROUND40: attached 双倍/雙倍 names a multiplier, never the payable result.
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
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-round40-double-'));
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
const minimal = process.env.MATERIAL_FACT_ROUND40_DOUBLE_MINIMAL === '1';
const AT = '2026-10-19T04:00:00.000Z';

function fixture(expression, { fullQuote = false, fullValue = false, next = null, page = 1,
  meaning = 'other_money', rateUnit = null } = {}) {
  const source = { id: 'round40-double', name: '合成附着双倍表达', sha256: '9'.repeat(64), analysisRevision: 40, ready: true,
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
  inspect(ingestRuntimeCandidates(emptyFactState(40), f.source, { raw: f.raw }, 'synthetic', 'round40-author', AT), amount, 'fresh');
  for (const oldAmount of ['4000.00', null]) {
    const stored = ingestCandidates(emptyFactState(40), f.source, { raw: f.raw }, 'synthetic', 'round40-author', AT);
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


const expressions = minimal ? ['4000元的双倍', '4000元的雙倍'] : [
  '4000元的双倍', '4000元的雙倍', '4000元工资的双倍', '4000元双倍',
];
for (const expression of expressions) {
  test('whole double expression and quote crop cannot borrow the base: ' + expression, () => {
    const result = money(expression);
    assert.equal(result.amount, null); assert.equal(result.status, 'unsupported'); assert.equal(result.rawValue, expression);
    assert.equal(canonical(expression), null);
    const f = fixture(expression, { fullQuote: true }), crop = candidateValue(f.candidate);
    assert.equal(crop.amount, null); assert.equal(crop.normalization.status, 'unsupported');
    assert.equal(crop.value, '4000元'); assert.equal(crop.normalization.rawValue, '4000元');
  });
}
if (!minimal) {
  for (const expression of expressions) test('fresh and read-time review keep the original operand/raw/CP: ' + expression, () => {
    for (const fullQuote of [false, true]) check(fixture(expression, { fullQuote }), null, 'unsupported');
    check(fixture(expression, { fullValue: true }), null, 'unsupported');
  });
  test('explicit 的 permits finite layout and format controls in the multiplier', () => {
    for (const expression of ['4000元的\n双倍', '4000元的雙\n倍', '4000元 的 雙 倍', '4000元的双\u200d倍']) {
      assert.equal(money(expression).amount, null); check(fixture(expression), null);
    }
  });
  test('an explicit multiplier continues into its same-page adjacent block', () => {
    for (const next of ['的双倍。', '的雙倍。']) check(fixture('4000元', { next }), null);
    check(fixture('4000元的双', { next: '倍。' }), null);
  });
  test('whole-amount wrappers do not hide an explicit multiplier', () => {
    for (const expression of ['4000元整的双倍', '4000元正的雙倍', '4000元人民币的双倍']) {
      assert.equal(money(expression).amount, null); check(fixture(expression), null);
    }
  });
  test('ordinary prose and another event cannot bridge into the operation', () => {
    for (const tail of ['。李乙工资的双倍', '，另一人雙倍', '\n李乙工资双倍', '工资另行双倍', '双人间', '双休日支付'])
      assert.equal(arithmetic('', tail), false, tail);
  });
  test('separate owner and sentence preserve this amount', () => {
    for (const expression of ['4000元。李乙工资的双倍', '4000元，李乙工资雙倍']) {
      assert.equal(money(expression).amount, '4000.00'); check(fixture(expression), '4000.00');
    }
    check(fixture('4000元。', { next: '的雙倍。' }), '4000.00');
  });
  test('page metadata prevents a double operation from attaching', () => {
    check(fixture('4000元', { next: '的双倍。', page: 2 }), '4000.00');
  });
  test('a bare multiplier on an independent line is not attached', () => {
    assert.equal(arithmetic('', '\n双倍工资'), false);
    assert.equal(arithmetic('', '\n雙倍'), false);
  });
  test('an explicitly stated result after double wages retains the result', () => {
    for (const expression of ['双倍工资共4000元', '雙倍工资合计4000元']) {
      assert.equal(money(expression).amount, '4000.00'); check(fixture(expression), '4000.00');
    }
  });
  test('supported rate and old formulas keep their existing contract', () => {
    check(fixture('4000元/月', { meaning: 'rate', rateUnit: 'month' }), '4000.00');
    check(fixture('4000元/月', { meaning: 'due_total' }), null);
    for (const expression of ['4000元的2倍', '4000元翻一倍', '4000元减半', '4000元折半', '4000元×2', '4000元乘以提成率'])
      assert.equal(money(expression).amount, null, expression);
  });
}
