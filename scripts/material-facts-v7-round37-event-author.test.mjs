// Pure event-attribution regression for review comments 4308022386/2396/2400.
// No runtime, scorer, historical CLI, HTTP, model or confirmation mutation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.MATERIAL_FACT_TEST_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const EVENT_FILE = resolve(process.env.MATERIAL_FACT_EVENT_FILE || resolve(ROOT, 'lib/material-fact-event-review.ts'));
console.log(JSON.stringify({ module: 'material-fact-event-review', sha256: createHash('sha256').update(await readFile(EVENT_FILE)).digest('hex'), node: process.version }));
const { hasSupportedCandidateAttribution: attribution, hasSupportedTotalRelationship: total } = await import(pathToFileURL(EVENT_FILE).href);
const cp = text => Array.from(text).length;

function check(text, value, expected, options = {}) {
  const kind = options.kind || 'date';
  for (const quote of [value, text]) {
    const raw = { kind, value, quote, blockId: 'b1', subject: '王甲', scope: 'individual',
      meaning: kind === 'date' ? 'payment_date' : 'other_money', completeness: 'not_applicable',
      period: null, rateUnit: null, assertion: 'narrated', ...options };
    for (const storedNull of [false, true]) {
      const normalized = kind === 'money' && !storedNull
        ? { rawValue: value, status: 'exact', amount: '4000.00', matchedText: value, span: { start: 0, end: cp(value) }, reason: 'Synthetic exact money' }
        : { rawValue: value, status: 'unsupported', amount: null, matchedText: null, span: null, reason: 'Synthetic preserved null' };
      const offset = text.indexOf(value); assert(offset >= 0);
      const position = { start: cp(text.slice(0, offset)), end: cp(text.slice(0, offset + value.length)) };
      const record = { raw, normalized, text, position, confirmed: false };
      const before = structuredClone(record);
      assert.equal(attribution(raw, text, normalized), expected, `${text} / ${raw.meaning} / ${raw.subject}`);
      assert.equal(total(raw, text, normalized), false, 'None of these date/other-money events establishes a complete wage total');
      assert.equal(Array.from(text).slice(position.start, position.end).join(''), value);
      assert.deepEqual(record, before, 'Raw quote/value/roles, astral CP, normalization and unconfirmed state remain unchanged');
    }
  }
}

for (const value of ['每个月15日', '每個月十五號', '每月第15日', '每個月第三十一日', '每个月第１号', '每月第十日']) {
  test(`finite recurring schedule ${value}`, () => check(`😀王甲工资于${value}发放`, value, true));
}
for (const [text, value] of [
  ['😀王甲每个月15日支付工资', '每个月15日'],
  ['😀王甲工資在每個月十五號給付', '每個月十五號'],
  ['😀王甲每月第15日收到工资', '每月第15日'],
  ['😀王甲工资\n每个月15日\n支付', '每个月15日'],
]) test(`recurring envelope ${text}`, () => check(text, value, true));

for (const [text, value, options = {}] of [
  ['😀王甲工资每个月32日发放', '每个月32日'],
  ['😀王甲工资每月第0日发放', '每月第0日'],
  ['😀王甲工资每個月第三十二號發放', '每個月第三十二號'],
  ['😀王甲工资每个月第十五发放', '每个月第十五'],
  ['😀王甲工资每个月15日前发放', '每个月15日'],
  ['😀王甲工资每个月15日至20日发放', '每个月15日至20日'],
  ['😀王甲工资不在每月第15日发放', '每月第15日'],
  ['😀王甲工资每个月15日未发放', '每个月15日'],
  ['😀王乙工资每个月15日发放', '每个月15日'],
  ['😀王甲工资每个月15日由王乙发放', '每个月15日'],
  ['😀王甲代王乙每个月15日收到工资', '每个月15日'],
  ['😀王甲和王乙工资每个月15日发放', '每个月15日', { subject: '王甲和王乙' }],
  ['😀王甲工资每个月15日发放', '每个月15日', { scope: 'organization' }],
  ['😀王甲工资每个月15日发放', '每个月15日', { meaning: 'wage_period' }],
]) test(`recurring boundary ${text} ${JSON.stringify(options)}`, () => check(text, value, false, options));

