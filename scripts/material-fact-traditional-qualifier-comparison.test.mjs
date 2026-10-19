// Synthetic parser, comparison-key and runtime fixtures; no model or frozen data.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OWN = fileURLToPath(new URL('../', import.meta.url));
const BASE = resolve(process.env.MATERIAL_FACT_TEST_ROOT || OWN);
const MONEY = resolve(process.env.MATERIAL_FACT_MONEY_ROOT || OWN, 'lib/material-money-v4.ts');
const ASSESS = resolve(process.env.MATERIAL_FACT_ASSESS_FILE || resolve(BASE, 'experiments/material-facts-v7/assess.mjs'));
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-traditional-qualifier-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(BASE, 'lib'), resolve(temporary, 'lib'), { recursive: true });
await cp(MONEY, resolve(temporary, 'lib/material-money-v4.ts'));
await mkdir(resolve(temporary, 'experiments/material-facts-v7'), { recursive: true });
await cp(ASSESS, resolve(temporary, 'experiments/material-facts-v7/assess.mjs'));
console.log(JSON.stringify({ money_sha256: createHash('sha256').update(await readFile(MONEY)).digest('hex') }));
const load = file => import(pathToFileURL(resolve(temporary, 'lib', file)).href);
const { normalizeMoneyValueV4: money, normalizeCandidateValueV4: normalize, canonicalMonetaryExpression: canonical,
  classifyMonetaryExpression: classify } = await load('material-money-v4.ts');
const { ingestRuntimeCandidates: ingest } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy } = await load('material-facts-v3.ts');
const { reviewFactsAgainstSources: review } = await load('material-fact-source-review.ts');
const { validateLabel, assessCase } = await import(pathToFileURL(resolve(temporary, 'experiments/material-facts-v7/assess.mjs')).href);
const length = text => Array.from(text).length;
const AT = '2026-10-18T00:00:00Z';

function runtime(value, expression, style, expected, options = {}) {
  const text = `😀𠮷。王甲工资${expression}。`;
  const source = { id: 'synthetic-traditional-qualifier', name: '合成繁体金额与上下界材料', sha256: 'b'.repeat(64),
    analysisRevision: 1, ready: true, blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
  const representation = { kind: 'money', value, quote: style === 'full' ? text : value, blockId: 'b1', subject: '王甲',
    scope: 'individual', meaning: options.rateUnit ? 'rate' : 'arrears', completeness: 'not_applicable', period: null,
    rateUnit: options.rateUnit || null, assertion: 'narrated' };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [representation] });
  const beforeSource = structuredClone(source);
  const state = ingest(emptyFactState(1), source, { raw }, 'synthetic', 'author', AT);
  const material = state.materials[0];
  assert.equal(material.raw, raw); assert.equal(material.candidates.length, 1); assert.equal(material.rejected.length, 0);
  const fact = material.candidates[0];
  assert.equal(fact.amount, expected); assert.equal(fact.normalization.rawValue, value);
  assert.deepEqual(fact.representation, representation); assert.equal(fact.value, value); assert.equal(fact.quote, representation.quote);
  const start = length(text.slice(0, text.indexOf(representation.quote)));
  assert.equal(fact.start, start); assert.equal(fact.end, start + length(representation.quote));
  assert.deepEqual(source, beforeSource); assert.equal(state.calculation, null);
  assert.deepEqual(state.confirmations, { due: null, paid: null });
  const original = structuredClone(state);
  const view = review(state, [source]);
  assert.equal(view.materials[0].candidates[0].amount, expected); assert.equal(view.materials[0].raw, raw);
  assert.deepEqual(state, original); assert.deepEqual(view.history, state.history);
  if (expected === null) {
    // An obsolete exact record must be constrained on read, not rewritten.
    const stored = legacy(emptyFactState(1), source, { raw }, 'synthetic', 'author', AT);
    const old = stored.materials[0].candidates[0]; assert(old);
    old.amount = '40000.00';
    old.normalization = { rawValue: value, status: 'exact', amount: '40000.00', matchedText: value,
      span: { start: 0, end: length(value) }, reason: 'Synthetic obsolete exact amount' };
    const snapshot = structuredClone(stored);
    assert.equal(review(stored, [source]).materials[0].candidates[0].amount, null);
    assert.deepEqual(stored, snapshot);
  }
}

