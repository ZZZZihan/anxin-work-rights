// Synthetic parser and source/runtime checks; no model, HTTP or frozen artifact.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.MATERIAL_FACT_TEST_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const load = name => import(pathToFileURL(resolve(ROOT, 'lib', name + '.ts')).href);
const { normalizeMoneyValueV4: money, canonicalMonetaryExpression: canonical } = await load('material-money-v4');
const { emptyFactState, ingestCandidates } = await load('material-facts-v3');
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest');
const { reviewFactsAgainstSources } = await load('material-fact-source-review');
const cp = value => Array.from(value).length;
const AT = '2026-10-19T00:00:00.000Z';

function fixture(expression, value = expression, changes = {}) {
  const text = '😀王甲工资记载' + expression + '。';
  const source = { id: 'symbol-yuan-omission', name: '合成人民币符号金额', sha256: 'd'.repeat(64), analysisRevision: 1, ready: true,
    blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
  const candidate = { kind: 'money', value, quote: value, blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'other_money',
    completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated', ...changes };
  return { source, candidate, raw: JSON.stringify({ schemaVersion: 3, candidates: [candidate] }) };
}

function pipeline(f, amount) {
  const snapshot = structuredClone(f);
  const ingest = fn => fn(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'symbol-yuan-omission', AT);
  const fresh = ingest(ingestRuntimeCandidates);
  assert.equal(fresh.materials[0].candidates.length, 1, 'unresolved money remains reviewable');
  const check = state => {
    const fact = state.materials[0].candidates[0];
    assert.equal(fact.amount, amount); assert.equal(state.materials[0].raw, f.raw);
    assert.equal(fact.value, f.candidate.value); assert.equal(fact.quote, f.candidate.quote);
    assert.deepEqual(fact.representation, f.candidate); assert.equal(fact.sourceSha256, f.source.sha256);
    assert.equal(fact.normalization.rawValue, f.candidate.value);
    const text = f.source.blocks[0].text, start = cp(text.slice(0, text.indexOf(f.candidate.quote)));
    assert.deepEqual([fact.start, fact.end], [start, start + cp(f.candidate.quote)]);
    assert.equal(Array.from(text).slice(fact.start, fact.end).join(''), f.candidate.quote);
    assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
  };
  check(fresh);
  const history = ingest(ingestCandidates), stored = history.materials[0].candidates[0];
  Object.assign(stored, { amount: '4000.00', normalization: { rawValue: stored.value, amount: '4000.00', status: 'exact',
    matchedText: stored.value, span: { start: 0, end: cp(stored.value) }, reason: 'Synthetic persisted exact value.' } });
  const beforeReview = structuredClone(history);
  check(reviewFactsAgainstSources(history, [f.source])); assert.deepEqual(history, beforeReview);
  stored.amount = null; stored.normalization = { rawValue: stored.value, amount: null, status: 'unsupported',
    matchedText: null, span: null, reason: 'Synthetic unavailable history must not auto-upgrade.' };
  const unavailable = structuredClone(history), reviewed = reviewFactsAgainstSources(history, [f.source]);
  assert.equal(reviewed.materials[0].candidates[0].amount, null); assert.deepEqual(history, unavailable);
  assert.deepEqual(f, snapshot);
}

for (const [value, amount] of [
  ['¥四千', '4000.00'], ['￥四千', '4000.00'], ['¥肆仟', '4000.00'], ['￥肆仟', '4000.00'],
  ['￥ 四千', '4000.00'], ['¥四千零五', '4005.00'], ['￥肆仟零伍', '4005.00'],
  ['¥四萬', '40000.00'], ['￥貳仟', '2000.00'], ['¥零', '0.00'],
  ['RMB四千', '4000.00'], ['人民币四千', '4000.00'], ['￥4000', '4000.00'], ['¥肆仟元整', '4000.00'],
]) test('a complete RMB marker supplies one omitted yuan unit: ' + value, () => {
  const parsed = money(value);
  assert.equal(parsed.amount, amount); assert.equal(parsed.status, 'exact');
  assert.equal(parsed.rawValue, value); assert.equal(parsed.matchedText, value);
  assert.deepEqual(parsed.span, { start: 0, end: cp(value) }); assert.equal(canonical(value), 'exact:' + amount);
});

for (const value of [
  '¥四千到五千', '约￥四千', '¥四千多', '¥四千待核', '¥四千×2', '￥四千乘以税率',
  '¥四千/年', '¥四千美元', '人民币¥四千', '¥四千RMB', '¥四千￥',
  '¥四千五', '￥肆仟伍', '¥四千点五', '¥四千5角', '￥四千元5角5分5厘',
]) test('omitted yuan does not repair an unsafe or incomplete expression: ' + value, () => {
  assert.equal(money(value).amount, null);
  assert.ok(!canonical(value)?.startsWith('exact:'), 'no comparison key may manufacture an exact amount');
});

for (const value of ['¥四千', '￥肆仟']) test('fresh and stored exact facts preserve symbol evidence: ' + value, () => pipeline(fixture(value), '4000.00'));

for (const expression of [
  '约¥四千', '¥四千到五千', '¥四千待核', '¥四千乘以税率', '¥四千美元',
  '¥四千5角', '¥四千￥', '¥四千/年', '¥四千/月',
]) test('a cropped quote cannot erase symbol-amount context: ' + expression, () => pipeline(fixture(expression, '¥四千'), null));

test('a declared monthly symbol amount remains a rate without becoming a total', () => {
  pipeline(fixture('¥四千/月', '¥四千', { meaning: 'rate', rateUnit: 'month' }), '4000.00');
});
