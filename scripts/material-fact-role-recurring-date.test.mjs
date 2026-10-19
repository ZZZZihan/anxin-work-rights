import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Actual runtime ingestion/read-time review with synthetic text only. The sole
// implementation overlay is event-review; dependencies can point to a checkout.
const HERE = fileURLToPath(new URL('../', import.meta.url));
const DEPS = resolve(process.env.MATERIAL_FACT_TEST_ROOT || HERE);
const IMPL = resolve(process.env.MATERIAL_FACT_EVENT_IMPLEMENTATION_ROOT || HERE);
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-role-recurring-date-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(DEPS, 'lib'), resolve(temporary, 'lib'), { recursive: true });
await cp(resolve(IMPL, 'lib/material-fact-event-review.ts'), resolve(temporary, 'lib/material-fact-event-review.ts'));
const load = name => import(pathToFileURL(resolve(temporary, 'lib', name)).href);
const { hasSupportedTotalRelationship, hasSupportedCandidateAttribution } = await load('material-fact-event-review.ts');
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest.ts');
const { reviewCandidateAgainstSource } = await load('material-fact-source-review.ts');
const { emptyFactState, ingestCandidates } = await load('material-facts-v3.ts');
const { normalizeMoneyValueV4 } = await load('material-money-v4.ts');
const AT = '2026-10-18T00:00:00.000Z';

function check({ text, value = '四萬圓', fullQuote = false, kind = 'money', meaning = 'due_total',
  period = kind === 'money' ? '2026年1月' : null, supported = true, subject = '王甲' }) {
  const source = { id: 'synthetic-role-date', name: '合成角色与周期日', sha256: 'd'.repeat(64), analysisRevision: 1, ready: true,
    blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
  const representation = { kind, value, quote: fullQuote ? text : value, blockId: 'b1', subject, scope: 'individual', meaning,
    completeness: kind === 'money' && ['due_total', 'paid_total'].includes(meaning) ? 'complete' : meaning === 'payment' ? 'unknown' : 'not_applicable',
    period, rateUnit: null, assertion: 'narrated' };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [representation] });
  const stored = ingestCandidates(emptyFactState(1), source, { raw }, 'synthetic', 'owner', AT);
  const candidate = stored.materials[0].candidates[0];
  assert.ok(candidate, 'Fixture must enter the real candidate store');
  if (kind === 'money') {
    const normalization = normalizeMoneyValueV4(value);
    assert.equal(normalization.amount, '40000.00', 'Current parser supports this explicit literal');
    Object.assign(candidate, { normalization, amount: normalization.amount });
  }
  const snapshot = structuredClone({ source, stored });
  const direct = kind === 'money' && ['due_total', 'paid_total'].includes(meaning)
    ? hasSupportedTotalRelationship : hasSupportedCandidateAttribution;
  assert.equal(direct(representation, text.replace(/。$/u, ''), candidate.normalization), supported, 'Direct event relationship');
  const reviewed = reviewCandidateAgainstSource(candidate, source);
  assert.equal(reviewed.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), !supported, 'Historical source relationship');
  const fresh = ingestRuntimeCandidates(emptyFactState(1), source, { raw }, 'synthetic', 'owner', AT);
  assert.equal(fresh.materials[0].candidates.length, 1);
  assert.equal(fresh.materials[0].candidates[0].reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), !supported, 'Fresh source relationship');
  for (const item of [reviewed, fresh.materials[0].candidates[0]]) {
    assert.deepEqual(item.representation, representation);
    assert.equal(item.value, value); assert.equal(item.quote, representation.quote);
    const at = text.indexOf(representation.quote);
    assert.equal(item.start, Array.from(text.slice(0, at)).length);
    assert.equal(item.end, item.start + Array.from(representation.quote).length);
    if (kind === 'date') assert.equal(item.amount, null);
    else assert.equal(item.amount, '40000.00');
  }
  assert.deepEqual({ source, stored }, snapshot, 'Read-time review never rewrites stored raw/source/history');
  assert.equal(fresh.materials[0].raw, raw);
  assert.deepEqual(fresh.confirmations, { due: null, paid: null });
  assert.equal(fresh.calculation, null);
  return reviewed;
}

