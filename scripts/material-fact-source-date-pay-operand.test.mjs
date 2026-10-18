import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Synthetic actual-runtime tests, with fixed dependencies and three owned files.
const HERE = fileURLToPath(new URL('../', import.meta.url));
const BASE = resolve(process.env.MATERIAL_FACT_ROUND27_BASE_ROOT || HERE);
const PATCH = resolve(process.env.MATERIAL_FACT_ROUND27_PATCH_ROOT || HERE);
const temp = await mkdtemp(resolve(tmpdir(), 'anxin-source-date-pay-operand-'));
after(() => rm(temp, { recursive: true, force: true }));
await cp(resolve(BASE, 'lib'), resolve(temp, 'lib'), { recursive: true });
const files = ['material-fact-source-review.ts', 'material-fact-event-review.ts', 'material-fact-arithmetic-review.ts'];
for (const file of files) await cp(resolve(PATCH, 'lib', file), resolve(temp, 'lib', file));
console.log(JSON.stringify({ implementation_sha256: Object.fromEntries(await Promise.all(files.map(async file =>
  [file, createHash('sha256').update(await readFile(resolve(temp, 'lib', file))).digest('hex')])))}));
const load = file => import(pathToFileURL(resolve(temp, 'lib', file)).href);
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates, buildFactView } = await load('material-facts-v3.ts');
const { reviewCandidateAgainstSource } = await load('material-fact-source-review.ts');
const { hasSupportedCandidateAttribution } = await load('material-fact-event-review.ts');
const { hasAttachedMoneyArithmetic } = await load('material-fact-arithmetic-review.ts');
const { normalizeMoneyValueV4 } = await load('material-money-v4.ts');
const AT = '2026-10-18T00:00:00.000Z';
function check({ text, texts = [text], full = false, value = '4000元', kind = 'money', meaning = 'due_total',
  rateUnit = null, expected = null, supported, subject = '王甲', period = null, samePage = false }) {
  const index = texts.findIndex(text => text.includes(value));
  assert.ok(index >= 0);
  const quote = full ? texts[index] : value;
  const representation = { kind, value, quote, blockId: `b${index + 1}`, subject, scope: 'individual', meaning,
    completeness: kind === 'money' && ['due_total', 'paid_total'].includes(meaning) ? 'complete' : 'not_applicable',
    period, rateUnit, assertion: 'narrated' };
  const source = { id: 'source-date-pay-operand', name: '合成费率日期与算式', sha256: '7'.repeat(64), analysisRevision: 27, ready: true,
    blocks: texts.map((text, i) => ({ id: `b${i + 1}`, page: samePage ? 1 : i + 1, text, bbox: null, confidence: null })) };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [representation] });
  const stored = ingestCandidates(emptyFactState(27), source, { raw }, 'synthetic', 'owner', AT);
  const candidate = stored.materials[0].candidates[0];
  assert.ok(candidate, 'Fixture must pass the candidate contract');
  if (kind === 'money') {
    const exact = normalizeMoneyValueV4(value);
    assert.equal(exact.amount, '4000.00', 'Forced history starts from an exact literal');
    Object.assign(candidate, { amount: exact.amount, normalization: exact });
  }
  const snapshot = structuredClone({ stored, source });
  const reviewed = reviewCandidateAgainstSource(candidate, source);
  const fresh = ingestRuntimeCandidates(emptyFactState(27), source, { raw }, 'synthetic', 'owner', AT);
  assert.equal(fresh.materials[0].candidates.length, 1, 'Actual store receives one candidate');
  for (const [name, item] of [['fresh', fresh.materials[0].candidates[0]], ['history', reviewed]]) {
    assert.equal(item.amount, expected, name + ': source-reviewed amount');
    if (supported !== undefined) assert.equal(item.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), !supported,
      name + ': finite same-event role');
    assert.deepEqual(item.representation, representation); assert.equal(item.value, value); assert.equal(item.quote, quote);
    assert.equal(item.sourceSha256, source.sha256);
    const start = Array.from(texts[index].slice(0, texts[index].indexOf(quote))).length;
    assert.equal(item.start, start); assert.equal(item.end, start + Array.from(quote).length);
    assert.equal(Array.from(texts[index]).slice(item.start, item.end).join(''), quote);
  }
  if (kind === 'date' && texts.length === 1 && supported !== undefined)
    assert.equal(hasSupportedCandidateAttribution(representation, text.replace(/。$/u, ''), candidate.normalization), supported);
  assert.equal(fresh.materials[0].raw, raw); assert.deepEqual(fresh.confirmations, { due: null, paid: null });
  assert.equal(fresh.calculation, null); assert.equal(buildFactView(fresh, [source]).canCalculate, false);
  assert.deepEqual({ stored, source }, snapshot, 'Historical review does not write stored raw, source or history');
  if (kind === 'money') {
    candidate.amount = null; candidate.normalization = { ...candidate.normalization, amount: null, status: 'unsupported' };
    const unchanged = structuredClone(stored);
    assert.equal(reviewCandidateAgainstSource(candidate, source).amount, null, 'Unavailable history is never upgraded');
    assert.deepEqual(stored, unchanged);
  }
}

