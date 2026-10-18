// ROUND32 synthetic module checks only: no model, HTTP, scorer or history CLI.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OWN = fileURLToPath(new URL('../', import.meta.url));
const BASE = resolve(process.env.MATERIAL_FACT_TEST_ROOT || OWN);
const PATCH = resolve(process.env.MATERIAL_FACT_PATCH_ROOT || OWN);
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-round32-angle-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(BASE, 'lib'), resolve(temporary, 'lib'), { recursive: true });
for (const file of ['material-money-v4.ts', 'material-fact-currency-review.ts'])
  await cp(resolve(PATCH, 'lib', file), resolve(temporary, 'lib', file));
const load = file => import(pathToFileURL(resolve(temporary, file)).href);
const { normalizeMoneyValueV4: parse, normalizeCandidateValueV4: normalize, classifyMonetaryExpression: classify } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates, validateRuntimeCandidateOutput } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates, validateCandidateOutput } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const cpLength = value => Array.from(value).length;
const AT = '2026-10-18T00:00:00.000Z';

function fixture(expression, { value = expression, fullQuote = false, nextBlock = null } = {}) {
  const text = '😀王甲材料记载' + expression + (nextBlock === null ? '。' : '');
  const source = { id: 'round32-angle-author', name: '合成角词边界', sha256: 'a'.repeat(64), analysisRevision: 1, ready: true,
    blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
  if (nextBlock !== null) source.blocks.push({ id: 'b2', page: 1, text: nextBlock + '。', bbox: null, confidence: null });
  const candidate = { kind: 'money', value, quote: fullQuote ? text : value, blockId: 'b1', subject: '王甲', scope: 'individual',
    meaning: 'other_money', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
  return { source, candidate, raw: JSON.stringify({ schemaVersion: 3, candidates: [candidate] }) };
}

function retainedPipeline(f, amount) {
  const original = structuredClone(f);
  const check = fact => {
    assert(fact); assert.equal(fact.amount, amount); assert.deepEqual(fact.representation, f.candidate);
    assert.equal(fact.value, f.candidate.value); assert.equal(fact.quote, f.candidate.quote);
    assert.equal(fact.normalization.rawValue, f.candidate.value);
    const text = f.source.blocks[0].text, start = cpLength(text.slice(0, text.indexOf(f.candidate.quote)));
    assert.deepEqual([fact.start, fact.end], [start, start + cpLength(f.candidate.quote)]);
    assert.equal(Array.from(text).slice(fact.start, fact.end).join(''), f.candidate.quote);
  };
  const fresh = ingestRuntimeCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'round32-author', AT);
  assert.equal(fresh.materials[0].raw, f.raw); assert.equal(fresh.materials[0].rejected.length, 0); check(fresh.materials[0].candidates[0]);
  assert.deepEqual(fresh.confirmations, { due: null, paid: null }); assert.equal(fresh.calculation, null);
  const history = ingestCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'round32-author', AT);
  const fact = history.materials[0].candidates[0]; assert(fact);
  fact.amount = amount ?? '0.50'; fact.normalization = { rawValue: fact.value, amount: fact.amount, status: 'exact', matchedText: fact.value,
    span: { start: 0, end: cpLength(fact.value) }, reason: 'Synthetic old exact for source re-review.' };
  const stored = structuredClone(history), reviewed = reviewFactsAgainstSources(history, [f.source]);
  check(reviewed.materials[0].candidates[0]); assert.equal(reviewed.materials[0].raw, f.raw);
  assert.deepEqual(history, stored); assert.deepEqual(reviewed.history, history.history);
  fact.amount = null; fact.normalization = { rawValue: fact.value, amount: null, status: 'unsupported', matchedText: null, span: null, reason: 'Synthetic old unsupported.' };
  const unavailable = structuredClone(history);
  assert.equal(reviewFactsAgainstSources(history, [f.source]).materials[0].candidates[0].amount, null);
  assert.deepEqual(history, unavailable); assert.deepEqual(f, original);
}

const ordinary = ['五角星', '三角洲', '八角亭', '五角大楼', '五角大樓',
  '5角星', '3角洲', '8角亭', '5角大楼', '５角星', '３角洲', '８角亭', '５角大樓',
  '伍角星', '叁角洲', '捌角亭', '伍角大樓', '三角形', '30角度', '五\u200d角星', '三角\n洲'];
