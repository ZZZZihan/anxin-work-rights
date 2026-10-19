// ROUND33 synthetic module checks: no model, HTTP, scorer or historical CLI.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OWN = fileURLToPath(new URL('../', import.meta.url));
const BASE = resolve(process.env.MATERIAL_FACT_TEST_ROOT || OWN);
const PATCH = resolve(process.env.MATERIAL_FACT_PATCH_ROOT || OWN);
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-round33-postfix-currency-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(BASE, 'lib'), resolve(temporary, 'lib'), { recursive: true });
await cp(resolve(PATCH, 'lib/material-money-v4.ts'), resolve(temporary, 'lib/material-money-v4.ts'));
const load = file => import(pathToFileURL(resolve(temporary, 'lib', file)).href);
const { normalizeMoneyValueV4: parse, normalizeCandidateValueV4: normalize, canonicalMonetaryExpression: canonical } = await load('material-money-v4.ts');
const { ingestRuntimeCandidates, validateRuntimeCandidateOutput } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates, validateCandidateOutput } = await load('material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('material-fact-source-review.ts');
const AT = '2026-10-19T00:00:00.000Z';
const length = value => Array.from(value).length;

function fixture(expression, value = expression, { fullQuote = false, nextBlock = null } = {}) {
  const text = '😀王甲工资记载' + expression + (nextBlock === null ? '。' : '');
  const source = { id: 'round33-postfix-currency', name: '合成重复人民币标签', sha256: 'c'.repeat(64), analysisRevision: 1, ready: true,
    blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
  if (nextBlock !== null) source.blocks.push({ id: 'b2', page: 1, text: nextBlock + '。', bbox: null, confidence: null });
  const candidate = { kind: 'money', value, quote: fullQuote ? text : value, blockId: 'b1', subject: '王甲', scope: 'individual',
    meaning: 'other_money', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
  return { source, candidate, raw: JSON.stringify({ schemaVersion: 3, candidates: [candidate] }) };
}

function pipeline(f, amount) {
  const original = structuredClone(f);
  assert.equal(validateCandidateOutput(f.raw, f.source).candidates.length, 1, 'all eleven candidate fields and envelope are valid');
  assert.equal(validateRuntimeCandidateOutput(f.raw, f.source).candidates.length, 1, 'ambiguous money stays reviewable');
  const check = fact => {
    assert(fact); assert.equal(fact.amount, amount); assert.deepEqual(fact.representation, f.candidate);
    assert.equal(fact.value, f.candidate.value); assert.equal(fact.quote, f.candidate.quote);
    assert.equal(fact.normalization.rawValue, f.candidate.value);
    const text = f.source.blocks[0].text, start = length(text.slice(0, text.indexOf(f.candidate.quote)));
    assert.deepEqual([fact.start, fact.end], [start, start + length(f.candidate.quote)]);
    assert.equal(Array.from(text).slice(fact.start, fact.end).join(''), f.candidate.quote);
  };
  const fresh = ingestRuntimeCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'round33-author', AT);
  assert.equal(fresh.materials[0].raw, f.raw); check(fresh.materials[0].candidates[0]);
  assert.deepEqual(fresh.confirmations, { due: null, paid: null }); assert.equal(fresh.calculation, null);
  const history = ingestCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'round33-author', AT);
  const fact = history.materials[0].candidates[0]; assert(fact);
  fact.amount = amount ?? '4000.00'; fact.normalization = { rawValue: fact.value, status: 'exact', amount: fact.amount,
    matchedText: fact.value, span: { start: 0, end: length(fact.value) }, reason: 'Synthetic persisted exact amount.' };
  const stored = structuredClone(history), reviewed = reviewFactsAgainstSources(history, [f.source]);
  check(reviewed.materials[0].candidates[0]); assert.equal(reviewed.materials[0].raw, f.raw);
  assert.deepEqual(history, stored); assert.deepEqual(reviewed.history, stored.history);
  fact.amount = null; fact.normalization = { rawValue: fact.value, status: 'unsupported', amount: null,
    matchedText: null, span: null, reason: 'Synthetic stored unsupported; never auto-upgrade.' };
  const unavailable = structuredClone(history), rechecked = reviewFactsAgainstSources(history, [f.source]);
  assert.equal(rechecked.materials[0].candidates[0].amount, null); assert.deepEqual(history, unavailable);
  assert.deepEqual(rechecked.history, unavailable.history); assert.deepEqual(f, original);
}

const duplicates = [
  ['4000人民币人民币', '4000人民币'], ['4000元人民币CNY', '4000元'], ['4000人民幣人民幣', '4000人民幣'],
  ['4000RMB RMB', '4000RMB'], ['4000元CNY RMB', '4000元CNY'], ['四千元人民幣CNY', '四千元'],
  ['４０００元人民币 CNY', '４０００元'], ['4000元人民币人\u200d民幣', '4000元人民币'],
  ['4000元人民币\nCNY', '4000元人民币'], ['4000元整人民币CNY', '4000元'],
  ['5角2分RMB人民币', '5角2分RMB'], ['2分CNY人民币', '2分CNY'],
];
for (const [expression, value] of duplicates) {
  test('complete duplicate postfix currency is unavailable: ' + JSON.stringify(expression), () => {
    const raw = '😀' + expression;
    assert.equal(parse(raw).amount, null); assert.equal(parse(raw).rawValue, raw);
    assert.equal(canonical(expression), null); pipeline(fixture(expression), null);
  });
  for (const fullQuote of [false, true]) test('cropped value/quote cannot discard a second currency: ' + JSON.stringify({ expression, value, fullQuote }), () => {
    const f = fixture(expression, value, { fullQuote });
    assert.equal(normalize({ ...f.candidate, quote: f.source.blocks[0].text }).amount, null);
    pipeline(f, null);
  });
}

for (const layout of ['same', 'line', 'block']) for (const value of ['4000元', '4000元人民币']) for (const fullQuote of [false, true])
  test('full-source repeated markers remain attached across layout: ' + JSON.stringify({ layout, value, fullQuote }), () => {
    const expression = '4000元人民币' + (layout === 'same' ? 'CNY' : layout === 'line' ? '\nCNY' : '');
    pipeline(fixture(expression, value, { fullQuote, nextBlock: layout === 'block' ? 'CNY' : null }), null);
  });

for (const expression of ['4000元人民币人民币', '4000元人民幣RMB', '4000元RMB CNY'])
  test('a bare Arabic candidate cannot discard both postfix markers: ' + expression,
    () => pipeline(fixture(expression, '4000'), null));

const valid = [['4000元人民币', '4000.00'], ['4000人民币', '4000.00'], ['4000人民幣', '4000.00'], ['4000RMB', '4000.00'],
  ['4000CNY', '4000.00'], ['4000元整人民币', '4000.00'], ['四千元人民幣', '4000.00'], ['人民币4000元', '4000.00'],
  ['5角人民币', '0.50'], ['5角2分RMB', '0.52'], ['2分CNY', '0.02']];
for (const [expression, amount] of valid) test('one complete postfix/prefix currency remains valid: ' + expression, () => {
  const raw = '😀' + expression, parsed = parse(raw);
  assert.equal(parsed.amount, amount); assert.equal(parsed.rawValue, raw); assert.equal(canonical(expression), 'exact:' + amount);
  assert.equal(Array.from(raw).slice(parsed.span.start, parsed.span.end).join(''), parsed.matchedText);
  pipeline(fixture(expression), amount);
});

for (const tail of ['。人民币为结算币种', '，CNY为币种代码', '。王乙人民币说明', '人民币说明'])
  test('another clause or independent narration is not a duplicate marker: ' + tail, () => {
    // The final no-punctuation control has intervening prose between currencies.
    const expression = tail === '人民币说明' ? '4000元人民币工资人民币说明' : '4000元人民币' + tail;
    pipeline(fixture(expression, '4000元人民币'), '4000.00');
  });
test('another subject in the next block cannot attach a currency label', () =>
  pipeline(fixture('4000元人民币。', '4000元人民币', { nextBlock: '王乙使用CNY结算' }), '4000.00'));

for (const expression of ['人民币4000元人民币', '人民币5角CNY', '4000元人民币USD', '4000元人民币港币',
  '4000元人民币至5000元', '4000元人民币待定', '4000元人民币/月', '4000元人民币×2'])
  test('existing currency, range, unknown, rate and arithmetic guards remain unavailable: ' + expression, () => {
    assert.equal(normalize(fixture(expression).candidate).amount, null); pipeline(fixture(expression), null);
  });
