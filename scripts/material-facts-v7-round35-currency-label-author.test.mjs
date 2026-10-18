// ROUND35 bounded currency labels; synthetic module checks, no HTTP/model/scorer.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OWN = fileURLToPath(new URL('../', import.meta.url));
const BASE = resolve(process.env.MATERIAL_FACT_TEST_ROOT || OWN);
const PATCH = resolve(process.env.MATERIAL_FACT_PATCH_ROOT || OWN);
const minimal = process.env.MATERIAL_FACT_TEST_MINIMAL === '1';
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-round35-currency-label-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(BASE, 'lib'), resolve(temporary, 'lib'), { recursive: true });
await cp(resolve(PATCH, 'lib/material-money-v4.ts'), resolve(temporary, 'lib/material-money-v4.ts'));
const load = file => import(pathToFileURL(resolve(temporary, 'lib', file)).href);
const { classifyMonetaryExpression: classify, normalizeMoneyValueV4: parse, canonicalMonetaryExpression: canonical } = await load('material-money-v4.ts');
const { emptyFactState, ingestCandidates, validateCandidateOutput, buildFactView } = await load('material-facts-v3.ts');
const { validateRuntimeCandidateOutput, ingestRuntimeCandidates } = await load('material-fact-runtime-ingest.ts');
const { reviewFactsAgainstSources } = await load('material-fact-source-review.ts');
const AT = '2026-10-19T00:00:00.000Z';

function fixture(value) {
  const source = { id: 'round35-label', name: '合成完整币种标签', sha256: 'a'.repeat(64), analysisRevision: 1, ready: true,
    blocks: [{ id: 'b1', page: 1, text: '😀王甲材料记载' + value + '。', bbox: null, confidence: null }] };
  const candidate = { kind: 'money', value, quote: value, blockId: 'b1', subject: '王甲', scope: 'individual',
    meaning: 'other_money', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
  return { source, candidate, raw: JSON.stringify({ schemaVersion: 3, candidates: [candidate] }) };
}

function rejectLabel(value) {
  const f = fixture(value), original = structuredClone(f), classification = classify(value);
  assert.equal(parse(value).amount, null); assert.equal(classification.kind, 'not_monetary');
  assert.equal(classification.normalization.status, 'not_money'); assert.equal(classification.normalization.rawValue, value);
  // All schema fields and source evidence are valid: rejection is the bounded semantic gate.
  assert.equal(validateCandidateOutput(f.raw, f.source).candidates.length, 1);
  const batch = validateRuntimeCandidateOutput(f.raw, f.source);
  assert.equal(batch.candidates.length, 0); assert.equal(batch.rejected.length, 1); assert.equal(batch.rejected[0].index, 0);
  assert.match(batch.rejected[0].reason, /没有金额表达/u);
  const fresh = ingestRuntimeCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'round35-author', AT);
  assert.equal(fresh.materials[0].raw, f.raw); assert.equal(fresh.materials[0].candidates.length, 0);
  assert.deepEqual(fresh.materials[0].rejected, batch.rejected); assert.equal(fresh.calculation, null);
  assert.deepEqual(fresh.confirmations, { due: null, paid: null });
  // Existing records stay present and unavailable; this gate does not erase stored extraction/history.
  const legacy = ingestCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'round35-author', AT);
  const stored = structuredClone(legacy), reviewed = reviewFactsAgainstSources(legacy, [f.source]);
  assert.equal(reviewed.materials[0].candidates.length, 1); assert.equal(reviewed.materials[0].candidates[0].amount, null);
  assert.equal(reviewed.materials[0].raw, f.raw); assert.deepEqual(legacy, stored); assert.deepEqual(reviewed.history, stored.history);
  assert.deepEqual(f, original);
}

const minimalLabels = ['人民币工资', '人民币薪资', '人民币金额', '￥工资'];
const currencies = ['人民币', '人民幣', 'RMB', 'CNY', '￥', '¥'];
const labels = ['工资', '薪资', '薪酬', '劳务费', '劳动报酬', '金额', '数额', '基本工资', '应付工资', '工资总额', '實付薪資總額', '勞務費標準'];
const emptyLabels = minimal ? minimalLabels : [...new Set([...minimalLabels, ...currencies.flatMap(c => labels.map(label => c + label)),
  '人民\u200d幣工\u200d資', 'ＲＭＢ 工资', '人民币\n工资', '￥ 基本工资'])];