for (const value of ordinary) test('complete ordinary angle word is not a money observation: ' + JSON.stringify(value), () => {
  const f = fixture(value), original = structuredClone(f);
  assert.equal(parse(value).amount, null); assert.equal(parse(value).rawValue, value);
  const classified = classify(value);
  assert.equal(classified.kind, 'not_monetary'); assert.equal(classified.normalization.rawValue, value); assert.equal(classified.normalization.status, 'not_money');
  // The envelope and all eleven candidate fields are valid. Rejection must be semantic.
  assert.equal(validateCandidateOutput(f.raw, f.source).candidates.length, 1);
  const batch = validateRuntimeCandidateOutput(f.raw, f.source);
  assert.equal(batch.candidates.length, 0); assert.equal(batch.rejected.length, 1); assert.equal(batch.rejected[0].index, 0);
  assert.match(batch.rejected[0].reason, /没有金额表达/u);
  const fresh = ingestRuntimeCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'round32-author', AT);
  assert.equal(fresh.materials[0].candidates.length, 0); assert.equal(fresh.materials[0].raw, f.raw);
  assert.deepEqual(fresh.materials[0].rejected, batch.rejected); assert.equal(fresh.calculation, null);
  assert.deepEqual(fresh.confirmations, { due: null, paid: null }); assert.deepEqual(f, original);
});

for (const value of ['五角钱', '五角錢', '五角star', 'five角星', '五角星未知', '三角洲？', '八角亭金额待定', '五角大楼4000元'])
  test('unknown, Latin words and monetary prose are not rejected by a partial word match: ' + value, () => {
    assert.notEqual(classify(value).kind, 'not_monetary');
    const f = fixture(value), checked = validateRuntimeCandidateOutput(f.raw, f.source);
    assert.equal(checked.candidates.length, 1); assert.equal(checked.rejected.length, 0);
    assert.equal(checked.candidates[0].normalization.rawValue, value);
  });

const exact = [['人民币五角', '0.50'], ['人民币五角钱', '0.50'], ['人民幣五角錢', '0.50'], ['五角人民币', '0.50'],
  ['RMB5角2分', '0.52'], ['5角2分CNY', '0.52'], ['0.5元', '0.50'], ['５元５角', '5.50'], ['4000元工资', '4000.00']];
for (const [value, amount] of exact) test('real complete RMB amount retains original evidence: ' + value, () => {
  const parsed = parse('😀' + value); assert.equal(parsed.amount, amount); assert.equal(parsed.status, 'exact'); assert.equal(parsed.rawValue, '😀' + value);
  assert.equal(Array.from(parsed.rawValue).slice(parsed.span.start, parsed.span.end).join(''), parsed.matchedText);
  assert.equal(classify(value).kind, 'monetary'); retainedPipeline(fixture(value), amount);
});

for (const [expression, value] of [['人民币五角星', '人民币五角'], ['RMB3角洲', 'RMB3角'], ['CNY8角亭', 'CNY8角'],
  ['人民幣伍角大樓', '人民幣伍角'], ['人民币五元五角星', '人民币五元五角']]) {
  test('explicit RMB cannot turn an ordinary angle compound into cents: ' + expression, () => {
    assert.equal(parse(expression).amount, null); assert.equal(parse(expression).rawValue, expression);
    assert.notEqual(classify(expression).kind, 'not_monetary'); retainedPipeline(fixture(expression), null);
  });
  for (const fullQuote of [false, true]) test('ordinary angle tail cannot be cropped from value and quote: ' + JSON.stringify({ expression, value, fullQuote }), () => {
    const f = fixture(expression, { value, fullQuote });
    assert.equal(normalize({ ...f.candidate, quote: f.source.blocks[0].text }).amount, null); retainedPipeline(f, null);
  });
}

for (const layout of ['same', 'line', 'block']) for (const fullQuote of [false, true])
  test('shared full-source guard rejects cropped angle compound across layout: ' + JSON.stringify({ layout, fullQuote }), () => {
    const expression = '人民币五角' + (layout === 'same' ? '星' : layout === 'line' ? '\n星' : '');
    retainedPipeline(fixture(expression, { value: '人民币五角', fullQuote, nextBlock: layout === 'block' ? '星' : null }), null);
  });

for (const tail of ['。五角星', '，另见三角洲', '。王乙参观五角大楼'])
  test('another clause cannot change a complete RMB amount: ' + tail, () => retainedPipeline(fixture('人民币五角' + tail, { value: '人民币五角' }), '0.50'));
test('next block ordinary noun belongs to a separate sentence', () => retainedPipeline(fixture('人民币五角。', { value: '人民币五角', nextBlock: '王乙绘制五角星' }), '0.50'));
for (const value of ['五角星', '三角洲', '八角亭', '五角大楼']) test('existing stored ordinary observation remains present and unavailable: ' + value, () => {
  const f = fixture(value), stored = ingestCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'round32-author', AT);
  const original = structuredClone(stored), reviewed = reviewFactsAgainstSources(stored, [f.source]);
  assert.equal(reviewed.materials[0].candidates.length, 1); assert.equal(reviewed.materials[0].candidates[0].amount, null);
  assert.equal(reviewed.materials[0].raw, f.raw); assert.deepEqual(stored, original); assert.deepEqual(reviewed.history, original.history);
});