for (const tail of ['按周计', '按季度计', '按年计', '按年度计算', '按星期计薪', '按分鐘計價', '按秒', '按公里计价',
  '按人计酬', '按班计', '按次', '按週', '按季度', '按工时计薪', '按kg计价', '按月度计', '按包计', '按批计价']) for (const full of [false, true])
  test(`unsupported denominator ${tail} full=${full}`, () => check({ text: `😀王甲工资4000元${tail}。`, full }));
for (const texts of [['😀王甲工资4000元按', '季度计。'], ['😀王甲工资4000元', '按周计。'], ['😀王甲工资4000元按年', '計。'],
  ['😀王甲工资4000元按\n季度计。'], ['😀王甲工资4000元按\u2028周计。'], ['😀王甲工资4000元按\u2029年度计算。'], ['😀王甲工资4000元按\n周\n计。']])
  test(`unsupported denominator layout ${JSON.stringify(texts)}`, () => check({ samePage: true, texts: texts.map(t => t.replaceAll('\\n', '\n').replaceAll('\\u2028', '\u2028').replaceAll('\\u2029', '\u2029')) }));
for (const tail of ['按时支付', '按时', '按时间顺序', '按月15日发放', '按日15日发放', '按季度汇总', '按周计划发放', '按年计算机规定', '按件计数'])
  test(`ordinary instruction remains amount ${tail}`, () => check({ text: `王甲工资4000元${tail}。`, expected: '4000.00' }));
for (const texts of [['😀王甲工资4000元。', '王乙工资5000元按周计。'], ['😀王甲工资4000元', '王乙工资5000元按季度计。'],
  ['😀王甲工资4000元。', '按年计。']]) test(`unsupported denominator cannot cross an event ${JSON.stringify(texts)}`,
    () => check({ texts, expected: '4000.00' }));
for (const [tail, rateUnit] of [['按月计', 'month'], ['按日计', 'day'], ['按小时计', 'hour'], ['按件计酬', 'piece']])
  test(`supported exact rate remains attributed ${tail}`, () => check({ text: `😀王甲工资4000元${tail}。`, meaning: 'rate', rateUnit,
    expected: '4000.00', supported: true }));
for (const [text, meaning] of [['王甲於2026年1月入職', 'employment_period'], ['王甲工資歸屬期間2026年1月', 'wage_period'],
  ['王甲於2026年1月簽訂勞動合同', 'contract_signing'], ['王甲於2026年1月離職', 'employment_period'],
  ['王甲勞動合同履行期間2026年1月', 'contract_performance'], ['王甲工資領取日期為2026年1月', 'payment_date']])
  for (const full of [false, true]) test(`traditional date role ${text} full=${full}`, () => check({ text: '😀' + text + '。', value: '2026年1月', kind: 'date', meaning, full, supported: true }));
