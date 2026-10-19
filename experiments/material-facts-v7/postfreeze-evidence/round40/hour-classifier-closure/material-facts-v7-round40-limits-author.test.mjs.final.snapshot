// ROUND40: explicit postposed upper/lower limits are not exact totals.
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
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-round40-limits-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(BASE, 'lib'), resolve(temporary, 'lib'), { recursive: true });
await cp(resolve(PATCH, 'lib/material-fact-range-review.ts'), resolve(temporary, 'lib/material-fact-range-review.ts'));
const load = name => import(pathToFileURL(resolve(temporary, 'lib', name + '.ts')).href);
const { normalizeMoneyValueV4: money, normalizeCandidateValueV4: candidateValue, canonicalMonetaryExpression: canonical } = await load('material-money-v4');
const { attachedMoneyQualifierStatus: qualifier } = await load('material-fact-range-review');
const { emptyFactState, ingestCandidates, validateCandidateOutput, buildFactView } = await load('material-facts-v3');
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest');
const { reviewFactsAgainstSources } = await load('material-fact-source-review');
const cpLength = text => Array.from(text).length;
const minimal = process.env.MATERIAL_FACT_ROUND40_LIMITS_MINIMAL === '1';
const AT = '2026-10-19T04:00:00.000Z';

function fixture(expression, { fullQuote = false, fullValue = false, next = null, page = 1,
  meaning = 'other_money', rateUnit = null } = {}) {
  const source = { id: 'round40-limits', name: '合成附着上下限表达', sha256: '9'.repeat(64), analysisRevision: 40, ready: true,
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


const expressions = minimal ? ['4000元为上限', '4000元作为下限', '4000元為上限'] : [
  '4000元为上限', '4000元为下限', '4000元作为上限', '4000元作为下限',
  '4000元為上限', '4000元作為下限', '以4000元为上限', '以人民币4000元作为下限',
];
for (const expression of expressions) {
  test('whole value and quote crop preserve the explicit bound: ' + expression, () => {
    const result = money(expression);
    assert.equal(result.amount, null); assert.equal(result.status, 'approximate'); assert.equal(result.rawValue, expression);
    assert.notEqual(canonical(expression), canonical('4000元'), 'A bounded value cannot borrow its exact endpoint key.');
    const f = fixture(expression, { fullQuote: true }), crop = candidateValue(f.candidate);
    assert.equal(crop.amount, null); assert.equal(crop.normalization.status, 'approximate');
    assert.equal(crop.value, '4000元'); assert.equal(crop.normalization.rawValue, '4000元');
  });
}
if (!minimal) {
  for (const expression of expressions) test('runtime and read-time exact downgrade preserve raw/CP: ' + expression, () => {
    for (const fullQuote of [false, true]) check(fixture(expression, { fullQuote }), null, 'approximate');
    check(fixture(expression, { fullValue: true }), null, 'approximate');
  });
  for (const tail of ['为上限。', '作为下限。', '為下限。', '作為上限。'])
    test('same-page adjacent bound cannot leave the endpoint usable: ' + tail, () => {
      for (const fullQuote of [false, true]) check(fixture('4000元', { next: tail, fullQuote }), null);
    });
  test('explicit words may cross layout without changing original positions', () => {
    for (const expression of ['4000元为\n上限', '4000元作\n為下限', '4000元 为 上 限', '4000元作\u200d為下\u200d限']) {
      assert.equal(money(expression).amount, null, expression);
      check(fixture(expression, { fullQuote: true }), null);
    }
    check(fixture('4000元作', { next: '為下限。' }), null);
    check(fixture('4000元为', { next: '上限。' }), null);
  });
  test('existing finite RMB and whole-amount wrappers do not hide the bound', () => {
    for (const expression of ['4000元整为上限', '4000元正作为下限', '4000元人民币为上限', '4000元人民幣作為下限']) {
      assert.equal(money(expression).amount, null, expression); check(fixture(expression), null);
    }
  });
  test('a supported rate with an explicit bound is never an exact rate', () => {
    check(fixture('4000元/月为上限', { meaning: 'rate', rateUnit: 'month' }), null);
    check(fixture('4000元/小时作为下限', { meaning: 'rate', rateUnit: 'hour' }), null);
  });
  test('classifier hour denominators retain their attached bounds and unknown guards', () => {
    for (const after of ['每个小时以上', '每個小时为上限', '/个小时作为下限', '/個小时以上'])
      assert.equal(qualifier('', after), 'approximate', after);
    for (const after of ['每个小时以上', '每個小时为上限', '/个小时作为下限', '每个小时待定', '/個小时？'])
      check(fixture('4000元' + after, { meaning: 'rate', rateUnit: 'hour' }), null);
  });
  test('ordinary words and unlisted narrative cannot bridge a limit', () => {
    for (const tail of ['为上海银行支付', '作为下列方式支付', '为下次发薪准备', '作为上班补贴', '工资另行约定为上限'])
      assert.equal(qualifier('', tail), null, tail);
  });
  for (const expression of ['4000元为上海银行卡支付', '4000元作为下列方式支付', '4000元为下次发薪准备'])
    test('ordinary continuations retain their stated amount: ' + expression, () => {
      assert.equal(money(expression).amount, '4000.00'); check(fixture(expression), '4000.00');
    });
  for (const expression of ['4000元。李乙工资以此为上限', '4000元，李乙工资作为下限', '4000元\n李乙工资为上限'])
    test('another sentence or owner cannot qualify this amount: ' + JSON.stringify(expression), () => {
      assert.equal(money(expression).amount, '4000.00'); check(fixture(expression), '4000.00');
    });
  test('a sentence-ending block prevents lexical bound composition', () => {
    check(fixture('4000元。', { next: '为上限。' }), '4000.00');
  });
  test('a different owner in the next block prevents lexical bound composition', () => {
    check(fixture('4000元', { next: '李乙工资为上限。' }), '4000.00');
  });
  test('different page metadata stops bound composition', () => {
    for (const next of ['为上限。', '作为下限。']) check(fixture('4000元', { next, page: 2 }), '4000.00');
  });
  test('existing bounds, ranges, unknowns, formulas and currency guards stay non-exact', () => {
    for (const expression of ['4000元以上', '4000元以下', '4000元以内', '4000元及以上', '4000元至5000元',
      '4000元为上限至5000元', '4000元待定', '4000元乘以2', '4000港元', '4000元人民币人民币'])
      assert.equal(money(expression).amount, null, expression);
  });
}
