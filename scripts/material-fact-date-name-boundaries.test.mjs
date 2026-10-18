import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Synthetic actual-ingest/read-time tests. Dependencies and the two owned
// modules are independently configurable so fixed old-code evidence is retained.
const HERE = fileURLToPath(new URL('../', import.meta.url));
const BASE = resolve(process.env.MATERIAL_FACT_TEST_ROOT || HERE);
const PATCH = resolve(process.env.MATERIAL_FACT_PATCH_ROOT || HERE);
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-date-name-boundaries-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(BASE, 'lib'), resolve(temporary, 'lib'), { recursive: true });
// The new postposed-RMB cents capability is a separate agent's dependency.
// Override only those two modules to exercise its source-boundary closure
// against old or patched source/event code, without changing either tree.
if (process.env.MATERIAL_FACT_MONEY_PATCH_ROOT) for (const name of ['material-money-v4.ts', 'material-fact-range-review.ts'])
  await cp(resolve(process.env.MATERIAL_FACT_MONEY_PATCH_ROOT, 'lib', name), resolve(temporary, 'lib', name));
const owned = ['material-fact-source-review.ts', 'material-fact-event-review.ts'];
for (const name of owned) await cp(resolve(PATCH, 'lib', name), resolve(temporary, 'lib', name));
console.log(JSON.stringify({ implementation_sha256: Object.fromEntries(await Promise.all(owned.map(async name =>
  [name, createHash('sha256').update(await readFile(resolve(temporary, 'lib', name))).digest('hex')])))}));
const load = name => import(pathToFileURL(resolve(temporary, 'lib', name)).href);
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates, buildFactView } = await load('material-facts-v3.ts');
const { reviewCandidateAgainstSource } = await load('material-fact-source-review.ts');
const { normalizeMoneyValueV4 } = await load('material-money-v4.ts');
await mkdir(resolve(temporary, 'experiments/material-facts-v7'), { recursive: true });
await cp(resolve(BASE, 'experiments/material-facts-v7/assess.mjs'), resolve(temporary, 'experiments/material-facts-v7/assess.mjs'));
const { assessCase } = await import(pathToFileURL(resolve(temporary, 'experiments/material-facts-v7/assess.mjs')).href);
const AT = '2026-10-18T00:00:00.000Z';

function check({ text, texts = [text], value = '4000元', subject = '王甲', kind = 'money', meaning = 'due_total',
  period = null, rateUnit = null, full = false, supported, literalAmount = '4000.00', amount = kind === 'date' ? null : '4000.00' }) {
  const index = texts.findIndex(item => item.includes(value));
  assert.ok(index >= 0);
  const quote = full ? texts[index] : value;
  const representation = { kind, value, quote, blockId: `b${index + 1}`, subject, scope: 'individual', meaning,
    completeness: kind === 'money' && ['due_total', 'paid_total'].includes(meaning) ? 'complete' : 'not_applicable',
    period, rateUnit, assertion: 'narrated' };
  const source = { id: 'round28-date-name', name: '合成日期与姓名边界', sha256: '8'.repeat(64), analysisRevision: 28, ready: true,
    blocks: texts.map((text, i) => ({ id: `b${i + 1}`, page: i + 1, text, bbox: null, confidence: null })) };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [representation] });
  const history = ingestCandidates(emptyFactState(28), source, { raw }, 'synthetic', 'owner', AT);
  const old = history.materials[0].candidates[0];
  assert.ok(old, 'Fixture enters the actual candidate store');
  if (kind === 'money') {
    const normalization = normalizeMoneyValueV4(value);
    assert.equal(normalization.amount, literalAmount);
    Object.assign(old, { amount: normalization.amount, normalization });
  }
  const unchanged = structuredClone({ history, source });
  const fresh = ingestRuntimeCandidates(emptyFactState(28), source, { raw }, 'synthetic', 'owner', AT);
  assert.equal(fresh.materials[0].candidates.length, 1, 'Fresh candidate actually persists');
  const reviewed = reviewCandidateAgainstSource(old, source);
  for (const [name, item] of [['fresh', fresh.materials[0].candidates[0]], ['history', reviewed]]) {
    assert.equal(item.amount, amount, `${name}: amount`);
    if (supported !== undefined) assert.equal(item.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), !supported,
      `${name}: same-event relationship`);
    if (amount !== null) assert.equal(item.reviewIssues.some(issue => issue.code === 'rate_unit_mismatch'), false,
      `${name}: no false rate inferred from a name`);
    assert.deepEqual(item.representation, representation); assert.equal(item.value, value); assert.equal(item.quote, quote);
    const at = texts[index].indexOf(quote), start = Array.from(texts[index].slice(0, at)).length;
    assert.equal(item.start, start); assert.equal(item.end, start + Array.from(quote).length);
    assert.equal(Array.from(texts[index]).slice(item.start, item.end).join(''), quote);
    assert.equal(item.sourceSha256, source.sha256);
  }
  assert.deepEqual({ history, source }, unchanged, 'Read-time review leaves original storage, raw, evidence and audit untouched');
  assert.equal(fresh.materials[0].raw, raw); assert.deepEqual(fresh.confirmations, { due: null, paid: null });
  assert.equal(fresh.calculation, null); assert.equal(buildFactView(fresh, [source]).canCalculate, false);
  if (kind === 'money') {
    old.amount = null; old.normalization = { ...old.normalization, status: 'unsupported', amount: null };
    const unavailable = structuredClone(history);
    assert.equal(reviewCandidateAgainstSource(old, source).amount, null, 'An old unavailable amount is not upgraded');
    assert.deepEqual(history, unavailable);
  }
}

