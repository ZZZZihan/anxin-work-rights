// ROUND32: pure event-module tests for explicit recurring wage-payment schedules.
// No runtime, scorer, historical CLI, HTTP, build or model is invoked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.MATERIAL_FACT_TEST_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const EVENT_FILE = resolve(process.env.MATERIAL_FACT_EVENT_FILE || resolve(ROOT, 'lib/material-fact-event-review.ts'));
const bytes = await readFile(EVENT_FILE);
console.log(JSON.stringify({ module: 'material-fact-event-review', sha256: createHash('sha256').update(bytes).digest('hex'), node: process.version }));
const { hasSupportedCandidateAttribution: attribution } = await import(pathToFileURL(EVENT_FILE).href);
const cp = text => Array.from(text).length;

function check(text, value, expected, options = {}) {
  for (const quote of [value, text]) {
    const raw = { kind: 'date', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual',
      meaning: 'payment_date', completeness: 'not_applicable', period: null, rateUnit: null,
      assertion: 'narrated', ...options };
    const normalized = { rawValue: value, status: 'unsupported', amount: null,
      matchedText: null, span: null, reason: 'Synthetic date fixture; no money parsing.' };
    const offset = text.indexOf(value); assert(offset >= 0);
    const position = { start: cp(text.slice(0, offset)), end: cp(text.slice(0, offset + value.length)) };
    assert.equal(Array.from(text).slice(position.start, position.end).join(''), value);
    const before = structuredClone({ text, raw, normalized, position });
    assert.equal(attribution(raw, text, normalized), expected, `${text} :: ${value} / ${raw.subject} / ${raw.meaning}`);
    assert.deepEqual({ text, raw, normalized, position }, before, 'Keep original subject/quote/value/source/CP/null normalization');
  }
}

for (const [text, value] of [
  ['😀王甲工资每月15日发放', '每月15日'],
  ['😀王甲每月15日支付工资', '每月15日'],
  ['😀王甲的工资每月15日发放', '每月15日'],
  ['😀王甲每月十五日发放工资', '每月十五日'],
  ['😀王甲薪酬每月1日支付', '每月1日'],
  ['😀王甲每月31日付清薪资', '每月31日'],
  ['😀王甲工资每月十五号给付', '每月十五号'],
  ['😀王甲每月三十一号给付工资', '每月三十一号'],
  ['😀王甲工資每月十五號發放', '每月十五號'],
  ['😀王甲每月15號支付工資', '每月15號'],
  ['😀王甲工資每月十五日給付', '每月十五日'],
  ['😀王甲每月15日給付工資', '每月15日'],
  ['😀王甲工资每月１５日发放', '每月１５日'],
  ['😀王甲工资每月15日\n发放', '每月15日'],
  ['😀王甲每月15日\n支付工资', '每月15日'],
]) test(`finite scheduled wage payment ${text}`, () => check(text, value, true));

for (const [text, value, options] of [
  ['😀王甲工资每月15日未发放', '每月15日', {}],
  ['😀王甲每月15日未支付工资', '每月15日', {}],
  ['😀王甲工资并非每月15日发放', '每月15日', {}],
  ['😀王甲未每月15日支付工资', '每月15日', {}],
  ['😀王甲每月15日为王乙支付工资', '每月15日', {}],
  ['😀王甲每月15日支付王乙工资', '每月15日', {}],
  ['😀王甲工资每月15日由王乙发放', '每月15日', {}],
  ['😀王甲替王乙每月15日支付工资', '每月15日', {}],
  ['😀公司每月15日支付王甲工资', '每月15日', {}],
  ['😀王乙每月15日支付工资', '每月15日', {}],
  ['😀王乙代王甲每月15日支付工资', '每月15日', {}],
  ['😀王甲每月15日支付工资', '每月15日', { subject: '王', scope: 'individual' }],
  ['😀王甲等工资每月15日发放', '每月15日', { subject: '王甲等' }],
  ['😀王甲和王乙工资每月15日发放', '每月15日', { subject: '王甲和王乙' }],
  ['😀王甲每月15日支付工资', '每月15日', { scope: 'organization' }],
  ['😀王甲工资每月15日发放', '每月15日', { meaning: 'wage_period' }],
  ['😀王甲工资每月15日发放', '每月15日', { meaning: 'employment_period' }],
  ['😀王甲工资每月15日发放', '15日', {}],
  ['😀王甲工资每月15日发放', '每月15日', { kind: 'money', meaning: 'payment' }],
  ['😀王甲工资每月0日发放', '每月0日', {}],
  ['😀王甲工资每月32日发放', '每月32日', {}],
  ['😀王甲工资每月三十二號发放', '每月三十二號', {}],
  ['😀王甲工资每月15日前发放', '每月15日', {}],
  ['😀王甲工资每月15日前发放', '每月15日前', {}],
  ['😀王甲工资每月15日至20日发放', '每月15日', {}],
  ['😀王甲工资每月15日至20日发放', '每月15日至20日', {}],
  ['😀王甲工资每月15日左右发放', '每月15日左右', {}],
  ['😀王甲工资每月15日发放，王乙每月20日支付工资', '每月15日', {}],
  ['😀王甲工资每月15日发放王甲每月20日支付工资', '每月15日', {}],
  ['😀王甲工资每月15日应发放', '每月15日', {}],
  ['😀王甲工资每月15日发放待核实', '每月15日', {}],
  ['😀王甲工资2026年1月15日发放', '2026年1月15日', {}],
]) test(`owner/negation/role/complete-date gate ${text} ${JSON.stringify(options)}`, () => check(text, value, false, options));

for (const [text, value, meaning] of [
  ['😀王甲工资收到日每月15日', '每月15日', 'payment_date'],
  ['😀王甲工資收到日每月十五號', '每月十五號', 'payment_date'],
  ['😀王甲於2026年1月實際收到工資', '2026年1月', 'payment_date'],
  ['😀王甲於2026年1月解除勞動關係', '2026年1月', 'employment_period'],
]) test(`unchanged supported date layout ${text}`, () => check(text, value, true, { meaning }));
