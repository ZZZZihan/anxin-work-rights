// Author synthetic fixtures for the yuan/payment-purpose lexical boundary.
// The configurable dependency tree stays unchanged; only currency is overlaid.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OWN = fileURLToPath(new URL('../', import.meta.url));
const SOURCE = resolve(process.env.MATERIAL_FACT_TEST_ROOT || OWN);
const CURRENCY_ROOT = resolve(process.env.MATERIAL_FACT_CURRENCY_ROOT || OWN);
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-yuan-payment-purpose-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(SOURCE, 'lib'), resolve(temporary, 'lib'), { recursive: true });
await cp(resolve(CURRENCY_ROOT, 'lib/material-fact-currency-review.ts'), resolve(temporary, 'lib/material-fact-currency-review.ts'));
const load = file => import(pathToFileURL(resolve(temporary, 'lib', file)).href);
const { normalizeMoneyValueV4 } = await load('material-money-v4.ts');
const { isRmbCurrencyUnitAt, moneyTokenHasNonCurrencyYuan } = await load('material-fact-currency-review.ts');
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates } = await load('material-facts-v3.ts');
const { reviewCandidateAgainstSource, reviewFactsAgainstSources } = await load('material-fact-source-review.ts');
const AT = '2026-10-18T00:00:00.000Z';

function check(text, value, style, expected, rateUnit = null, historicalAmount = '4000.00', subject = '王甲') {
  const source = { id: 'synthetic-round21-yuan-purpose', name: '合成元词界材料', sha256: 'a'.repeat(64),
    analysisRevision: 1, ready: true, blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
  const representation = { kind: 'money', value, quote: style === 'full' ? text : value, blockId: 'b1', subject,
    scope: 'individual', meaning: rateUnit ? 'rate' : 'payment', completeness: rateUnit ? 'not_applicable' : 'unknown', period: null, rateUnit, assertion: 'narrated' };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [representation] });
  const evidence = candidate => {
    assert.equal(candidate.value, value); assert.equal(candidate.quote, representation.quote);
    assert.deepEqual(candidate.representation, representation); assert.equal(candidate.sourceSha256, source.sha256);
    const start = Array.from(text.slice(0, text.indexOf(representation.quote))).length;
    assert.equal(candidate.start, start); assert.equal(candidate.end, start + Array.from(representation.quote).length);
  };
  const fresh = ingestRuntimeCandidates(emptyFactState(1), source, { raw }, 'synthetic', 'synthetic-author', AT);
  assert.equal(fresh.materials[0].raw, raw); assert.equal(fresh.materials[0].candidates.length, 1);
  const candidate = fresh.materials[0].candidates[0];
  assert.equal(candidate.amount, expected, `fresh ${JSON.stringify({ text, value, style })}`); evidence(candidate);
  assert.deepEqual(fresh.confirmations, emptyFactState(1).confirmations); assert.equal(fresh.calculation, null);

  // A deliberately obsolete stored exact amount must be reviewed without
  // mutating raw, the stored representation, the original state or its history.
  const stored = ingestCandidates(emptyFactState(1), source, { raw }, 'synthetic', 'synthetic-author', AT);
  const old = stored.materials[0].candidates[0]; assert(old);
  const token = value.match(/[0-9零〇一二三四五六七八九十百千万萬]+[元圆圓]/u)?.[0] || value;
  old.amount = historicalAmount;
  old.normalization = { rawValue: value, amount: historicalAmount, status: 'exact', matchedText: token,
    span: { start: 0, end: Array.from(token).length }, reason: 'Synthetic obsolete exact amount for read-time review' };
  const snapshot = structuredClone({ stored, source });
  const reviewed = reviewCandidateAgainstSource(old, source);
  assert.equal(reviewed.amount, expected, 'forced historical exact read'); evidence(reviewed);
  const view = reviewFactsAgainstSources(stored, [source]);
  assert.equal(view.materials[0].candidates[0].amount, expected); assert.equal(view.materials[0].raw, raw);
  assert.deepEqual(view.history, stored.history); assert.deepEqual({ stored, source }, snapshot);
}

