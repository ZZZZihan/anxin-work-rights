import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Synthetic money/source/read-time contracts. No model, HTTP or experiment data.
const OWN = fileURLToPath(new URL('../', import.meta.url));
const BASE = resolve(process.env.V7_ROUND18_BASE_ROOT || OWN);
const MONEY = resolve(process.env.V7_ROUND18_MONEY_FILE || resolve(OWN, 'lib/material-money-v4.ts'));
const temp = await mkdtemp(resolve(tmpdir(), 'anxin-round18-money-author-'));
after(() => rm(temp, { recursive: true, force: true }));
await cp(resolve(BASE, 'lib'), resolve(temp, 'lib'), { recursive: true });
await cp(MONEY, resolve(temp, 'lib/material-money-v4.ts'));
const dependencies = ['material-fact-currency-review.ts', 'material-fact-source-review.ts'];
if (process.env.V7_ROUND18_DEPENDENCY_ROOT) for (const name of dependencies)
  await cp(resolve(process.env.V7_ROUND18_DEPENDENCY_ROOT, 'lib', name), resolve(temp, 'lib', name));
for (const name of ['material-money-v4.ts', ...dependencies]) console.log(JSON.stringify({ file: name, sha256: createHash('sha256').update(await readFile(resolve(temp, 'lib', name))).digest('hex') }));
const load = name => import(pathToFileURL(resolve(temp, 'lib', name)).href);
const { normalizeMoneyValueV4: money, normalizeCandidateValueV4: normalize } = await load('material-money-v4.ts');
const { ingestRuntimeCandidates: fresh } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy } = await load('material-facts-v3.ts');
const { reviewFactsAgainstSources: review } = await load('material-fact-source-review.ts');
const cpLength = text => Array.from(text).length;
const entry = (value, quote = value, changes = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'arrears', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated', ...changes });
function fixture(value, expression = value, changes = {}) {
  const prefix = '😀𠮷王甲2026年1月工资为';
  const candidate = entry(value, value, changes);
  const source = { id: 'round18-author', name: '合成角分与费率', sha256: 'e'.repeat(64), analysisRevision: 18, ready: true, blocks: [{ id: 'b1', page: 1, text: prefix + expression + '。', bbox: null, confidence: null }] };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [candidate] });
  return { source, candidate, raw, prefix };
}
function ingest(f, historical = false) {
  const before = structuredClone(f.source);
  const state = (historical ? legacy : fresh)(emptyFactState(18), f.source, { raw: f.raw }, 'round18-author', 'synthetic', '2026-10-18T00:00:00Z');
  assert.deepEqual(f.source, before); assert.equal(state.materials[0].raw, f.raw);
  assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
  assert.equal(state.materials[0].candidates.length, 1);
  const fact = state.materials[0].candidates[0];
  assert.deepEqual(fact.representation, f.candidate);
  assert.equal(Array.from(f.source.blocks[0].text).slice(fact.start, fact.end).join(''), fact.quote);
  return state;
}
function unavailableHistory(f, amount = '40000.00') {
  const state = ingest(f, true), candidate = state.materials[0].candidates[0];
  const normalization = money(f.candidate.value);
  Object.assign(candidate, { amount, normalization: { ...normalization, rawValue: f.candidate.value, status: 'exact', amount } });
  const before = structuredClone(state), checked = review(state, [f.source]);
  assert.equal(checked.materials[0].candidates[0].amount, null);
  assert.deepEqual(state, before); assert.equal(checked.materials[0].raw, f.raw);
  assert.deepEqual(checked.materials[0].candidates[0].representation, f.candidate);
}
function exact(value, expected) {
  const normalized = money(value);
  assert.equal(normalized.status, 'exact'); assert.equal(normalized.amount, expected);
  assert.equal(normalized.rawValue, value); assert.equal(normalized.matchedText, value);
  assert.deepEqual(normalized.span, { start: 0, end: cpLength(value) });
  const embedded = money('😀𠮷工资' + value);
  assert.equal(embedded.amount, expected); assert.deepEqual(embedded.span, { start: 4, end: cpLength('😀𠮷工资' + value) });
  const f = fixture(value);
  assert.equal(normalize({ ...f.candidate, quote: f.source.blocks[0].text }).amount, expected);
  assert.equal(ingest(f).materials[0].candidates[0].amount, expected);
}