for (const [text, value] of [
  ['王甲於2026年1月後入職', '2026年1月後'], ['王甲從2026年1月起任職', '從2026年1月起'],
  ['王甲於2026年1月之後入職', '2026年1月之後'], ['王甲從2026年1月起至2月任職', '從2026年1月起至2月'],
  ['王甲于2026年1月后入职', '2026年1月后'], ['王甲从2026年1月起任职', '从2026年1月起'],
]) for (const full of [false, true]) test(`literal date boundaries ${text} full=${full}`, () => check({ text: `😀${text}。`, value,
  kind: 'date', meaning: 'employment_period', full, supported: true }));
for (const [text, value] of [
  ['王甲於2026年1月後入職', '2026年1月'], ['王甲從2026年1月起任職', '2026年1月'],
  ['王甲於2026年1月後王乙入職', '2026年1月後'], ['王甲於2026年1月後簽訂勞動合同', '2026年1月後'],
]) test(`date cropping or another event cannot acquire employment ${text}`, () => check({ text: `😀${text}。`, value,
  kind: 'date', meaning: 'employment_period', supported: false }));

for (const [text, value] of [
  ['王甲于2026年1月15日收到工资', '2026年1月15日'], // Existing green control, not a claimed pre-fix failure.
  ['王甲在2026年1月15日领取工资', '2026年1月15日'], ['王甲工資於2026年1月15日收到', '2026年1月15日'],
  ['王甲工资应于2026年1月15日前支付', '2026年1月15日前'], ['王甲工资须在2026年1月15日之前发放', '2026年1月15日之前'],
  ['王甲工資應於2026年1月15日前支付', '2026年1月15日前'], ['王甲工资支付截止日期为2026年1月15日', '2026年1月15日'],
]) for (const full of [false, true]) test(`explicit wage receipt or deadline ${text} full=${full}`, () => check({ text: `😀${text}。`, value,
  kind: 'date', meaning: 'payment_date', full, supported: true }));
for (const [text, value] of [
  ['王甲于2026年1月15日支付工资', '2026年1月15日'], ['王甲于2026年1月15日被责令支付工资', '2026年1月15日'],
  ['王甲工资应于2026年1月15日前支付', '2026年1月15日'], ['王甲工资应于2026年1月15日之后支付', '2026年1月15日之后'],
  ['王甲工资应于2026年1月15日前王乙支付', '2026年1月15日前'], ['王甲工资应于2026年1月15日前支付但尚有争议', '2026年1月15日前'],
  ['王甲工资应于2026年1月15日至20日前支付', '2026年1月15日'],
]) test(`date does not invent receipt or lose deadline ${text}`, () => check({ text: `😀${text}。`, value,
  kind: 'date', meaning: 'payment_date', supported: false }));
