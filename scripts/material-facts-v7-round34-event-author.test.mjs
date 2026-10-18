// ROUND34: finite recurring-payment prepositions and traditional deadline cues.
// Pure event-module checks: no runtime, scorer, historical CLI, HTTP or models.
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
    // Both fresh-date and stored-null shapes remain null; only attribution is checked.
    for (const reason of ['Synthetic fresh date fixture', 'Synthetic stored-null date fixture']) {
      const normalized = { rawValue: value, status: 'unsupported', amount: null,
        matchedText: null, span: null, reason };
      const offset = text.indexOf(value); assert(offset >= 0);
      const position = { start: cp(text.slice(0, offset)), end: cp(text.slice(0, offset + value.length)) };
      assert.equal(Array.from(text).slice(position.start, position.end).join(''), value);
      const before = structuredClone({ text, raw, normalized, position });
      assert.equal(attribution(raw, text, normalized), expected, `${text} :: ${value} / ${raw.subject} / ${raw.meaning}`);
      assert.deepEqual({ text, raw, normalized, position }, before, 'Original value/quote/subject/source/CP/null normalization stay unchanged');
    }
  }
}

for (const [text, value] of [
  ['😀王甲工资于每月15日发放', '每月15日'],
  ['😀王甲工资在每月15日发放', '每月15日'],
  ['😀王甲的工资于每月15日支付', '每月15日'],
  ['😀王甲的薪酬在每月1日给付', '每月1日'],
  ['😀王甲薪资于每月31日付清', '每月31日'],
  ['😀王甲工資於每月十五號發放', '每月十五號'],
  ['😀王甲工資在每月九號給付', '每月九號'],
  ['😀王甲工资于每月１５日发放', '每月１５日'],
  ['😀王甲工资于\n每月15日\n发放', '每月15日'],
  ['😀王甲工資於每月三十一日給付', '每月三十一日'],
]) test(`finite scheduled payment ${text}`, () => check(text, value, true));

for (const [text, value] of [
  ['😀王甲工資應於2026年1月15日前給付', '2026年1月15日前'],
  ['😀王甲工資應於2026年1月15日前支付完畢', '2026年1月15日前'],
  ['😀王甲工資須於2026年1月15日前給付完畢', '2026年1月15日前'],
  ['😀王甲的工資應在2026年1月15日之前給付', '2026年1月15日之前'],
  ['😀王甲工資應於\n2026年1月15日前\n支付完畢', '2026年1月15日前'],
  ['😀王甲工资应于2026年1月15日前给付', '2026年1月15日前'],
  ['😀王甲工资应于2026年1月15日前支付完毕', '2026年1月15日前'],
]) test(`finite payment deadline ${text}`, () => check(text, value, true));

for (const [text, value, options = {}] of [
  ['😀王甲工资并非于每月15日发放', '每月15日'],
  ['😀王甲工资不在每月15日发放', '每月15日'],
  ['😀王甲工资于每月15日未发放', '每月15日'],
  ['😀王甲工资于每月15日由王乙发放', '每月15日'],
  ['😀王甲工资于每月15日支付王乙', '每月15日'],
  ['😀王甲替王乙工资于每月15日发放', '每月15日'],
  ['😀王乙工资于每月15日发放', '每月15日'],
  ['😀公司于每月15日给付王甲工资', '每月15日'],
  ['😀王甲工资于每月15日发放', '每月15日', { subject: '王' }],
  ['😀王甲和王乙工资于每月15日发放', '每月15日', { subject: '王甲和王乙' }],
  ['😀王甲等工资于每月15日发放', '每月15日', { subject: '王甲等' }],
  ['😀王甲工资于每月15日发放', '每月15日', { scope: 'organization' }],
  ['😀王甲工资于每月15日发放', '每月15日', { meaning: 'wage_period' }],
  ['😀王甲工资于每月15日发放', '每月15日', { meaning: 'employment_period' }],
  ['😀王甲工资于每月15日发放', '15日'],
  ['😀王甲工资于每月32日发放', '每月32日'],
  ['😀王甲工资于每月0日发放', '每月0日'],
  ['😀王甲工资于每月十五发放', '每月十五'],
  ['😀王甲工资于每月15日前发放', '每月15日'],
  ['😀王甲工资于每月15日前发放', '每月15日前'],
  ['😀王甲工资于每月15日至20日发放', '每月15日至20日'],
  ['😀王甲工资于每月15日左右发放', '每月15日左右'],
  ['😀王甲工资于每月15日发放待核实', '每月15日'],
  ['😀王甲工资于每月15日发放王乙每月20日收款', '每月15日'],
  ['😀王甲工資不應於2026年1月15日前給付', '2026年1月15日前'],
  ['😀王甲工資應於2026年1月15日前未給付', '2026年1月15日前'],
  ['😀王甲工資應於2026年1月15日前由王乙給付', '2026年1月15日前'],
  ['😀王乙工資應於2026年1月15日前給付', '2026年1月15日前'],
  ['😀王甲代王乙工資應於2026年1月15日前給付', '2026年1月15日前'],
  ['😀王甲工資應於2026年1月15日前給付', '2026年1月15日'],
  ['😀王甲工資應於2026年1月15日前給付', '2026年1月15日前', { meaning: 'wage_period' }],
  ['😀王甲工資應於2026年1月15日前給付王乙', '2026年1月15日前'],
  ['😀王甲工資應於2026年1月15日前支付完畢另付4000元', '2026年1月15日前'],
]) test(`owner/negation/role/date boundary ${text} ${JSON.stringify(options)}`, () => check(text, value, false, options));

for (const [text, value, meaning = 'payment_date'] of [
  ['😀王甲工资每月15日发放', '每月15日'],
  ['😀王甲每月15日支付工资', '每月15日'],
  ['😀王甲工資每月十五號發放', '每月十五號'],
  ['😀王甲工资收到日每月15日', '每月15日'],
  ['😀王甲於2026年1月實際收到工資', '2026年1月'],
  ['😀王甲於2026年1月解除勞動關係', '2026年1月', 'employment_period'],
]) test(`existing supported layout ${text}`, () => check(text, value, true, { meaning }));