for (const [text, meaning] of [['王甲於2026年1月簽訂勞動合同', 'employment_period'], ['王甲工資歸屬期間2026年1月', 'contract_signing'],
  ['王甲於2026年1月入職', 'wage_period'], ['王甲於2026年1月王乙入職', 'employment_period'],
  ['王甲於2026年1月支付工資', 'payment_date']]) test(`traditional dates cannot invent a role ${text} as ${meaning}`,
    () => check({ text: '😀' + text + '。', value: '2026年1月', kind: 'date', meaning, supported: false }));
for (const [text, meaning] of [['王甲于2026年1月入职', 'employment_period'], ['王甲工资归属期间2026年1月', 'wage_period'],
  ['王甲于2026年1月签订劳动合同', 'contract_signing']]) test(`simplified date role stays supported ${text}`,
    () => check({ text: '😀' + text + '。', value: '2026年1月', kind: 'date', meaning, supported: true }));
for (const texts of [['😀王甲2026年1月。', '王乙入職。'], ['😀王甲2026年1月。', '簽訂勞動合同。']])
  test(`date cannot borrow a neighboring role ${JSON.stringify(texts)}`, () => check({ texts, value: '2026年1月', kind: 'date', meaning: 'employment_period', supported: false }));

for (const after of ['+奖金', '加上加班费', '乘以提成', '除以基本工资', '减去交通补贴', '另加绩效奖金', '×本月津贴', '+销售提成', '加上工龄津贴', '乘以本期的岗位补助',
  '+獎金', '加上加班費', '減去補貼', '乘以本期的佣金', '+\n年终奖', '加\n上加\n班费']) {
  const tail = after.replaceAll('\\n', '\n');
  test(`explicit pay-component operand detected ${JSON.stringify(tail)}`, () => assert.equal(hasAttachedMoneyArithmetic('', tail), true));
  for (const full of [false, true]) test(`pay-component operand null full=${full} ${JSON.stringify(tail)}`,
    () => check({ text: `😀王甲工资4000元${tail}。`, full }));
}
for (const texts of [['😀王甲工资4000元+', '奖金。'], ['😀王甲工资4000元', '加上加班费。'], ['😀王甲工资4000元乘以', '提成。'],
  ['😀王甲工资4000元加', '上加班費。']]) test(`arithmetic explicit layout ${JSON.stringify(texts)}`, () => check({ texts, samePage: true }));
for (const after of ['奖金', '加班费', '工资已支付', '/月', '/小时', '。王乙奖金另计', '；另加奖金', '\n王乙奖金另计',
  '+奖金发放工作', '按时支付']) test(`ordinary text cannot become an operand ${JSON.stringify(after)}`,
    () => assert.equal(hasAttachedMoneyArithmetic('', after.replaceAll('\\n', '\n')), false));
for (const texts of [['😀王甲工资4000元。', '王乙另加奖金。'], ['😀王甲工资4000元', '王乙另加奖金。'],
  ['😀王甲收到4000元加班费。'], ['😀王甲工资4000元，奖金另计。']])
  test(`ordinary pay-component context remains amount ${JSON.stringify(texts)}`, () => check({ texts, expected: '4000.00' }));