const purposes = ['年终奖', '年終獎', '年终奖金', '年終獎金', '年假补偿', '年假補償', '年假补偿金', '年假工资', '年假工資'];
for (const purpose of purposes) {
  test(`literal yuan followed by an explicit payment purpose: ${purpose}`, () => {
    assert.equal(normalizeMoneyValueV4(`4000元${purpose}`).amount, '4000.00');
    assert.equal(isRmbCurrencyUnitAt(`4000元${purpose}`, 4), true);
    assert.equal(moneyTokenHasNonCurrencyYuan('4000元', purpose), false);
  });
  for (const style of ['full', 'crop']) {
    test(`amount plus purpose retains raw and CP (${purpose}, ${style})`, () => check(`😀王甲收到4000元${purpose}。`, '4000元', style, '4000.00'));
    test(`bare numeral borrows the real adjacent unit (${purpose}, ${style})`, () => check(`😀王甲收到4000元${purpose}。`, '4000', style, '4000.00'));
  }
}
for (const style of ['full', 'crop']) {
  test(`reported monthly rate with annual-leave purpose (${style})`, () => check('😀王甲月工资4000元年假补偿。', '4000元', style, '4000.00', 'month'));
  test(`whole value includes the explicit purpose (${style})`, () => check('😀王甲收到4000元年终奖。', '4000元年终奖', style, '4000.00'));
  test(`lowercase Chinese yuan before a purpose (${style})`, () => check('😀王甲收到四千元年终奖。', '四千元', style, '4000.00'));
  test(`financial Chinese yuan before a purpose (${style})`, () => check('😀王甲收到肆仟元年假补偿。', '肆仟元', style, '4000.00'));
  test(`Cf and layout affect detection only (${style})`, () => check('😀王甲收到4000元年\u200b终奖。', '4000元', style, '4000.00'));
  test(`horizontal OCR spaces affect detection only (${style})`, () => check('😀王甲收到4000元 年 终 奖。', '4000元', style, '4000.00'));
}
for (const word of ['元年', '元年纪事', '元年终点', '元月', '元件', '元音', '元宝', '元寶', '元旦', '元宵', '元组', '元組', '元素']) {
  test(`ordinary yuan word remains unavailable: ${word}`, () => {
    assert.equal(normalizeMoneyValueV4(`4000${word}`).amount, null);
    assert.equal(moneyTokenHasNonCurrencyYuan('4000元', word.slice(1)), true);
  });
  for (const style of ['full', 'crop']) test(`ordinary source prevents a cropped unit (${word}, ${style})`, () => check(`😀王甲记录4000${word}。`, '4000元', style, null));
}
for (const [word, value, oldAmount] of [['二元论', '二元', '2.00'], ['2元论', '2', '2.00'], ['三元催化器', '三元', '3.00'], ['3元催化剂', '3', '3.00']])
  for (const style of ['full', 'crop']) test(`ordinary numeric compound cannot borrow yuan (${word}, ${style})`, () => check(`😀王甲记录${word}。`, value, style, null, null, oldAmount));
for (const purpose of ['工资', '组装费', '工伤补偿', '劳务报酬']) for (const style of ['full', 'crop'])
  test(`pre-existing payment noun stays usable (${purpose}, ${style})`, () => check(`😀王甲收到4000元${purpose}。`, '4000元', style, '4000.00'));
for (const style of ['full', 'crop']) {
  test(`a unitless number does not gain currency from a purpose (${style})`, () => check('😀王甲收到4000年终奖。', '4000', style, null));
  test(`foreign currency still blocks the amount (${style})`, () => check('😀王甲以港币支付4000元年终奖。', '4000元', style, null));
  test(`a range still cannot become its exact endpoint (${style})`, () => check('😀王甲收到4000元至5000元年终奖。', '4000元', style, null));
  test(`another event purpose cannot legalize 元年 (${style})`, () => check('😀王甲记载4000元年。另付年终奖。', '4000元', style, null));
  test(`supplementary Han prefix cannot be cropped from a name (${style})`, () => check('😀𠮷王美元工资四万元。', '四万元', style, null, null, '40000.00', '王美元'));
  test(`a clause delimiter separates the actual name (${style})`, () => check('😀𠮷。王美元工资四万元。', '四万元', style, '40000.00', null, '40000.00', '王美元'));
}
