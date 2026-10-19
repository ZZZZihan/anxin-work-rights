import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Non-implementer review of the shared lexical/classification change. Synthetic
// evidence only; this script neither reads frozen cases nor sends requests.
const ROOT = resolve(process.env.V7_REVIEW_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = name => import(pathToFileURL(resolve(ROOT, 'lib', name)).href);
const { classifyMonetaryExpression: classify, normalizeMoneyValueV4: money } = await load('material-money-v4.ts');
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates } = await load('material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('material-fact-source-review.ts');
const cp = text => Array.from(text).length;
for (const name of ['material-money-v4.ts', 'material-fact-currency-review.ts', 'material-fact-source-review.ts', 'material-fact-runtime-ingest.ts'])
  console.log(JSON.stringify({ file: 'lib/' + name, sha256: createHash('sha256').update(await readFile(resolve(ROOT, 'lib', name))).digest('hex') }));

function fixture(value, expression = value) {
  const prefix = '😀𠮷王甲记载';
  const source = { id: 'round13-classifier-review', name: 'synthetic-lexical-review', sha256: 'b'.repeat(64), analysisRevision: 13, ready: true,
    blocks: [{ id: 'b1', page: 1, text: prefix + expression + '。', bbox: null, confidence: null }] };
  const candidate = { kind: 'money', value, quote: value, blockId: 'b1', subject: '王甲', scope: 'individual',
    meaning: 'arrears', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [candidate] });
  return { source, candidate, raw, prefix };
}
function ingest(f, old = false) {
  const before = structuredClone(f.source);
  const state = (old ? ingestCandidates : ingestRuntimeCandidates)(emptyFactState(13), f.source, { raw: f.raw }, 'round13-cross-review', 'synthetic', '2026-10-18T00:00:00Z');
  assert.equal(state.materials[0].raw, f.raw);
  assert.deepEqual(JSON.parse(state.materials[0].raw).candidates, [f.candidate]);
  assert.deepEqual(f.source, before);
  assert.deepEqual(state.confirmations, { due: null, paid: null });
  assert.equal(state.calculation, null);
  return state;
}
function retained(f, amount = null) {
  const material = ingest(f).materials[0];
  assert.equal(material.candidates.length, 1);
  const fact = material.candidates[0];
  assert.equal(fact.amount, amount);
  assert.deepEqual(fact.representation, f.candidate);
  assert.equal(fact.start, cp(f.prefix));
  assert.equal(fact.end, cp(f.prefix + f.candidate.quote));
}

for (const value of ['5分钟', '五分鐘', '伍分米', '两分贝', '二分貝', '5角度', '５分钟', '5分\u200d鐘', '5 角 度', '5分\n钟'])
  test('a complete definite measurement count is rejected without losing raw evidence: ' + JSON.stringify(value), () => {
    const classification = classify(value);
    assert.equal(classification.kind, 'not_monetary');
    assert.equal(classification.normalization.rawValue, value);
    assert.equal(classification.normalization.status, 'not_money');
    assert.equal(classification.normalization.amount, null);
    const f = fixture(value), material = ingest(f).materials[0];
    assert.equal(material.candidates.length, 0);
    assert.equal(material.rejected.length, 1);
  });

for (const value of ['十万分红', '三万分紅', '5分红', '五万分摊', '十万分攤', '五万分配', '5分期', '5分量', '5角标', '5角色'])
  test('a financial or other non-measurement word is not proof of no amount: ' + value, () => {
    assert.notEqual(classify(value).kind, 'not_monetary');
    assert.equal(money(value).amount, null);
    retained(fixture(value));
  });

for (const value of ['5分', '五角', '零分', '〇角', '伍分', '两角', '五分工资', '5分钱', '5分之后', '5角工资',
  '约五分', '五角至六角', '五分至一元', '五分之一', '5分之K', '5分米?', '工资未知', '工资若干分', '工资金额另议',
  '5分米工资未知', '5分米工资另议', '5分米工资待核实', '5分米工资若干', '5分钟左右', '5分米至10分米', '2.5分钟',
  '5分公司工资', '5分米后欠薪未核算', '5角度图示另付工资'])
  test('real, unknown or longer wording remains reviewable with no invented amount: ' + value, () => {
    assert.notEqual(classify(value).kind, 'not_monetary');
    retained(fixture(value));
  });

for (const value of ['人民币5分米', '5分鐘另付6元', '5分米另付5元', '5分公司5角', '5分钟工资五分'])
  test('an ordinary-word prefix cannot reject a longer literal containing currency evidence: ' + value, () => {
    assert.notEqual(classify(value).kind, 'not_monetary');
    retained(fixture(value));
  });

for (const [value, amount] of [['5元五角', '5.50'], ['5元零五分', '5.05'], ['5元伍角贰分', '5.52'],
  ['人民币5元伍角', '5.50'], ['5圓五角', '5.50'], ['5元5分', '5.05']])
  test('the lexical gate retains whole genuine currency tokens: ' + value, () => {
    assert.equal(classify(value).kind, 'monetary');
    retained(fixture(value), amount);
  });

for (const word of ['分红', '分摊', '分配', '分期', '分公司', '分钟', '分米', '角色', '角膜'])
  test('the broader source cent-word boundary still protects cropped current and historical values: ' + word, () => {
    const token = word.startsWith('分') ? '5元5分' : '5元5角';
    const f = fixture(token, token + word.slice(1));
    retained(f);
    const old = ingest(f, true), fact = old.materials[0].candidates[0];
    assert.equal(old.materials[0].candidates.length, 1);
    Object.assign(fact, { amount: money(token).amount, normalization: money(token) });
    const before = structuredClone(old), reviewed = reviewFactsAgainstSources(old, [f.source]);
    assert.equal(reviewed.materials[0].candidates[0].amount, null);
    assert.equal(reviewed.materials[0].raw, f.raw);
    assert.deepEqual(old, before);
  });

test('a valid cent followed by 之后 is not rejected as 分之 arithmetic or a word fragment', () => {
  retained(fixture('5元5分', '5元5分之后离开'), '5.05');
});
