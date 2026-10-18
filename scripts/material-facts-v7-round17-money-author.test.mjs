import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OWN = fileURLToPath(new URL('../', import.meta.url));
const BASE = resolve(process.env.V7_ROUND17_BASE_ROOT || OWN);
const temp = await mkdtemp(resolve(tmpdir(), 'anxin-round17-money-author-'));
after(() => rm(temp, { recursive: true, force: true }));
await cp(resolve(BASE, 'lib'), resolve(temp, 'lib'), { recursive: true });
await mkdir(resolve(temp, 'experiments/material-facts-v7'), { recursive: true });
await cp(resolve(BASE, 'experiments/material-facts-v7/assess.mjs'), resolve(temp, 'experiments/material-facts-v7/assess.mjs'));
for (const [name, override] of [['lib/material-money-v4.ts', process.env.V7_ROUND17_MONEY_FILE], ['lib/material-fact-runtime-ingest.ts', process.env.V7_ROUND17_INGEST_FILE]]) {
  const file = resolve(override || resolve(OWN, name));
  await cp(file, resolve(temp, name));
  console.log(JSON.stringify({ file: name, sha256: createHash('sha256').update(await readFile(file)).digest('hex') }));
}
if (process.env.V7_ROUND17_DEPENDENCY_ROOT) for (const name of ['lib/material-fact-currency-review.ts', 'lib/material-fact-source-review.ts', 'experiments/material-facts-v7/assess.mjs']) {
  const file = resolve(process.env.V7_ROUND17_DEPENDENCY_ROOT, name);
  await cp(file, resolve(temp, name));
  console.log(JSON.stringify({ dependency: name, sha256: createHash('sha256').update(await readFile(file)).digest('hex') }));
}
const load = name => import(pathToFileURL(resolve(temp, name)).href);
const { normalizeMoneyValueV4: money, normalizeCandidateValueV4: normalize, classifyMonetaryExpression: classify, canonicalMonetaryExpression: canonical } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates: fresh } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources: review } = await load('lib/material-fact-source-review.ts');
const { assessCase } = await load('experiments/material-facts-v7/assess.mjs');
const cpLength = text => Array.from(text).length;
const entry = (value, quote = value) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'arrears', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' });
function fixture(text, candidates) {
  const source = { id: 'round17-author', name: 'synthetic money regression', sha256: 'f'.repeat(64), analysisRevision: 17, ready: true,
    blocks: [{ id: 'b1', page: 1, text: '😀𠮷王甲工资' + text, bbox: null, confidence: null }] };
  const raw = JSON.stringify({ schemaVersion: 3, candidates });
  return { source, raw, candidates };
}
function ingest(f, historical = false) {
  const before = structuredClone(f.source);
  const state = (historical ? legacy : fresh)(emptyFactState(17), f.source, { raw: f.raw }, 'round17-author', 'synthetic', '2026-10-18T00:00:00Z');
  assert.deepEqual(f.source, before); assert.equal(state.materials[0].raw, f.raw);
  assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
  for (const fact of state.materials[0].candidates) {
    const text = f.source.blocks[0].text;
    assert.equal(Array.from(text).slice(fact.start, fact.end).join(''), fact.quote);
    assert.deepEqual(fact.representation, f.candidates[Number(fact.id.split(':').at(-1))]);
  }
  return state;
}
const unitWords = [
  ['三元组', '三元'], ['五圆桌', '五圆'], ['十元宝', '十元'], ['六圆柱', '六圆'], ['八圆锥', '八圆'],
  ['九圆球', '九圆'], ['二圆筒', '二圆'], ['七圆盘', '七圆'], ['一圆弧', '一圆'], ['四圆环', '四圆'],
  ['三元組', '三元'], ['十元寶', '十元'], ['五圓桌', '五圓'], ['六圓柱', '六圓'], ['八圓錐', '八圓'],
  ['3元组', '3元'], ['5圆桌', '5圆'], ['三元\u200d组', '三元'], ['五圆\n桌', '五圆'],
];
for (const [literal, cropped] of unitWords) {
  test('a complete ordinary unit word cannot become exact RMB: ' + JSON.stringify(literal), () => {
    const normalized = money(literal);
    assert.equal(normalized.amount, null); assert.equal(normalized.rawValue, literal);
    assert(!canonical(literal)?.startsWith('exact:'));
  });
  test('a unique full quote keeps the ordinary word at a cropped unit boundary: ' + JSON.stringify(literal), () => {
    const f = fixture(literal + '。', [entry(cropped)]), raw = { ...f.candidates[0], quote: f.source.blocks[0].text };
    const before = structuredClone(raw), normalized = normalize(raw);
    assert.equal(normalized.amount, null); assert.equal(normalized.normalization.rawValue, cropped); assert.deepEqual(raw, before);
  });
  test('fresh source defense does not lend money to a cropped ordinary unit: ' + JSON.stringify(literal), () => {
    const f = fixture(literal + '。', [entry(cropped)]), state = ingest(f);
    assert.equal(state.materials[0].candidates.length, 1); assert.equal(state.materials[0].candidates[0].amount, null);
  });
  test('historical exact ordinary unit is downgraded without raw or state rewrite: ' + JSON.stringify(literal), () => {
    const f = fixture(literal + '。', [entry(cropped)]), state = ingest(f, true);
    const normalized = money(cropped);
    Object.assign(state.materials[0].candidates[0], { amount: normalized.amount ?? '3.00', normalization: normalized });
    const before = structuredClone(state), checked = review(state, [f.source]);
    assert.equal(checked.materials[0].candidates[0].amount, null); assert.equal(checked.materials[0].raw, f.raw); assert.deepEqual(state, before);
  });
}
for (const [value, expected] of [['三元工资', '3.00'], ['三元整', '3.00'], ['三元正', '3.00'], ['五元五角二分', '5.52'],
  ['三元人民币', '3.00'], ['三元人民幣', '3.00'], ['三元/月', '3.00'], ['三元组装费', '3.00'], ['三元組裝費', '3.00'], ['三元。另一人组队', '3.00']])
  test('real yuan suffixes and complete clause boundaries stay compatible: ' + value, () => {
    assert.equal(money(value).amount, expected); assert.equal(money(value).rawValue, value);
  });