for (let jiao = 0; jiao <= 9; jiao++) {
  test('Chinese integer yuan with one ASCII jiao digit: ' + jiao, () => exact('五元' + jiao + '角', '5.' + jiao + '0'));
  test('Chinese integer yuan with ASCII jiao and fen digits: ' + jiao, () => exact('五元' + jiao + '角2分', '5.' + jiao + '2'));
}
for (const [value, expected] of [
  ['伍元5角2分', '5.52'], ['伍元五角2分', '5.52'], ['伍元5角贰分', '5.52'], ['壹拾贰元5角2分', '12.52'],
  ['人民币伍元5角2分', '5.52'], ['人民幣伍圓5角2分', '5.52'], ['￥伍元5角2分', '5.52'], ['伍元零5分', '5.05'],
  ['伍元0角2分', '5.02'], ['伍元整', '5.00'], ['伍元正', '5.00'],
  ['四元五角伍分', '4.55'], ['一千万元伍分', '10000000.05'], ['伍仟元五角', '5000.50'],
  ['五元五角2分', '5.52'], ['五元5角二分', '5.52'], ['五元伍角2分', '5.52'], ['五元5角贰分', '5.52'],
  ['五元0分', '5.00'], ['五元5分', '5.05'], ['五元零5分', '5.05'], ['零元零5分', '0.05'], ['两元2角2分', '2.22'],
  ['〇元5角', '0.50'], ['一千元5角2分', '1000.52'], ['四万元5角2分', '40000.52'],
  ['人民币五元5角2分', '5.52'], ['人民幣五圓5角2分', '5.52'], ['￥五元5角2分', '5.52'],
  ['五元5角2分整', '5.52'], ['五圆5角2分正', '5.52'], ['五元〇角2分', '5.02'], ['五元5角零分', '5.50'],
  ['九千九百九十九亿九千九百九十九万九千九百九十九元9角9分', '999999999999.99'],
]) test('complete mixed Chinese-yuan subunits retain their exact raw token: ' + value, () => exact(value, expected));

for (const value of [
  '五元55角', '五元十五角', '五元5角22分', '五元5角十二分', '五元五五角', '五元5分2角', '五元5角2角',
  '五元零零分', '五元零0分', '五元零〇分', '五元5角零2分', '五元〇5分', '五元整5角',
  '五元5角2分３', '五元5角2分3', '五点五元5角', '5.5元5角', '4万元5角',
  '壹仟壹元5角', '伍元5角零2分', '伍元伍角零贰分', '伍元零零分', '伍元零0分', '伍元5角22分',
  '伍元5分2角', '伍元5角2分元', '负伍元5角2分', '负五元5角2分', '+伍元5角2分',
  '壹万亿元5角2分', '一万亿元5角2分', '五元5角2分另有300', '五元5角2分和六元5角', '五元5角至六元5角', '约五元5角', '五元5角余',
  '五元5角的2倍', '五元5角乘以实际出勤系数', '五元5分钟', '五元5分之一', '五元5角度',
]) test('abnormal order, precision, scaled Arabic yuan, qualifier or word boundary remains null: ' + value, () => {
  const normalized = money(value); assert.equal(normalized.amount, null); assert.equal(normalized.rawValue, value);
});
for (const [value, expression] of [['五元', '五元5角'], ['五元5角', '五元5角2分'], ['五元5角', '五元5角零2分'], ['五元5分', '五元5分钟']])
  test('cropped mixed token is not a complete precise amount: ' + value + ' <- ' + expression, () => {
    const f = fixture(value, expression);
    assert.equal(normalize({ ...f.candidate, quote: f.source.blocks[0].text }).amount, null);
    assert.equal(ingest(f).materials[0].candidates[0].amount, null); unavailableHistory(f, '5.00');
  });
for (const value of ['五元5角', '五元5角2分', '五元五角2分']) test('new support never upgrades historical unavailable mixed yuan: ' + value, () => {
  const f = fixture(value), state = ingest(f, true), stored = state.materials[0].candidates[0];
  Object.assign(stored, { amount: null, normalization: { rawValue: value, status: 'unsupported', amount: null, matchedText: null, span: null, reason: 'Synthetic old unsupported normalization.' } });
  const before = structuredClone(state), checked = review(state, [f.source]);
  assert.equal(checked.materials[0].candidates[0].amount, null); assert.deepEqual(state, before);
});