for (const [text, value] of [
  ['😀王甲工资于2026年1月15日支付', '2026年1月15日'],
  ['😀王甲工资在2026年1月15日发放', '2026年1月15日'],
  ['😀王甲的薪资于2026年1月15日给付', '2026年1月15日'],
  ['😀王甲工資於2026年1月15日發放', '2026年1月15日'],
  ['😀王甲工资在\n2026年1月15日\n支付', '2026年1月15日'],
]) test(`explicit scheduled concrete date ${text}`, () => check(text, value, true));

for (const [text, value, options = {}] of [
  ['😀王甲工资应于2026年1月15日前支付', '2026年1月15日'],
  ['😀王甲工资不在2026年1月15日支付', '2026年1月15日'],
  ['😀王甲工资于2026年1月15日未发放', '2026年1月15日'],
  ['😀王乙工资于2026年1月15日支付', '2026年1月15日'],
  ['😀王甲工资于2026年1月15日支付王乙', '2026年1月15日'],
  ['😀甲公司于2026年1月15日支付王甲工资', '2026年1月15日', { subject: '甲公司', scope: 'organization' }],
  ['😀王甲工资于2026年1月15日支付', '2026年1月15日', { meaning: 'employment_period' }],
  ['😀王甲工资于2026年1月15日支付', '2026年1月15日', { meaning: 'wage_period' }],
]) test(`concrete date boundary ${text} ${JSON.stringify(options)}`, () => check(text, value, false, options));

for (const noun of ['经济补偿金', '补偿金', '赔偿金', '奖金', '费用', '押金', '保证金', '罚款', '罚金', '材料款']) {
  test(`explicit non-wage receipt ${noun}`, () => check(`😀王甲收到${noun}4000元`, '4000元', true, { kind: 'money' }));
}
for (const [text, options = {}] of [
  ['😀甲公司收到材料款4000元', { subject: '甲公司', scope: 'organization' }],
  ['😀甲公司实际收到罚款4000元', { subject: '甲公司', scope: 'organization' }],
  ['😀王甲领取赔偿金4000元'],
  ['😀王甲收到經濟補償金4000元'],
  ['😀王甲領取獎金4000元'],
]) test(`finite other-money receipt owner ${text}`, () => check(text, '4000元', true, { kind: 'money', ...options }));

for (const [text, options = {}] of [
  ['😀王甲支付经济补偿金4000元'],
  ['😀王甲缴纳罚款4000元'],
  ['😀王甲未收到赔偿金4000元'],
  ['😀王乙收到经济补偿金4000元'],
  ['😀王甲代王乙收到赔偿金4000元'],
  ['😀王甲收到王乙的材料款4000元'],
  ['😀甲公司支付材料款4000元', { subject: '甲公司', scope: 'organization' }],
  ['😀王甲收到赔偿金4000元另付工资'],
  ['😀王甲收到材料款4000元', { meaning: 'paid_total', completeness: 'unknown' }],
  ['😀王甲收到奖金4000元', { meaning: 'payment', completeness: 'partial' }],
  ['😀王甲等收到赔偿金4000元', { subject: '王甲等' }],
]) test(`other-money cannot borrow ownership/wage role ${text} ${JSON.stringify(options)}`, () => check(text, '4000元', false, { kind: 'money', ...options }));

for (const [text, value, options = {}] of [
  ['😀王甲工资每月15日发放', '每月15日'],
  ['😀王甲工资于2026年1月15日实际收到', '2026年1月15日'],
  ['😀王甲工資應於2026年1月15日前給付', '2026年1月15日前'],
  ['😀王甲于2026年1月15日入职', '2026年1月15日', { meaning: 'employment_period' }],
]) test(`existing date compatibility ${text}`, () => check(text, value, true, options));
