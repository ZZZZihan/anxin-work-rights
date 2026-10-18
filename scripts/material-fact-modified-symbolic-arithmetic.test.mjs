import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const IMPLEMENTATION = fileURLToPath(new URL('../', import.meta.url));
const SOURCE = resolve(process.env.MATERIAL_FACT_TEST_ROOT || IMPLEMENTATION);
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-modified-symbolic-arithmetic-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(SOURCE, 'lib'), resolve(temporary, 'lib'), { recursive: true });
await cp(resolve(process.env.MATERIAL_ARITHMETIC_TEST_HELPER || resolve(IMPLEMENTATION, 'lib/material-fact-arithmetic-review.ts')), resolve(temporary, 'lib/material-fact-arithmetic-review.ts'));
const load = name => import(pathToFileURL(resolve(temporary, 'lib', name)).href);
const { normalizeMoneyValueV4, normalizeCandidateValueV4 } = await load('material-money-v4.ts');
const { hasAttachedMoneyArithmetic } = await load('material-fact-arithmetic-review.ts');
const { reviewCandidateAgainstSource } = await load('material-fact-source-review.ts');
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates } = await load('material-facts-v3.ts');
const { ingestCandidates: ingestV2, validateCandidateOutput: validateV2 } = await load('material-facts-v2.ts');
const AT = '2026-10-18T00:00:00.000Z';

function fixture(expression, quote = '四万元', secondBlock = null) {
  const source = { id: 'modified-symbolic-arithmetic', name: '合成带修饰操作数', sha256: 'b'.repeat(64), analysisRevision: 1, ready: true,
    blocks: [{ id: 'b1', page: 1, text: `😀王甲欠薪为${expression}。`, bbox: null, confidence: null }] };
  if (secondBlock !== null) { source.blocks[0].text = `😀王甲欠薪为${expression}`; source.blocks.push({ id: 'b2', page: 1, text: secondBlock, bbox: null, confidence: null }); }
  const representation = { kind: 'money', value: '四万元', quote, blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'arrears',
    completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [representation] });
  const stored = ingestCandidates(emptyFactState(1), source, { raw }, 'synthetic', 'audit', AT);
  const candidate = stored.materials[0].candidates[0]; assert(candidate);
  Object.assign(candidate, { amount: '40000.00', normalization: normalizeMoneyValueV4('四万元') });
  return { source, representation, raw, stored, candidate };
}

const expressions = ['四万元乘以实际出勤系数', '四万元乘以工龄系数', '四万元除以应出勤天数',
  '四万元×实际的出勤系数', '四万元除以核定的计薪天数', '四万元基本工资乘以约定工龄系数',
  '四万元乘以应实际出勤天数', '四万元／应当工作天数', '四万元乘以本月出勤比例',
  '实际出勤系数乘以四万元', '工龄系数×四万元', '应出勤天数除以四万元',
  '四万元乘\n以实际出勤系数', '四万元乘以实际出\n勤系数', '四万元工\n资除以应出勤天数',
  '四万元\u200d×\u2060实\u200d际出勤系数', '四万元　＊　实际 出勤 系数',
  '四万元×K', '四万元乘以factor', '四万元除以n_1', '四万元×α', 'K乘以四万元', 'α×四万元',
  '四万元的K倍', 'K倍的四万元', '四万元工资factor倍', '四万元的K/2', '四万元的n分之一'];