for (const meaning of ['wage_period', 'employment_period', 'contract_signing', 'other_date'])
  test(`a payment deadline is not ${meaning}`, () => check({ text: '😀王甲工资应于2026年1月15日前支付。', value: '2026年1月15日前',
    kind: 'date', meaning, supported: false }));
test('payment event cannot borrow a next-block receipt', () => check({ texts: ['😀王甲于2026年1月15日。', '王乙收到工资。'],
  value: '2026年1月15日', kind: 'date', meaning: 'payment_date', supported: false }));

for (const subject of ['王月', '王日', '王时', '王時', '李月', '张日']) for (const full of [false, true])
  test(`a full anchored name is not a wage unit ${subject} full=${full}`, () => check({ text: `😀${subject}工资4000元。`, subject, full }));
for (const [text, subject] of [
  ['王月月工资4000元', '王月'], ['王日日工资4000元', '王日'], ['王时时工资4000元', '王时'],
  ['王月每月工资4000元', '王月'], ['王日工资4000元/日', '王日'], ['王时工资4000元按小时计', '王时'],
  ['王甲月工资4000元', '王甲'], ['王甲日工资4000元', '王甲'], ['王甲时工资4000元', '王甲'],
  ['王甲月工资4000元', '王甲月'], ['李王月工资4000元', '王月'], ['王月王月工资4000元', '王月'],
]) test(`an actual rate or unanchored model subject cannot be exempted ${text} / ${subject}`, () => check({ text: `😀${text}。`, subject, amount: null }));
for (const [subject, tail, rateUnit] of [['王月', '月工资', 'month'], ['王日', '日工资', 'day'], ['王时', '时工资', 'hour']])
  test(`a real correctly declared rate still survives ${subject}`, () => check({ text: `😀${subject}${tail}4000元。`, subject,
    meaning: 'rate', rateUnit }));
for (const text of ['王甲2026年1月工资4000元', '王甲今日工资合计4000元'])
  test(`ordinary calendar period stays exact ${text}`, () => check({ text: `😀${text}。` }));

for (const subject of ['王和平', '何和', '周及', '李与诚', '张及春', '王等明']) for (const full of [false, true])
  test(`conjunction in an anchored single name ${subject} full=${full}`, () => check({ text: `😀${subject}2026年1月全部应付工资合计4000元。`,
    subject, period: '2026年1月', full, supported: true }));
for (const subject of ['甲和乙', '张和李', '王甲和王乙', '王甲及乙', '王与李', '王甲等', '王甲、王乙', '王甲班组', '某单位',
  '明和亮', '一和二', '你和我', '甲和', 'A和B']) {
  test(`a coordinated or collective subject cannot be individual ${subject}`, () => check({ text: `😀${subject}2026年1月全部应付工资合计4000元。`,
    subject, period: '2026年1月', supported: false }));
  test(`a coordinated subject cannot own an individual date ${subject}`, () => check({ text: `😀${subject}于2026年1月入职。`,
    subject, value: '2026年1月', kind: 'date', meaning: 'employment_period', supported: false }));
}
for (const [text, subject] of [['王和平2026年1月王乙全部应付工资合计4000元', '王和平'],
  ['李王和平2026年1月全部应付工资合计4000元', '王和平'], ['王和平王和平2026年1月全部应付工资合计4000元', '王和平']])
  test(`a name is not proof of a unique owning event ${text}`, () => check({ text: `😀${text}。`, subject, period: '2026年1月', supported: false }));

for (const subject of ['王等', '甲等', '王等人']) for (const full of [false, true]) {
  test(`a terminal collective suffix is unresolved for money ${subject} full=${full}`, () => check({
    text: `😀${subject}2026年1月全部应付工资合计4000元。`, subject, period: '2026年1月', full, supported: false }));
  test(`a terminal collective suffix is unresolved for dates ${subject} full=${full}`, () => check({
    text: `😀${subject}于2026年1月入职。`, subject, value: '2026年1月', kind: 'date', meaning: 'employment_period', full, supported: false }));
}
for (const subject of ['他们', '她们', '我们', '你们', '大家', '各位', '诸位']) {
  test(`an explicit collective pronoun is not an individual total ${subject}`, () => check({
    text: `😀${subject}2026年1月全部应付工资合计4000元。`, subject, period: '2026年1月', supported: false }));
  test(`an explicit collective pronoun is not an individual date ${subject}`, () => check({
    text: `😀${subject}于2026年1月入职。`, subject, value: '2026年1月', kind: 'date', meaning: 'employment_period', supported: false }));
}