const noAmount = ['拖欠工资', '欠付工资', '未付工资', '本期应付工资', '本期的应付工资', '本期未付工资', '2024年7月拖欠工资', '这个月欠付工资'];
for (const value of noAmount) {
  test('a complete wage or arrears label is definitely amount-free: ' + value, () => assert.equal(classify(value).kind, 'not_monetary'));
  test('amount-free arrears are rejected while preserving original raw: ' + value, () => {
    const f = fixture(value + '。', [entry(value)]), state = ingest(f);
    assert.equal(state.materials[0].candidates.length, 0); assert.equal(state.materials[0].rejected.length, 1);
  });
  test('all six score layers keep the rejected raw observation visible: ' + value, () => {
    const f = fixture(value + '。', [entry(value)]), input = { id: 'author-noamount', source: f.source };
    const row = assessCase(input, { expected: [], events: [], expected_event_ids: [], acceptable_alternatives: [] }, { raw_output: f.raw, finish_reason: 'stop', error: null });
    assert.equal(row.raw_count, 1); assert.equal(row.accepted_count, 0);
    for (const mode of ['basic', 'relational', 'strict']) {
      assert.equal(row['raw_' + mode].fp, 1); assert.equal(row['accepted_' + mode].fp, 0);
    }
  });
}
for (const value of ['拖欠工资不详', '欠付工资金额不详', '未付工资待核实', '本期应付工资未知', '本期应付工资***', '欠付工资另议', '工资若干', '拖欠工资约四万元', '未付工资三万元至四万元'])
  test('unknown, redacted, approximate and range wages are retained for review: ' + value, () => {
    assert.notEqual(classify(value).kind, 'not_monetary');
    const f = fixture(value + '。', [entry(value)]), state = ingest(f);
    assert.equal(state.materials[0].candidates.length, 1); assert.equal(state.materials[0].candidates[0].amount, null);
  });