for (const expression of expressions) test(`unknown modified/symbolic operation never becomes its monetary operand: ${JSON.stringify(expression)}`, () => {
  const normalized = normalizeMoneyValueV4(expression);
  assert.equal(normalized.amount, null); assert.equal(normalized.status, 'unsupported'); assert.equal(normalized.rawValue, expression);
  const f = fixture(expression), original = structuredClone(f);
  const direct = normalizeCandidateValueV4({ ...f.representation, quote: f.source.blocks[0].text });
  assert.equal(direct.amount, null); assert.equal(direct.value, '四万元'); assert.equal(direct.normalization.rawValue, '四万元');
  const reviewed = reviewCandidateAgainstSource(f.candidate, f.source);
  assert.equal(reviewed.amount, null); assert.deepEqual(reviewed.representation, f.representation); assert.deepEqual(f, original);
  assert.equal(reviewed.start, Array.from('😀王甲欠薪为' + expression.slice(0, expression.indexOf('四万元'))).length);
  const fresh = ingestRuntimeCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'audit', AT);
  assert.equal(fresh.materials[0].raw, f.raw); assert.equal(fresh.materials[0].candidates[0].amount, null);
  assert.deepEqual(fresh.confirmations, { due: null, paid: null }); assert.equal(fresh.calculation, null);
});

for (const secondBlock of ['乘以实际出勤系数。', '除以应出勤天数。', '×K。']) test(`explicit operator continues over OCR blocks without upgrading historical amount: ${secondBlock}`, () => {
  const f = fixture('四万元', '四万元', secondBlock), original = structuredClone(f);
  assert.equal(reviewCandidateAgainstSource(f.candidate, f.source).amount, null);
  const fresh = ingestRuntimeCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'audit', AT);
  assert.equal(fresh.materials[0].candidates[0].amount, null); assert.equal(fresh.materials[0].raw, f.raw); assert.deepEqual(f, original);
});

test('v2 historical precision is downgraded without replacing the stored raw value', () => {
  const f = fixture('四万元乘以实际出勤系数');
  const raw = JSON.stringify({ schemaVersion: 2, candidates: [f.representation] });
  const state = ingestV2(emptyFactState(1), f.source, validateV2(raw, f.source), 'synthetic', 'audit', AT);
  const candidate = state.materials[0].candidates[0];
  // Simulate an already persisted exact amount, regardless of current ingest.
  candidate.amount = '40000.00';
  const original = structuredClone(state);
  assert.equal(candidate.amount, '40000.00');
  assert.equal(reviewCandidateAgainstSource(candidate, f.source).amount, null);
  assert.deepEqual(state, original); assert.equal(state.materials[0].raw, raw);
});

for (const after of ['加班费已支付', '工资支付后另算实际出勤系数', '工资已经支付，实际出勤系数另议',
  '。另一人乘以实际出勤系数', '，另一人工龄系数另行计算', '\n王乙乘以实际出勤系数',
  '/月', '/日', '/小时', '/件', '工资2人', '工资已支付。K乘以2另计', '车补贴', '入账户后再按系数核算']) test(`ordinary payment prose, count, rate or independent event stays outside arithmetic: ${JSON.stringify(after)}`, () => {
  assert.equal(hasAttachedMoneyArithmetic('', after), false);
});

test('unrelated actual attendance and a stated multiplier total remain usable amounts', () => {
  for (const expression of ['四万元工资。王乙工龄系数另议', '四万元工资，已工作2个月', '三人工资合计四万元',
    '两倍工资合计四万元', '实际出勤系数已确定，工资合计四万元']) {
    const f = fixture(expression), original = structuredClone(f);
    assert.equal(normalizeMoneyValueV4(expression).amount, '40000.00', expression);
    assert.equal(reviewCandidateAgainstSource(f.candidate, f.source).amount, '40000.00'); assert.deepEqual(f, original);
  }
});

for (const modifier of ['实际', '应', '应当', '约定', '核定', '核算', '适用', '有效', '本月', '当月', '当期', '本期']) test(`finite modifier stays attached to a named operand only through an operation: ${modifier}`, () => {
  assert(hasAttachedMoneyArithmetic('', `乘以${modifier}出勤系数`));
  assert(hasAttachedMoneyArithmetic(`${modifier}出勤系数×`, ''));
  assert.equal(hasAttachedMoneyArithmetic('', `。${modifier}出勤系数另议`), false);
});
