// R40 finite hourly classifier regression. Synthetic module/runtime evidence only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = resolve(process.env.MATERIAL_FACT_TEST_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const load = name => import(pathToFileURL(resolve(ROOT, 'lib', name)).href);
const { normalizeCandidateValueV4: normalize } = await load('material-money-v4.ts');
const { ingestRuntimeCandidates: fresh } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, buildFactView } = await load('material-facts-v3.ts');
const { reviewFactsAgainstSources: review } = await load('material-fact-source-review.ts');
const cp = text => Array.from(text).length, AT = '2026-10-19T05:00:00.000Z';
const candidate = (value, extra = {}) => ({kind: 'money', value, quote: value, blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'rate', completeness: 'not_applicable', period: null, rateUnit: 'hour', assertion: 'narrated', ...extra});
function pipeline(expression, expected, {full = false, extra = {}, next = null} = {}) {
  const source = {id: 'round40-hour', name: 'synthetic.txt', sha256: '4'.repeat(64), ready: true, analysisRevision: 40,
    blocks: [{id: 'b1', page: 1, text: `😀王甲${extra.period ?? ''}工资${expression}${next === null ? '。' : ''}`, bbox: null, confidence: null}]};
  if (next !== null) source.blocks.push({id: 'b2', page: 1, text: next, bbox: null, confidence: null});
  const entry = candidate(full ? expression : '4000元', extra), raw = JSON.stringify({schemaVersion: 3, candidates: [entry]});
  const original = structuredClone({source, entry});
  const history = legacy(emptyFactState(40), source, {raw}, 'synthetic', 'hour-author', AT);
  const storedFact = history.materials[0].candidates[0]; assert(storedFact);
  storedFact.amount = '4000.00'; storedFact.normalization = {rawValue: entry.value, amount: '4000.00', status: 'exact', matchedText: entry.value, span: {start: 0, end: cp(entry.value)}, reason: 'Synthetic old exact observation'};
  const stored = structuredClone(history);
  for (const state of [fresh(emptyFactState(40), source, {raw}, 'synthetic', 'hour-author', AT), review(history, [source])]) {
    assert.equal(state.materials[0].candidates.length, 1); const fact = state.materials[0].candidates[0];
    assert.equal(fact.amount, expected); assert.deepEqual(fact.representation, entry); assert.equal(state.materials[0].raw, raw);
    const text = source.blocks[0].text, start = cp(text.slice(0, text.indexOf(entry.quote)));
    assert.deepEqual([fact.start, fact.end], [start, start + cp(entry.quote)]);
    assert.equal(Array.from(text).slice(fact.start, fact.end).join(''), entry.quote);
    assert.deepEqual(state.confirmations, {due: null, paid: null}); assert.equal(state.calculation, null);
    assert.equal(buildFactView(state, [source]).canCalculate, false);
  }
  assert.deepEqual(history, stored);
  storedFact.amount = null; Object.assign(storedFact.normalization, {amount: null, status: 'unsupported', matchedText: null, span: null});
  const unavailable = structuredClone(history); assert.equal(review(history, [source]).materials[0].candidates[0].amount, null);
  assert.deepEqual(history, unavailable); assert.deepEqual({source, entry}, original);
}
for (const unit of ['每个小时', '/个小时', '每個小時', '/個小時']) {
  const expression = '4000元' + unit;
  test('complete hourly classifier preserves literal and denominator: ' + unit, () => {
    const raw = candidate(expression), before = structuredClone(raw), result = normalize(raw);
    assert.equal(result.amount, '4000.00'); assert.equal(result.rateUnit, 'hour'); assert.equal(result.normalization.rawValue, expression); assert.deepEqual(raw, before);
  });
  for (const full of [true, false]) test(`fresh/history full=${full} hourly classifier ${unit}`, () => pipeline(expression, '4000.00', {full}));
  test('hour classifier cannot authorize month rate: ' + unit, () => pipeline(expression, null, {extra: {rateUnit: 'month'}}));
  test('hour classifier cannot authorize a complete personal total: ' + unit, () => pipeline(expression, null, {extra: {meaning: 'due_total', completeness: 'complete', period: '2026年1月', rateUnit: null}}));
}
for (const unit of ['/个小时候', '/個小時數']) test('denominator must be a whole lexical unit: ' + unit, () => pipeline('4000元' + unit, null));
for (const layout of ['inline', 'line', 'block']) test('hour classifier cannot discard attached unknown: ' + layout, () => {
  const suffix = '每个小时', tail = '待定';
  pipeline('4000元' + suffix + (layout === 'inline' ? tail : layout === 'line' ? '\n' + tail : ''), null, {next: layout === 'block' ? tail + '。' : null});
});
test('hour classifier cannot discard foreign currency', () => pipeline('4000元港币每个小时', null));
test('ordinary hourly spelling stays supported', () => pipeline('4000元每小时', '4000.00'));
test('ordinary monthly classifier stays supported', () => pipeline('4000元每个月', '4000.00', {extra: {rateUnit: 'month'}}));
test('an independent other-owner uncertainty does not erase a literal rate', () => pipeline('4000元每个小时。李乙金额待定', '4000.00'));
test('format-control detection preserves original characters', () => pipeline('4000元每個小\u200d時', '4000.00'));