for (const value of emptyLabels) test('complete currency plus empty label rejects only the observation: ' + JSON.stringify(value), () => rejectLabel(value));

if (!minimal) {
  const uncertain = currencies.flatMap(c => ['工资未知', '工资XX', '工资金额待定', '金额不詳', '金额？'].map(t => c + t));
  const prose = ['王甲人民币工资', '王甲人民币工资未知', '人民币工资王甲', '人民币工资说明', '人民币工资的',
    '人民币金额另议', '人民币工资50%', '人民币款项', '工资人民币', '人民币人民币工资', 'RMB工资CNY', '人民币港币工资'];
  for (const value of [...uncertain, ...prose]) test('unknown amounts and named or unrelated prose are retained: ' + JSON.stringify(value), () => {
    assert.notEqual(classify(value).kind, 'not_monetary');
    const f = fixture(value), fresh = ingestRuntimeCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'round35-author', AT);
    assert.equal(fresh.materials[0].raw, f.raw); assert.equal(fresh.materials[0].rejected.length, 0);
    assert.equal(fresh.materials[0].candidates.length, 1); assert.equal(fresh.calculation, null);
    const fact = fresh.materials[0].candidates[0]; assert.deepEqual(fact.representation, f.candidate);
    assert.equal(fact.amount, null); assert.equal(canonical(value), null);
    assert.equal(Array.from(f.source.blocks[0].text).slice(fact.start, fact.end).join(''), value);
    const view = buildFactView(fresh, [f.source]); assert.equal(view.canCalculate, false);
    assert.deepEqual(view.fields.due.values, []); assert.deepEqual(view.fields.paid.values, []);
    if (value === '王甲人民币工资') {
      assert.equal(fact.normalization.status, 'unsupported'); assert.match(fact.normalization.reason, /核对/u);
    }
  });
  const amounts = [['人民币工资4000元', '4000.00'], ['人民幣薪資四千圓', '4000.00'], ['RMB 4000', '4000.00'],
    ['CNY4000', '4000.00'], ['￥4000元', '4000.00'], ['人民币五角', '0.50'], ['人民币工资0元', '0.00'], ['人民币工资４０００元', '4000.00']];
  for (const [value, amount] of amounts) test('true amount stays monetary with original raw and source position: ' + value, () => {
    assert.equal(classify(value).kind, 'monetary'); assert.equal(parse(value).amount, amount);
    const f = fixture(value), fresh = ingestRuntimeCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'round35-author', AT);
    assert.equal(fresh.materials[0].raw, f.raw); assert.equal(fresh.materials[0].candidates.length, 1);
    const fact = fresh.materials[0].candidates[0]; assert.equal(fact.amount, amount); assert.equal(fact.normalization.rawValue, value);
    assert.deepEqual(fact.representation, f.candidate); assert.equal(Array.from(f.source.blocks[0].text).slice(fact.start, fact.end).join(''), value);
  });
  for (const value of ['人民币约4000元', '人民币4000元至5000元', '人民币4000元/月', '人民币4000元？', '人民币4000元乘以2'])
    test('uncertainty range rate and arithmetic remain unavailable: ' + value, () => {
      assert.notEqual(classify(value).kind, 'not_monetary'); const f = fixture(value);
      const fresh = ingestRuntimeCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'round35-author', AT);
      assert.equal(fresh.materials[0].candidates.length, 1); assert.equal(fresh.materials[0].candidates[0].amount, null);
      assert.equal(fresh.materials[0].raw, f.raw); assert.equal(fresh.calculation, null);
    });
  for (const value of ['工资', '应付工资', '拖欠工资', '这个月工资', '每日工资', '2024年7月工资', '50%', '五角星'])
    test('existing definite no-amount descriptions stay rejected: ' + value, () => rejectLabel(value));
}