const unsupportedSuffixes = ['/年', '/周', '/週', '/季度', '/季', '/次', '/分钟', '/分鐘', '/秒', '/公里', '/人', '/班', '/hr', '/YEAR', '／年', '/季\u200d度', ' / 季 度', '每年', '每周', '每次'];
for (const suffix of unsupportedSuffixes) {
  for (const changes of [{ meaning: 'due_total', completeness: 'complete', period: '2026年1月', rateUnit: null }, { meaning: 'rate', rateUnit: 'unknown' }]) {
    test('unsupported explicit rate unit cannot be a precise candidate (' + changes.meaning + '): ' + JSON.stringify(suffix), () => {
      for (const value of ['40000元', '40000元' + suffix]) {
        const f = fixture(value, '40000元' + suffix, changes), raw = { ...f.candidate, quote: f.source.blocks[0].text }, before = structuredClone(raw);
        const normalized = normalize(raw);
        assert.equal(normalized.amount, null); assert.equal(normalized.value, value); assert.equal(normalized.normalization.rawValue, value);
        assert.equal(normalized.rateUnit, changes.rateUnit); assert.deepEqual(raw, before);
      }
    });
  }
  test('fresh and historical source-only explicit rate suffix stays unavailable: ' + JSON.stringify(suffix), () => {
    const f = fixture('40000元', '40000元' + suffix, { meaning: 'due_total', completeness: 'complete', period: '2026年1月' });
    assert.equal(ingest(f).materials[0].candidates[0].amount, null); unavailableHistory(f);
  });
}
for (const [unit, rateUnit] of [['月', 'month'], ['日', 'day'], ['天', 'day'], ['小时', 'hour'], ['时', 'hour'], ['件', 'piece']]) {
  test('supported finite rate retains its enum and exact mixed cents: ' + unit, () => {
    for (const suffix of ['/' + unit, '／' + unit, '/' + unit + '支付']) {
      const f = fixture('五元5角2分', '五元5角2分' + suffix, { meaning: 'rate', rateUnit });
      assert.equal(normalize({ ...f.candidate, quote: f.source.blocks[0].text }).amount, '5.52');
      assert.equal(ingest(f).materials[0].candidates[0].amount, '5.52');
    }
  });
  test('supported rate still refuses a due-total role: ' + unit, () => {
    const f = fixture('40000元', '40000元/' + unit, { meaning: 'due_total', completeness: 'complete', period: '2026年1月' });
    assert.equal(normalize({ ...f.candidate, quote: f.source.blocks[0].text }).amount, null);
  });
}
for (const tail of ['。王乙按年领取工资', '，王乙400元/年', '。后续年度另行结算', '\n王乙按次领取工资']) test('separate event rate does not contaminate a precise amount: ' + JSON.stringify(tail), () => {
  const f = fixture('40000元', '40000元' + tail);
  assert.equal(normalize({ ...f.candidate, quote: f.source.blocks[0].text }).amount, '40000.00');
  assert.equal(ingest(f).materials[0].candidates[0].amount, '40000.00');
});

for (const value of ['五元5角2分', '伍元5角2分']) test('read-time guard cannot repair a wrong historical derived operand: ' + value, () => {
  const f = fixture(value), state = ingest(f, true), candidate = state.materials[0].candidates[0];
  Object.assign(candidate, { amount: '5.00', normalization: { ...money(value), amount: '5.00' } });
  const before = structuredClone(state), checked = review(state, [f.source]);
  assert.equal(checked.materials[0].candidates[0].amount, null); assert.deepEqual(state, before);
});

for (const unit of ['年', '周', '季度', '次', '分钟', '秒', '公里', '人', '班']) test('a bare clipped numerator retains its unsupported source denominator: ' + unit, () => {
  const f = fixture('40000', '40000元/' + unit, { meaning: 'due_total', completeness: 'complete', period: '2026年1月' });
  assert.equal(normalize({ ...f.candidate, quote: f.source.blocks[0].text }).amount, null);
  assert.equal(ingest(f).materials[0].candidates[0].amount, null); unavailableHistory(f);
});
test('a normal 之后 continuation does not turn fen into a fractional operand', () => {
  const value = '五元5分', f = fixture(value, value + '之后支付');
  assert.equal(money(f.source.blocks[0].text).amount, '5.05');
  assert.equal(normalize({ ...f.candidate, quote: f.source.blocks[0].text }).amount, '5.05');
  assert.equal(ingest(f).materials[0].candidates[0].amount, '5.05');
});

for (const [value, amount] of [["五元５角", "5.50"], ["五元5角２分", "5.52"], ["伍元５角", "5.50"]])
  test("complete fullwidth numeral contract: " + value, () => exact(value, amount));

// ROUND30 adds complete fullwidth numerals; all malformed/cropped cases retain their assertions.