for (const tail of ['+奖金', '加上加班费', '乘以提成', '+獎金', '加\n上加\n班费']) {
  const expression = '4000元' + tail.replaceAll('\\n', '\n');
  test(`whole arithmetic value remains raw and unavailable ${JSON.stringify(expression)}`, () => {
    assert.equal(normalizeMoneyValueV4(expression).amount, null);
    const text = '😀王甲工资' + expression + '。';
    const source = { id: 'whole-pay-operand', name: '合成完整算式', sha256: 'e'.repeat(64), analysisRevision: 27, ready: true,
      blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
    const representation = { kind: 'money', value: expression, quote: text, blockId: 'b1', subject: '王甲', scope: 'individual',
      meaning: 'other_money', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
    const raw = JSON.stringify({ schemaVersion: 3, candidates: [representation] });
    const state = ingestRuntimeCandidates(emptyFactState(27), source, { raw }, 'synthetic', 'owner', AT);
    const item = state.materials[0].candidates[0];
    assert.ok(item); assert.equal(item.amount, null); assert.deepEqual(item.representation, representation);
    assert.equal(state.materials[0].raw, raw); assert.equal(item.start, 0); assert.equal(item.end, Array.from(text).length);
    assert.equal(buildFactView(state, [source]).canCalculate, false);
  });
}
for (const [after, expected] of [['×貳', true], ['乘以參', true], ['+陸', true], ['。王乙貳角', false]])
  test(`traditional numeral arithmetic is a detection alias ${after}`, () => assert.equal(hasAttachedMoneyArithmetic('', after), expected));
for (const texts of [['😀王甲工资4000元', '貳角。'], ['😀王甲工资4000元', '參角。'], ['😀王甲工资4000元', '陸分。']])
  test(`traditional numeral subunit continuation cannot be hidden ${JSON.stringify(texts)}`, () => check({ texts, samePage: true }));

for (const tail of ['按周计', '按季度计', '按年计'])
  test(`a model-declared supported unit cannot exempt unsupported ${tail}`, () => check({ text: `😀王甲工资4000元${tail}。`, meaning: 'rate', rateUnit: 'month' }));

// ROUND27 closure: preserve the earlier suffix-only evidence, and exercise the
// same attached formula when the unknown payroll component is its left operand.
for (const before of ['奖金+', '奖金乘以', '加班费加上', '销售提成减去', '本月的工龄津贴除以', '獎金加上']) {
  test(`prefix payroll operand helper ${before}`, () => assert.equal(hasAttachedMoneyArithmetic(before, ''), true));
  for (const full of [false, true]) test(`prefix payroll operand actual source ${before} full=${full}`,
    () => check({ text: `😀王甲工资${before}4000元。`, full }));
}
for (const texts of [['😀王甲工资奖金+', '4000元。'], ['😀王甲工资奖金乘', '以4000元。'], ['😀王甲工资加班费', '加上4000元。']])
  test(`prefix payroll operand source layout ${JSON.stringify(texts)}`, () => check({ texts, samePage: true }));
for (const before of ['奖金+', '奖金乘以', '加班费加上']) test(`prefix payroll operand complete value ${before}`, () => {
  const value = before + '4000元', text = '😀王甲工资' + value + '。';
  assert.equal(normalizeMoneyValueV4(value).amount, null);
  const source = { id: 'prefix-pay-operand', name: '合成反向算式', sha256: 'f'.repeat(64), analysisRevision: 27, ready: true,
    blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
  const representation = { kind: 'money', value, quote: text, blockId: 'b1', subject: '王甲', scope: 'individual',
    meaning: 'other_money', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [representation] });
  const state = ingestRuntimeCandidates(emptyFactState(27), source, { raw }, 'synthetic', 'owner', AT);
  const item = state.materials[0].candidates[0];
  assert.ok(item); assert.equal(item.amount, null); assert.deepEqual(item.representation, representation);
  assert.equal(state.materials[0].raw, raw); assert.equal(item.start, 0); assert.equal(item.end, Array.from(text).length);
  assert.equal(buildFactView(state, [source]).canCalculate, false);
});
for (const before of ['奖金已支付。王甲工资', '奖金另计；王甲收到', '王乙加班费，王甲工资', '奖金发放+'])
  test(`prefix ordinary event cannot borrow an operand ${before}`, () => assert.equal(hasAttachedMoneyArithmetic(before, ''), false));
for (const texts of [['😀王乙奖金已支付。', '王甲工资4000元。'], ['😀王甲工资4000元。', '王乙奖金+5000元。'],
  ['😀王甲收到4000元奖金。']]) test(`prefix independent payment stays exact ${JSON.stringify(texts)}`,
    () => check({ texts, expected: '4000.00' }));
