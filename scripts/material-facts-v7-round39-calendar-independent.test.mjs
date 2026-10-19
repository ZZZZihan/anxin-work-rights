// Nonimplementer controls for the exact reviewed calendar patch only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const fixture = resolve(process.env.CALENDAR_REVIEW_FIXTURE ?? process.env.MATERIAL_FACT_TEST_ROOT
  ?? fileURLToPath(new URL('../', import.meta.url)));
const { normalizeMoneyValueV4: money, classifyMonetaryExpression: classify, normalizeCandidateValueV4: candidate } =
  await import(pathToFileURL(resolve(fixture, 'lib/material-money-v4.ts')).href);
test('four-digit money with an explicit yuan unit remains money', () => {
  for (const [raw, amount] of [['2026元', '2026.00'], ['人民币2026元', '2026.00'], ['人民币2026万元', '20260000.00']]) {
    const n = money(raw); assert.equal(n.amount, amount); assert.equal(classify(raw).kind, 'monetary');
    assert.equal(n.rawValue, raw); assert.equal(Array.from(raw).slice(n.span.start,n.span.end).join(''),n.matchedText);
  }
});
test('a currency literal without a following year keeps its exact value', () => {
  for (const raw of ['RMB2026', 'CNY2026', '人民币2026', '￥２０２６']) assert.equal(money(raw).amount, '2026.00');
});
test('fullwidth and format layout calendar detection preserves the original evidence', () => {
  const raw = '😀人民幣２０２６\u200d\n年5月工资';
  assert.equal(money(raw).amount, null); assert.equal(money(raw).rawValue, raw); assert.equal(classify(raw).kind, 'not_monetary');
});
test('unknown or another real monetary token is not definitely rejected', () => {
  for (const raw of ['人民币2026年1月工资？', '人民币2026年1月工资待定', '人民币2026年1月工资4000元'])
    assert.notEqual(classify(raw).kind, 'not_monetary');
});
test('an explicit yuan hourly rate cannot become a calendar year', () => {
  const raw = { kind: 'money', value: '2026元', quote: '王甲工资2026元/小时', blockId: 'b1', subject: '王甲',
    scope: 'individual', meaning: 'rate', completeness: 'not_applicable', period: null, rateUnit: 'hour', assertion: 'narrated' };
  assert.equal(candidate(raw).amount, '2026.00');
  assert.equal(candidate({ ...raw, meaning: 'due_total', completeness: 'complete', rateUnit: null }).amount, null);
});
test('an explicit sentence boundary separates calendar prose from its money', () => {
  assert.equal(money('人民币2026元。2027年发薪').amount, '2026.00');
});