const literals = [
  ['兩億元', '200000000.00'], ['两億元', '200000000.00'], ['兩亿元', '200000000.00'], ['二億圓', '200000000.00'],
  ['人民幣兩萬圓', '20000.00'], ['人民幣兩萬圓整', '20000.00'], ['四億圓', '400000000.00'], ['4億圓', '400000000.00'],
  ['4.5億圓', '450000000.00'], ['兩億零三萬零五圓', '200030005.00'], ['一千兩百元', '1200.00'],
  ['兩萬圓兩角兩分', '20000.22'], ['4億圓5角2分', null], ['兩角', null], ['兩萬圓零兩分', '20000.02'],
  ['四億圓五角六分', '400000000.56'], ['肆億圓', '400000000.00'], ['￥4億圓', '400000000.00'],
];
for (const [value, expected] of literals) test(`finite traditional aliases preserve whole evidence: ${value}`, () => {
  const result = money(value);
  assert.equal(result.rawValue, value); assert.equal(result.amount, expected);
  if (expected !== null) {
    assert.equal(result.status, 'exact'); assert.equal(result.matchedText, value);
    assert.deepEqual(result.span, { start: 0, end: length(value) });
    assert.equal(canonical(value), `exact:${expected}`); assert.equal(classify(value).kind, 'monetary');
  } else assert.notEqual(result.status, 'exact');
});
for (const [value, expected] of [['人民幣兩萬圓', '20000.00'], ['兩億圓', '200000000.00'], ['四億圓', '400000000.00'], ['4億圓', '400000000.00'], ['兩萬圓兩角兩分', '20000.22']]) {
  for (const style of ['full', 'crop']) test(`fresh/read raw and CP remain original: ${value}, ${style}`, () => runtime(value, value, style, expected));
}
test('traditional aliases do not change astral code-point positions inside a whole value', () => {
  const raw = '😀𠮷。王甲收到人民幣兩萬圓。', result = money(raw);
  assert.equal(result.amount, '20000.00'); assert.equal(result.rawValue, raw);
  assert.equal(result.matchedText, '人民幣兩萬圓');
  const start = length(raw.slice(0, raw.indexOf(result.matchedText)));
  assert.deepEqual(result.span, { start, end: start + length(result.matchedText) });
});

const prefixes = ['不得少于', '不得低于', '不得超过', '不得高于', '不超过', '不少于', '不低于', '不高于', '不多于', '不大于', '不小于',
  '不满', '未满', '低于', '高于', '多达', '少于', '多于', '大于', '小于', '未达', '大约', '约', '将近', '接近', '逾',
  '不到', '不止', '超过', '不足', '至少', '至多', '上限', '下限', '最高', '最低', '近'];
for (const prefix of prefixes) test(`canonical key covers a shared finite prefix without exact amount: ${prefix}`, () => {
  const key = canonical(`${prefix}四万元`);
  assert.equal(money(`${prefix}四万元`).status, 'approximate'); assert.equal(money(`${prefix}四万元`).amount, null);
  assert.equal(key, `approximate:${prefix}:40000.00:`);
  assert.equal(key, canonical(`${prefix}40000元`)); assert.notEqual(key, canonical('四万元'));
});
const suffixes = ['不到', '不止', '不足', '不满', '未满', '未达', '开外', '左右', '上下', '以上', '以下', '以内', '以外',
  '封顶', '出头', '有余', '多', '余', '起', '许'];