for (const reverse of [false, true]) {
  test('the traditional RMB wrapper is deduplicated at its one proven occurrence: ' + reverse, () => {
    const values = reverse ? ['四万元', '人民幣四万元'] : ['人民幣四万元', '四万元'];
    const f = fixture('人民幣四万元。', values.map(value => entry(value))), state = ingest(f), material = state.materials[0];
    assert.equal(material.candidates.length, 1); assert.equal(material.rejected.length, 1); assert.equal(material.candidates[0].amount, '40000.00');
    assert.equal(material.candidates[0].value, values[0]); assert.equal(JSON.parse(material.raw).candidates.length, 2);
    const candidate = material.candidates[0], start = f.source.blocks[0].text.indexOf(values[0]);
    assert.equal(candidate.start, cpLength(f.source.blocks[0].text.slice(0, start)));
  });
  test('six score layers count one traditional-wrapper event in either order: ' + reverse, () => {
    const values = reverse ? ['四万元', '人民幣四万元'] : ['人民幣四万元', '四万元'];
    const f = fixture('人民幣四万元。', values.map(value => entry(value))), text = f.source.blocks[0].text;
    const start = cpLength(text.slice(0, text.indexOf('人民幣四万元'))), end = start + cpLength('人民幣四万元');
    const label = { expected: [entry('四万元', '人民幣四万元')], events: [{ id: 'e1', anchors: [{ blockId: 'b1', start, end }] }], expected_event_ids: ['e1'], acceptable_alternatives: [] };
    const row = assessCase({ id: 'wrapper-one-event', source: f.source }, label, { raw_output: f.raw, finish_reason: 'stop', error: null });
    for (const mode of ['basic', 'relational', 'strict']) {
      assert.equal(row['raw_' + mode].tp, 1); assert.equal(row['raw_' + mode].fp, 1); assert.equal(row['raw_' + mode].fn, 0);
      assert.equal(row['accepted_' + mode].tp, 1); assert.equal(row['accepted_' + mode].fp, 0); assert.equal(row['accepted_' + mode].fn, 0);
    }
  });
  test('two distinct occurrences with equal traditional-wrapper amounts remain two events: ' + reverse, () => {
    const phrases = ['首次支付人民幣四万元', '再次支付人民幣四万元'];
    const values = reverse ? ['四万元', '人民幣四万元'] : ['人民幣四万元', '四万元'];
    const candidates = phrases.flatMap(quote => values.map(value => entry(value, quote)));
    const f = fixture(phrases.join('，') + '。', candidates), state = ingest(f);
    assert.equal(state.materials[0].candidates.length, 2); assert.equal(state.materials[0].rejected.length, 2);
    assert.notEqual(state.materials[0].candidates[0].start, state.materials[0].candidates[1].start);
    const text = f.source.blocks[0].text;
    const anchors = phrases.map(phrase => { const i = text.indexOf(phrase) + phrase.indexOf('人民幣四万元'); return { blockId: 'b1', start: cpLength(text.slice(0, i)), end: cpLength(text.slice(0, i)) + cpLength('人民幣四万元') }; });
    const label = { expected: phrases.map(quote => entry('四万元', quote)), events: anchors.map((anchor, i) => ({ id: 'e' + i, anchors: [anchor] })), expected_event_ids: ['e0', 'e1'], acceptable_alternatives: [] };
    const row = assessCase({ id: 'wrapper-two-events', source: f.source }, label, { raw_output: f.raw, finish_reason: 'stop', error: null });
    for (const mode of ['basic', 'relational', 'strict']) {
      assert.equal(row['raw_' + mode].tp, 2); assert.equal(row['raw_' + mode].fp, 2); assert.equal(row['raw_' + mode].fn, 0);
      assert.equal(row['accepted_' + mode].tp, 2); assert.equal(row['accepted_' + mode].fp, 0); assert.equal(row['accepted_' + mode].fn, 0);
    }
  });
}