const money = [
  ['王甲2026年1月全部應付工資合計四萬圓。', 'due_total', '四萬圓'],
  ['王甲2026年1月全部应付工资合计四万元。', 'due_total', '四万元'],
  ['王甲2026年1月完整已付工資總額40000圓。', 'paid_total', '40000圓'],
  ['王甲2026年1月完整已付工资总额40000元。', 'paid_total', '40000元'],
  ['王甲2026年1月全部實付薪資共計四萬圓。', 'paid_total', '四萬圓'],
  ['王甲2026年1月拖欠工資四萬圓。', 'arrears', '四萬圓'],
  ['王甲2026年1月收到工資四萬圓。', 'payment', '四萬圓'],
];
for (const [text, meaning, value] of money) for (const fullQuote of [false, true]) {
  test(`finite role glyphs ${meaning} / ${fullQuote ? 'full' : 'cropped'} / ${text}`, () => check({ text, meaning, value, fullQuote }));
}
for (const [text, meaning] of [
  ['王甲2026年1月全部應付工資合計四萬圓。', 'paid_total'],
  ['王甲2026年1月完整已付工資總額四萬圓。', 'due_total'],
  ['王甲2026年1月部分應付工資四萬圓。', 'due_total'],
  ['王甲2026年1月全部應付工資合計四萬圓但尚有獎金。', 'due_total'],
  ['王甲2026年1月王乙全部應付工資合計四萬圓。', 'due_total'],
  ['王甲2026年1月至2月全部應付工資合計四萬圓。', 'due_total'],
  ['李王甲2026年1月全部應付工資合計四萬圓。', 'due_total'],
]) test(`traditional detection cannot invent a complete owner/role: ${text} as ${meaning}`, () => check({ text, meaning, supported: false }));
for (const subject of ['王甲班組', '某單位', '若干員工', '若干勞動者', '甲集團', '甲群體', '甲集體', '眾人']) {
  test(`a collective supplied subject cannot become individual: ${subject}`, () => check({ subject,
    text: `${subject}2026年1月全部應付工資合計四萬圓。`, supported: false }));
  test(`a collective supplied subject cannot own an individual arrears: ${subject}`, () => check({ subject,
    text: `${subject}2026年1月拖欠工資四萬圓。`, meaning: 'arrears', supported: false }));
}

const days = ['1', '15', '31', '一', '十', '十五', '二十', '二十九', '三十', '三十一', '１５'];
for (const day of days) for (const fullQuote of [false, true]) {
  const value = `每月${day}日`;
  test(`recurring receipt day ${value} / ${fullQuote ? 'full' : 'cropped'}`, () => check({ text: `😀王甲工资收到日${value}。`, value, fullQuote, kind: 'date', meaning: 'payment_date' }));
}
for (const text of ['王甲每月15日收到工资。', '王甲的领取工资日期为每月15日。']) {
  test(`receipt cue on either side: ${text}`, () => check({ text, value: '每月15日', kind: 'date', meaning: 'payment_date' }));
}
for (const value of ['每月0日', '每月32日', '每月三十二日', '每月百日', '每月015日', '每月15日至20日', '每月15日前', '每月15日以后', '每月15日或20日', '每月某日', '每月15']) {
  test(`unsupported recurring boundary stays for review: ${value}`, () => check({ text: `王甲工资收到日${value}。`, value, kind: 'date', meaning: 'payment_date', supported: false }));
}
for (const meaning of ['employment_period', 'wage_period', 'other_date', 'contract_signing', 'contract_performance']) {
  test(`a monthly receipt day cannot become ${meaning}`, () => check({ text: '王甲工资收到日每月15日。', value: '每月15日', kind: 'date', meaning, supported: false }));
}
for (const [text, value] of [
  ['王甲工资收到日每月15日。', '15日'],
  ['王甲工资收到日每月15日。', '每月15'],
  ['王甲工资支付日每月15日。', '每月15日'],
  ['王甲没有收到工资每月15日。', '每月15日'],
  ['王甲每月15日王乙收到工资。', '每月15日'],
  ['王甲每月15日工资所属期间。', '每月15日'],
]) test(`recurring literal cannot borrow a role: ${text} / ${value}`, () => check({ text, value, kind: 'date', meaning: 'payment_date', supported: false }));
for (const [meaning, text] of [
  ['payment_date', '王甲2026年1月收到工资。'],
  ['employment_period', '王甲2026年1月入职。'],
  ['wage_period', '王甲2026年1月工资所属期间。'],
]) test(`ordinary calendar role remains supported: ${meaning}`, () => check({ text, value: '2026年1月', kind: 'date', meaning }));