test('two equal amounts remain two separately anchored events', () => {
  const texts = ['😀王月工资4000元。', '王日工资4000元。'];
  const source = { id: 'two-name-events', name: '同额不同人', sha256: '9'.repeat(64), analysisRevision: 28, ready: true,
    blocks: texts.map((text, i) => ({ id: `b${i + 1}`, page: i + 1, text, bbox: null, confidence: null })) };
  const candidates = texts.map((quote, i) => ({ kind: 'money', value: '4000元', quote, blockId: `b${i + 1}`,
    subject: i ? '王日' : '王月', scope: 'individual', meaning: 'other_money', completeness: 'not_applicable',
    period: null, rateUnit: null, assertion: 'narrated' }));
  const raw = JSON.stringify({ schemaVersion: 3, candidates });
  const state = ingestRuntimeCandidates(emptyFactState(28), source, { raw }, 'synthetic', 'owner', AT);
  assert.equal(state.materials[0].raw, raw); assert.equal(state.materials[0].candidates.length, 2);
  for (const item of state.materials[0].candidates) assert.equal(item.amount, '4000.00');
  assert.deepEqual(state.materials[0].candidates.map(item => item.blockId), ['b1', 'b2']);
  assert.equal(state.calculation, null);
});

for (const texts of [['😀王甲工资5角', '2分RMB。'], ['😀王甲工资5元', '2分RMB。'], ['😀王甲工资5角\u200b \t', ' 2分RMB。']])
  for (const full of [false, true]) test(`a new RMB cents fragment cannot crop the preceding amount ${JSON.stringify(texts)} full=${full}`,
    () => check({ texts, value: '2分RMB', meaning: 'other_money', literalAmount: '0.02', amount: null, full }));
for (const [texts, subject] of [[['😀王甲工资5角。', '2分RMB。'], '王甲'],
  [['😀王甲工资5角', '王乙收到2分RMB。'], '王乙'], [['😀王甲工作5分钟', '2分RMB。'], '王甲']])
  test(`punctuation, another owner or a nonmoney unit stops the cents bridge ${JSON.stringify(texts)}`,
    () => check({ texts, subject, value: '2分RMB', meaning: 'other_money', literalAmount: '0.02', amount: '0.02' }));

test('a cropped cents tail cannot borrow another equal-amount event in any of the six scores', () => {
  const source = { id: 'round28-cents-events', name: '合成分币事件', sha256: '7'.repeat(64), analysisRevision: 28, ready: true,
    blocks: ['😀王甲工资5角', '2分RMB。', '王乙收到2分RMB。'].map((text, i) => ({ id: `b${i + 1}`, page: i + 1, text, bbox: null, confidence: null })) };
  const expected = { kind: 'money', value: '2分RMB', quote: '2分RMB', blockId: 'b3', subject: '王乙', scope: 'individual',
    meaning: 'paid_total', completeness: 'complete', period: null, rateUnit: null, assertion: 'narrated' };
  const label = { id: 'round28-cents-events', expected: [expected], expected_event_ids: ['payment'], events: [
    { id: 'tail', anchors: [{ blockId: 'b2', start: 0, end: 5 }] },
    { id: 'payment', anchors: [{ blockId: 'b3', start: 4, end: 9 }] },
  ] };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [{ ...expected, blockId: 'b2' }] });
  const report = assessCase({ id: label.id, source }, label, { finish_reason: 'stop', raw_output: raw });
  for (const layer of ['raw_basic', 'accepted_basic', 'raw_relational', 'accepted_relational', 'raw_strict', 'accepted_strict'])
    assert.deepEqual([report[layer].tp, report[layer].fp, report[layer].fn], [0, 1, 1], layer);
  assert.equal(report.production_defense[0].amount, null);
});