for (const suffix of suffixes) test(`canonical key covers a shared finite suffix and retains its position: ${suffix}`, () => {
  const key = canonical(`四万元${suffix}`);
  assert.equal(money(`四万元${suffix}`).status, 'approximate'); assert.equal(money(`四万元${suffix}`).amount, null);
  assert.equal(key, `approximate::40000.00:${suffix}`);
  assert.equal(key, canonical(`40000元${suffix}`)); assert.notEqual(key, canonical('四万元'));
});
test('upper/lower, strict/non-strict, uncertain, prefix/suffix and exact keys remain distinct', () => {
  const forms = ['四万元', '不满四万元', '低于四万元', '高于四万元', '不少于四万元', '不超过四万元', '至少四万元',
    '四万元不到', '四万元以下', '四万元以上', '四万元开外', '可能四万元'];
  const keys = forms.map(canonical);
  assert(keys.every(Boolean)); assert.equal(new Set(keys).size, forms.length);
});
for (const [a, b] of [['不滿人民幣兩萬圓', '不满人民币两万元'], ['低於四萬元', '低于40000元'],
  ['四萬元開外', '40000元开外'], ['不\u200d滿 四萬圓', '不满40000元'], ['四万圓不\u200d到', '40000元不到']])
  test(`comparison-only folded aliases remain equivalent, never calculable: ${a}`, () => {
    assert.equal(money(a).amount, null); assert.equal(canonical(a), canonical(b)); assert(canonical(a));
  });
