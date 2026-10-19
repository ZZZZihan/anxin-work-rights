import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = resolve(process.env.MATERIAL_FACT_TEST_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const load = name => import(pathToFileURL(resolve(ROOT, 'lib', name)).href);
const { classifyMonetaryExpression } = await load('material-money-v4.ts');
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState } = await load('material-facts-v3.ts');
function run(value) {
  const text = `😀王甲记录${value}。`;
  const source = { id: 'lexical-subunit', name: '合成普通词语', sha256: 'b'.repeat(64), ready: true, analysisRevision: 1,
    blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
  const representation = { kind: 'money', value, quote: value, blockId: 'b1', subject: '王甲', scope: 'individual',
    meaning: 'arrears', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [representation] });
  const sourceBefore = structuredClone(source);
  const state = ingestRuntimeCandidates(emptyFactState(1), source, { raw }, 'synthetic', 'audit', '2026-10-18T00:00:00Z');
  assert.equal(state.materials[0].raw, raw);
  assert.deepEqual(source, sourceBefore);
  assert.deepEqual(state.confirmations, { due: null, paid: null });
  assert.equal(state.calculation, null);
  return state.materials[0];
}
const words = ['分钟', '分鐘', '分米', '分贝', '分貝', '角度'];
for (const word of words) test(`complete ordinary count is not an amount: 5${word}`, () => {
  const value = `5${word}`, classification = classifyMonetaryExpression(value), material = run(value);
  assert.equal(classification.kind, 'not_monetary');
  assert.equal(classification.normalization.status, 'not_money');
  assert.equal(classification.normalization.rawValue, value);
  assert.equal(classification.normalization.amount, null);
  assert.equal(material.candidates.length, 0);
  assert.equal(material.rejected.length, 1);
  assert.match(material.rejected[0].reason, /没有金额表达/u);
});
for (const value of ['五分鐘', '伍分米', '５角度', '5分\u200d鐘', '5分\n钟', '5 角 度']) test(`detection folding preserves original evidence: ${JSON.stringify(value)}`, () => {
  const classification = classifyMonetaryExpression(value);
  assert.equal(classification.kind, 'not_monetary');
  assert.equal(classification.normalization.rawValue, value);
  assert.equal(run(value).rejected.length, 1);
});
for (const value of ['5分', '5角', '五分工资', '5分之后', '5角工资', '5元五角', '人民币5分米', '5分鐘另付6元',
  '工资未知', '工资xxx', '5分米工资未知']) test(`real currency or unknown amount is not rejected as a complete count: ${value}`, () => {
  assert.notEqual(classifyMonetaryExpression(value).kind, 'not_monetary');
  assert.equal(run(value).candidates.length, 1);
});
for (const value of ['5分之一', '5分之K', '5角度图示另付工资', '5分米后欠薪未核算']) test(`incomplete or complex wording is retained without invented amount: ${value}`, () => {
  const material = run(value);
  assert.equal(material.candidates.length, 1);
  assert.equal(material.candidates[0].amount, null);
});

for (const value of ['十万分红', '三万分红', '5分配', '5分摊', '5分期', '5分批', '5角色', '5分数', '5分公司']) test(`a lexical cent exclusion is not proof of a definite non-amount: ${value}`, () => {
  assert.equal(classifyMonetaryExpression(value).kind, 'undetermined');
  const material = run(value);
  assert.equal(material.candidates.length, 1);
  assert.equal(material.rejected.length, 0);
  assert.equal(material.candidates[0].amount, null);
});
