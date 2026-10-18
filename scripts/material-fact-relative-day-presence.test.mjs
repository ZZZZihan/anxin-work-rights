import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OWN = fileURLToPath(new URL('../', import.meta.url));
const SOURCE = resolve(process.env.MATERIAL_FACT_TEST_ROOT || OWN);
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-relative-day-presence-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(SOURCE, 'lib'), resolve(temporary, 'lib'), { recursive: true });
// Only this round's parser is overlaid. The actual runtime and source review
// remain the integration baseline; no other money worktree WIP is imported.
await copyFile(resolve(OWN, 'lib/material-money-v4.ts'), resolve(temporary, 'lib/material-money-v4.ts'));
const load = name => import(pathToFileURL(resolve(temporary, 'lib', name)).href);
const { classifyMonetaryExpression } = await load('material-money-v4.ts');
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState } = await load('material-facts-v3.ts');

function ingest(value) {
  const source = { id: 'relative-day-presence-synthetic', name: '合成相对日工资描述', sha256: 'b'.repeat(64), analysisRevision: 1, ready: true,
    blocks: [{ id: 'b1', page: 1, text: `😀王甲的${value}。`, bbox: null, confidence: null }] };
  const representation = { kind: 'money', value, quote: value, blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'arrears',
    completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [representation] }), before = structuredClone(source);
  const state = ingestRuntimeCandidates(emptyFactState(1), source, { raw }, 'synthetic', 'audit', '2026-10-18T00:00:00.000Z');
  assert.deepEqual(source, before); assert.equal(state.materials[0].raw, raw);
  return { material: state.materials[0], raw, representation };
}

for (const value of ['今日工资', '当日工资', '昨日工资', '当天工资']) {
  test(`reported no-amount day description is positively classified: ${value}`, () => {
    const classification = classifyMonetaryExpression(value);
    assert.equal(classification.kind, 'not_monetary');
    assert.equal(classification.normalization.status, 'not_money'); assert.equal(classification.normalization.rawValue, value);
    assert.equal(classification.normalization.amount, null); assert.equal(classification.normalization.span, null);
  });
  test(`reported no-amount day description is rejected with its raw evidence retained: ${value}`, () => {
    const { material } = ingest(value);
    assert.equal(material.candidates.length, 0);
    assert.equal(material.rejected.length, 1); assert.equal(material.rejected[0].index, 0);
    assert.match(material.rejected[0].reason, /没有金额表达/u);
  });
}

const days = ['今天', '昨天', '明日', '明天', '前日', '前天', '后日', '后天', '本日', '该日', '这日', '这天', '那日', '那天',
  '次日', '翌日', '同日', '前一日', '前一天', '后一日', '后一天', '上一日', '上一天', '下一日', '下一天', '这一天', '那一天', '同一天'];
for (const day of days) test(`finite relative day requires a complete amount-free wage description: ${day}`, () => {
  for (const description of ['工资', '的工资', '基本工资合计', '其他工资总额', '劳务费', '劳动报酬']) {
    const value = day + description, classification = classifyMonetaryExpression(value), { material } = ingest(value);
    assert.equal(classification.kind, 'not_monetary', value); assert.equal(classification.normalization.rawValue, value);
    assert.equal(classification.normalization.amount, null); assert.equal(material.candidates.length, 0, value);
    assert.equal(material.rejected.length, 1, value);
  }
});

for (const value of ['每日工资', '每天工资', '日工资', '某日工资', '该天工资']) {
  test(`a complete daily wage label without a value is also non-monetary: ${value}`, () => {
    const classification = classifyMonetaryExpression(value), { material } = ingest(value);
    assert.equal(classification.kind, 'not_monetary'); assert.equal(classification.normalization.rawValue, value);
    assert.equal(classification.normalization.amount, null);
    assert.equal(material.candidates.length, 0); assert.equal(material.rejected.length, 1);
  });
}

for (const [value, kind, status] of [
  ['今日工资金额不详', 'monetary', 'masked'], ['当日工资xxx', 'monetary', 'masked'], ['昨日工资未明确', 'monetary', 'masked'],
  ['翌日工资金额待定', 'monetary', 'masked'], ['当天工资金额另议', 'undetermined', null], ['该日工资若干', 'undetermined', null],
  ['次日工资待核', 'undetermined', 'uncertain'], ['今日工资约1000元', 'monetary', 'approximate'],
  ['昨日工资1000元至2000元', 'monetary', 'range'], ['当天工资1000', 'undetermined', null],
  ['翌日工资一千', 'undetermined', null], ['今日工资标准待定', 'monetary', 'masked'],
  ['近日工资', 'undetermined', null], ['近几日工资', 'undetermined', null], ['工作日工资', 'undetermined', null],
  ['每日工资金额不详', 'monetary', 'masked'], ['每天工资若干', 'undetermined', null], ['日工资约1000元', 'monetary', 'approximate'],
  ['某日工资1000元至2000元', 'monetary', 'range'], ['该天工资金额另议', 'undetermined', null],
]) test(`uncertain, qualified or unrecognized input is retained: ${value}`, () => {
  const classification = classifyMonetaryExpression(value);
  assert.equal(classification.kind, kind); assert.equal(classification.normalization.rawValue, value);
  if (status) assert.equal(classification.normalization.status, status);
  assert.equal(classification.normalization.amount, null);
  const { material, representation } = ingest(value);
  assert.equal(material.candidates.length, 1); assert.equal(material.rejected.length, 0);
  assert.deepEqual(material.candidates[0].representation, representation); assert.equal(material.candidates[0].amount, null);
});

for (const [value, amount] of [['今日工资1000元', '1000.00'], ['当日基本工资四万元', '40000.00'], ['昨日工资0元', '0.00'], ['当天工资两千元', '2000.00'],
  ['每日工资1000元', '1000.00'], ['每天工资0元', '0.00'], ['日工资四万元', '40000.00'], ['某日工资1000元', '1000.00'], ['该天工资两千元', '2000.00']]) {
  test(`an actual amount in a day-qualified value remains monetary: ${value}`, () => {
    const classification = classifyMonetaryExpression(value);
    assert.equal(classification.kind, 'monetary'); assert.equal(classification.normalization.status, 'exact');
    assert.equal(classification.normalization.amount, amount); assert.equal(classification.normalization.rawValue, value);
    // Source rate semantics are reviewed separately. This gate must still admit
    // the literal, without claiming the unpatched source guard has been fixed.
    const { material, representation } = ingest(value);
    assert.equal(material.candidates.length, 1); assert.equal(material.rejected.length, 0);
    assert.deepEqual(material.candidates[0].representation, representation);
  });
}

test('existing month/stage descriptions remain positively non-monetary', () => {
  for (const value of ['这个月工资', '下一个月的工资', '2024年7月基本工资', '离职前工资', '试用期劳务费'])
    assert.equal(classifyMonetaryExpression(value).kind, 'not_monetary', value);
});