for (const expression of ['不满四万元', '低于40000元', '四万元不到', '40000元开外']) {
  const value = expression.includes('四万元') ? '四万元' : '40000元';
  for (const style of ['full', 'crop']) test(`boundary source/history stays unavailable: ${expression}, ${style}`, () => runtime(value, expression, style, null));
}
function comparisonFixture(prefix, suffix) {
  const value = `${prefix}四万元${suffix}`, equivalent = `${prefix}40000元${suffix}`;
  const text = `王甲工资${value}，另一个写法为${equivalent}。`;
  const source = { id: 'synthetic-key-comparison', name: 'synthetic', sha256: 'd'.repeat(64), analysisRevision: 1, ready: true,
    blocks: [{ id: 'b1', text, page: 1, bbox: null, confidence: null }] };
  const candidate = current => ({ kind: 'money', value: current, quote: current, blockId: 'b1', subject: '王甲', scope: 'individual',
    meaning: 'arrears', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' });
  const anchors = [value, equivalent].map(current => {
    const start = length(text.slice(0, text.indexOf(current)));
    return { blockId: 'b1', start, end: start + length(current) };
  });
  return { input: { id: 'synthetic-key-comparison', source }, label: { id: 'synthetic-key-comparison', expected: [candidate(value)],
    expected_event_ids: ['same-stated-bound'], events: [{ id: 'same-stated-bound', anchors }] },
  result: { id: 'synthetic-key-comparison', finish_reason: 'stop', raw_output: JSON.stringify({ schemaVersion: 3, candidates: [candidate(equivalent)] }) } };
}
for (const [prefix, suffix] of [['不满', ''], ['低于', ''], ['', '不到'], ['', '开外']]) {
  test(`gold label remains valid via existing literal fallback, no invented validation failure: ${prefix}/${suffix}`, () => {
    const f = comparisonFixture(prefix, suffix);
    assert.doesNotThrow(() => validateLabel(f.input, f.label));
  });
  test(`same-event numeric spellings match the same bound: ${prefix}/${suffix}`, () => {
    const f = comparisonFixture(prefix, suffix), scored = assessCase(f.input, f.label, f.result);
    for (const mode of ['raw_basic', 'accepted_basic', 'raw_relational', 'accepted_relational', 'raw_strict', 'accepted_strict']) {
      assert.equal(scored[mode].tp, 1); assert.equal(scored[mode].fp, 0); assert.equal(scored[mode].fn, 0);
    }
    assert(scored.production_defense.every(row => row.amount === null && row.calculation_authorized === false));
  });
}
for (const suffix of ['工資', '勞務費', '勞動報酬', '工资', '劳务费', '劳动报酬']) {
  test(`only the existing finite wage wrappers may follow a traditional bound: ${suffix}`, () => {
    const value = `不滿四萬元${suffix}`;
    assert.equal(canonical(value), canonical('不满40000元')); assert(canonical(value));
    assert.equal(money(value).amount, null);
    const text = `王甲工资${value}。`, start = length(text.slice(0, text.indexOf(value)));
    const base = { kind: 'money', quote: value, blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'arrears',
      completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
    const input = { id: 'synthetic-finite-wrapper', source: { id: 'synthetic-finite-wrapper', name: 'synthetic', sha256: 'f'.repeat(64),
      analysisRevision: 1, ready: true, blocks: [{ id: 'b1', text, page: 1, bbox: null, confidence: null }] } };
    const label = { id: input.id, expected: [{ ...base, value: '不滿四萬元' }], expected_event_ids: ['one-bound'],
      events: [{ id: 'one-bound', anchors: [{ blockId: 'b1', start, end: start + length('不滿四萬元') }] }] };
    const result = { id: input.id, finish_reason: 'stop', raw_output: JSON.stringify({ schemaVersion: 3, candidates: [{ ...base, value }] }) };
    const scored = assessCase(input, label, result);
    for (const mode of ['raw_basic', 'accepted_basic', 'raw_relational', 'accepted_relational', 'raw_strict', 'accepted_strict']) {
      assert.equal(scored[mode].tp, 1); assert.equal(scored[mode].fp, 0); assert.equal(scored[mode].fn, 0);
    }
    assert(scored.production_defense.every(row => row.amount === null && row.calculation_authorized === false));
  });
}
for (const value of ['不滿四萬元工資另付', '不滿四萬元勞務費和補償', '不滿四萬元勞動報酬另計', '不滿四萬元補償', '工資不滿四萬元', '不滿四萬元工資工資'])
  test(`finite wrappers do not consume arbitrary or repeated narrative: ${value}`, () => assert.equal(canonical(value), null));
for (const expression of ['四万元至五万元', '不满四万元至六万元', '四万元至五万元开外', '兩萬圓至四萬圓', '兩億圓至四億圓',
  '40000元到不满50000元', '介于四万元和五万元之间']) test(`real ranges never acquire an exact or comparison amount: ${expression}`, () => {
  assert.equal(money(expression).amount, null); assert.equal(canonical(expression), null);
});
for (const [value, expression] of [['兩萬圓', '兩萬圓至四萬圓'], ['四萬圓', '兩萬圓至四萬圓'],
  ['兩億圓', '兩億圓至四億圓'], ['四億圓', '兩億圓至四億圓']])
  for (const style of ['full', 'crop']) test(`traditional range endpoint remains unavailable: ${value}, ${style}`, () => runtime(value, expression, style, null));
for (const value of ['兩十元', '二十兩元', '一萬億元', '一億一元', '一万億元', '一万兩億元', '四億圓五角六分七分',
  '兩萬圓美元', '港幣兩萬圓', '四億圓的二倍', '四萬元以内另付五千元', '工资不满四万元', '不满四万元奖金'])
  test(`aliases and key parsing do not guess invalid/foreign/complex expressions: ${value}`, () => {
    assert.equal(money(value).amount, null); assert.equal(canonical(value), null);
  });
test('correct rate declaration remains exact, wrong total declaration stays unavailable', () => {
  const base = { kind: 'money', value: '兩萬圓', quote: '王甲月工资兩萬圓', blockId: 'b1', subject: '王甲', scope: 'individual',
    meaning: 'rate', completeness: 'not_applicable', period: null, rateUnit: 'month', assertion: 'narrated' };
  assert.equal(normalize(base).amount, '20000.00');
  assert.equal(normalize({ ...base, quote: '王甲工资兩萬圓/月', meaning: 'arrears', rateUnit: null }).amount, null);
});
test('historically unsupported traditional spelling is not silently upgraded on read', () => {
  const value = '人民幣兩萬圓', text = `王甲工资${value}。`;
  const source = { id: 'synthetic-old-unsupported', name: 'synthetic', sha256: 'c'.repeat(64), analysisRevision: 1, ready: true,
    blocks: [{ id: 'b1', text, page: 1, bbox: null, confidence: null }] };
  const representation = { kind: 'money', value, quote: value, blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'arrears',
    completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [representation] });
  const stored = legacy(emptyFactState(1), source, { raw }, 'synthetic', 'author', AT);
  assert.equal(stored.materials[0].candidates[0].amount, null);
  const before = structuredClone(stored);
  assert.equal(review(stored, [source]).materials[0].candidates[0].amount, null);
  assert.deepEqual(stored, before);
});
