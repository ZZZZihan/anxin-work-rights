// ROUND31 pure event-module author regressions. No runtime/scorer/HTTP/model is invoked.
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
const { hasSupportedCandidateAttribution: attribution, hasSupportedTotalRelationship: total } = await import(pathToFileURL(EVENT_FILE).href);
const cpLength = text => Array.from(text).length;

function dateFixture(text, value, { subject = '王甲', meaning = 'payment_date', quote = value } = {}) {
  const raw = { kind: 'date', value, quote, blockId: 'b1', subject, scope: 'individual', meaning,
    completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
  const normalized = { rawValue: value, status: 'unsupported', amount: null, matchedText: null, span: null, reason: 'Synthetic date fixture; no money parser.' };
  const offset = text.indexOf(value); assert(offset >= 0);
  const position = { start: cpLength(text.slice(0, offset)), end: cpLength(text.slice(0, offset + value.length)) };
  assert.equal(Array.from(text).slice(position.start, position.end).join(''), value);
  return { text, raw, normalized, position };
}
function check(fixture, expected) {
  const before = structuredClone(fixture), rawJson = JSON.stringify(fixture.raw);
  const result = attribution(fixture.raw, fixture.text, fixture.normalized);
  assert.deepEqual(fixture, before, 'Module must not rewrite raw/date/subject/normalization/source/CP positions');
  assert.equal(JSON.stringify(fixture.raw), rawJson);
  assert.equal(result, expected, `${fixture.text} :: ${fixture.raw.value} / ${fixture.raw.meaning}`);
}

for (const value of ['每月15号', '每月十五號', '每月1号', '每月31號', '每月一號', '每月三十一号', '每月15日', '每月十五日'])
  test(`finite recurring payment date ${value}`, () => {
    const text = `😀王甲工资收到日${value}`;
    for (const quote of [value, text]) check(dateFixture(text, value, { quote }), true);
    assert.notEqual(text.indexOf(value), cpLength(text.slice(0, text.indexOf(value))), 'Emoji preserves CP-vs-UTF16 distinction');
  });
for (const value of ['每月0号', '每月32號', '每月三十二号', '每月00号', '每月15号前', '每月15號至20號', '每月十五號左右'])
  test(`invalid or qualified recurring date remains unresolved ${value}`, () => check(dateFixture(`😀王甲工资收到日${value}`, value), false));
for (const [text, value, options] of [
  ['😀王甲工资收到日每月15号', '15号', {}],
  ['😀王甲工资收到日每月十五號', '十五號', {}],
  ['😀王甲工资收到日每月15号', '每月15号', { meaning: 'wage_period' }],
  ['😀王甲工资收到日每月十五號', '每月十五號', { meaning: 'employment_period' }],
  ['😀王甲工资支付日每月15号', '每月15号', {}],
  ['😀王甲工资未收到日每月15号', '每月15号', {}],
  ['😀王甲工资收到日每月15号王乙工资收到日每月20号', '每月15号', {}],
  ['😀王甲工资收到日每月15号，王乙工资收到日每月20号', '每月15号', {}],
  ['😀王甲等工资收到日每月15号', '每月15号', { subject: '王甲等' }],
]) test(`recurring ownership/role/boundary guard ${text} ${JSON.stringify(options)}`, () => check(dateFixture(text, value, options), false));

for (const [text, meaning] of [
  ['😀王甲於2026年1月實際收到工資', 'payment_date'],
  ['😀王甲工資於2026年1月實際收到', 'payment_date'],
  ['😀王甲於2026年1月解除勞動關係', 'employment_period'],
  ['😀王甲於2026年1月終止勞動關係', 'employment_period'],
  ['😀王甲勞動關係解除日2026年1月', 'employment_period'],
  ['😀王甲於2026年1月劳动关系终止', 'employment_period'],
  ['😀王甲于2026年1月实际收到工资', 'payment_date'],
  ['😀王甲于2026年1月解除劳动关系', 'employment_period'],
]) test(`date-only traditional cue aliases ${text}`, () => {
  for (const quote of ['2026年1月', text]) check(dateFixture(text, '2026年1月', { meaning, quote }), true);
});
for (const [text, meaning, subject] of [
  ['😀王甲於2026年1月未實際收到工資', 'payment_date', '王甲'],
  ['😀王甲於2026年1月未解除勞動關係', 'employment_period', '王甲'],
  ['😀王甲於2026年1月王乙實際收到工資', 'payment_date', '王甲'],
  ['😀王乙於2026年1月實際收到工資', 'payment_date', '王甲'],
  ['😀王甲於2026年1月解除王乙勞動關係', 'employment_period', '王甲'],
  ['😀王甲於2026年1月實際收到工資，於2026年2月解除勞動關係', 'employment_period', '王甲'],
  ['😀王甲於2026年1月解除勞動關係，於2026年2月實際收到工資', 'payment_date', '王甲'],
  ['😀王甲於2026年1月實際收到工資', 'employment_period', '王甲'],
  ['😀王甲於2026年1月解除勞動關係', 'payment_date', '王甲'],
  ['😀王甲等於2026年1月實際收到工資', 'payment_date', '王甲等'],
]) test(`negation/person/event must not borrow cue ${text} ${meaning}`, () => check(dateFixture(text, '2026年1月', { meaning, subject }), false));

for (const [role, meaning] of [['完整应付工资合计', 'due_total'], ['完整已付工资合计', 'paid_total']])
  test(`unchanged complete money event ${meaning}`, () => {
    const text = `😀王甲2026年1月${role}4000元`;
    const raw = { kind: 'money', value: '4000元', quote: text, blockId: 'b1', subject: '王甲', scope: 'individual', meaning,
      completeness: 'complete', period: '2026年1月', rateUnit: null, assertion: 'narrated' };
    const normalized = { rawValue: raw.value, status: 'exact', amount: '4000.00', matchedText: raw.value, span: { start: 0, end: 5 }, reason: 'Synthetic exact normalization.' };
    const before = structuredClone({ text, raw, normalized });
    assert.equal(attribution(raw, text, normalized), true); assert.equal(total(raw, text, normalized), true);
    assert.deepEqual({ text, raw, normalized }, before);
  });
