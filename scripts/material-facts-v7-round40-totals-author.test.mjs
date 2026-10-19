// R40 finite individual 应发/实发 complete-total attribution. Synthetic only.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.MATERIAL_FACT_TEST_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const EVENT = resolve(process.env.MATERIAL_FACT_EVENT_FILE || resolve(ROOT, 'lib/material-fact-event-review.ts'));
const directory = await mkdtemp(resolve(tmpdir(), 'anxin-r40-totals-'));
after(() => rm(directory, { recursive: true, force: true }));
await cp(resolve(ROOT, 'lib'), resolve(directory, 'lib'), { recursive: true });
await cp(EVENT, resolve(directory, 'lib/material-fact-event-review.ts'));
const load = name => import(pathToFileURL(resolve(directory, 'lib', name)).href);
const { hasSupportedCandidateAttribution: attribution, hasSupportedTotalRelationship: total } = await load('material-fact-event-review.ts');
const { ingestRuntimeCandidates: ingest } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, buildFactView } = await load('material-facts-v3.ts');
const { reviewFactsAgainstSources: review } = await load('material-fact-source-review.ts');
const AT = '2026-10-19T22:00:00.000Z';
const count = text => Array.from(text).length;
console.log(JSON.stringify({ node: process.version, dependency_root: ROOT, event_file: EVENT,
  event_sha256: createHash('sha256').update(await readFile(EVENT)).digest('hex') }));

function originalNormalization(item) {
  const amount = item.value.startsWith('3500') ? '3500.00' : '4000.00';
  const matchedText = amount === '3500.00' ? '3500元' : '4000元';
  return { rawValue: item.value, status: 'exact', amount, matchedText,
    span: { start: 0, end: count(matchedText) }, reason: 'Synthetic unconfirmed historical exact observation.' };
}
function viewValues(state, source, meaning, subject) {
  const scoped = structuredClone(state);
  scoped.scope = { worker: subject, employer: '甲公司', start: '2026-01-01', end: '2026-01-31' };
  scoped.scopeReview = { note: 'Synthetic scope-only review; no amount confirmation.', actor: 'fixture', at: AT };
  const view = buildFactView(scoped, [source]);
  assert.equal(view.canCalculate, false);
  assert.deepEqual(scoped.confirmations, { due: null, paid: null });
  assert.equal(scoped.calculation, null);
  return view.fields[meaning === 'paid_total' ? 'paid' : 'due'].values;
}
function check(options) {
  const meaning = options.meaning || 'due_total', subject = options.subject || '王甲';
  const amount = options.amount || (meaning === 'paid_total' ? '3500.00' : '4000.00');
  const token = amount.slice(0, -3) + '元';
  const blocks = options.blocks || [{ text: '😀' + (options.sourceSubject || subject) + '2026年1月' + options.role + token + '人民币。' }];
  const index = options.index || 0, text = blocks[index].text;
  const source = { id: 'r40-totals', name: 'synthetic.txt', sha256: '4'.repeat(64), analysisRevision: 40, ready: true,
    blocks: blocks.map((b, i) => ({ id: 'b' + (i + 1), page: b.page || 1, text: b.text, bbox: null, confidence: null })) };
  for (const value of [token, token + '人民币']) for (const quote of [value, text]) {
    const item = { kind: 'money', value, quote, blockId: 'b' + (index + 1), subject, scope: options.scope || 'individual',
      meaning, completeness: options.completeness || 'complete',
      period: Object.hasOwn(options, 'period') ? options.period : '2026年1月', rateUnit: null, assertion: 'narrated' };
    const evidence = JSON.stringify({ schemaVersion: 3, candidates: [item] });
    const normalized = originalNormalization(item);
    if (options.direct !== false) {
      const sentence = text.replace(/。$/u, '');
      assert.equal(total(item, sentence, normalized), options.supported, 'Complete total must bind the same explicit owner/period/role');
      assert.equal(attribution(item, sentence, normalized), options.supported, 'This finite role family is not an arbitrary attribution parser');
    }
    const older = legacy(emptyFactState(40), source, { raw: evidence }, 'synthetic', 'fixture', AT);
    assert.equal(older.materials[0].candidates.length, 1, 'Fixture must reach runtime review rather than fail protocol');
    Object.assign(older.materials[0].candidates[0], { amount, normalization: normalized });
    const stored = structuredClone(older), original = structuredClone({ source, item });
    for (const state of [ingest(emptyFactState(40), source, { raw: evidence }, 'synthetic', 'fixture', AT), review(older, [source])]) {
      assert.equal(state.materials[0].candidates.length, 1);
      const candidate = state.materials[0].candidates[0];
      assert.equal(candidate.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), !options.supported);
      if (options.supported) assert.equal(candidate.amount, amount);
      assert.deepEqual(viewValues(state, source, meaning, subject), options.supported ? [amount] : []);
      assert.deepEqual(candidate.representation, item);
      assert.equal(state.materials[0].raw, evidence);
      assert.equal(Array.from(text).slice(candidate.start, candidate.end).join(''), quote);
      assert.equal(candidate.start, count(text.slice(0, text.indexOf(quote))));
      assert.deepEqual(state.confirmations, { due: null, paid: null });
      assert.equal(state.calculation, null);
    }
    assert.deepEqual(older, stored, 'Read-time review cannot rewrite stored raw, normalization or history');
    assert.deepEqual({ source, item }, original);
    older.materials[0].candidates[0].amount = null;
    older.materials[0].candidates[0].normalization = { ...normalized, status: 'unsupported', amount: null,
      matchedText: null, span: null, reason: 'Synthetic historical unavailable observation.' };
    const noUpgrade = review(older, [source]);
    assert.equal(noUpgrade.materials[0].candidates[0].amount, null);
    assert.deepEqual(viewValues(noUpgrade, source, meaning, subject), []);
  }
}

for (const [name, role, meaning] of [
  ['simplified due', '应发工资合计', 'due_total'],
  ['simplified paid', '实发工资合计', 'paid_total'],
  ['traditional due', '應發工資合計', 'due_total'],
  ['traditional paid', '實發工資合計', 'paid_total'],
  ['due with explicit whole period', '全部应发薪酬总额', 'due_total'],
  ['paid with explicit whole period', '全部实发薪资总计', 'paid_total'],
  ['wage first due role', '工资应发共计', 'due_total'],
  ['traditional wage first paid role', '工資實發累計', 'paid_total'],
]) test(name, () => check({ role, meaning, supported: true }));

for (const [name, options] of [
  ['plural kinship label', { subject: '王氏兄弟' }],
  ['explicit both parties', { subject: '双方' }],
  ['coordinated two-person label', { subject: '王甲和王乙' }],
  ['cropped model owner cannot hide two people', { subject: '王甲', sourceSubject: '王甲和王乙' }],
  ['group header before the claimed owner', { blocks: [{ text: '全体工人' }, { text: '😀王甲2026年1月应发工资合计4000元人民币。' }], index: 1, direct: false }],
  ['another beneficiary event cannot be borrowed', { blocks: [{ text: '😀王甲2026年1月应发工资合计5000元人民币。李乙2026年1月应发工资合计4000元人民币。' }], subject: '王甲', direct: false }],
  ['period from another event cannot be borrowed', { blocks: [{ text: '😀王甲2026年2月应发工资合计4000元人民币。' }, { text: '王甲2026年1月应发工资合计5000元人民币。' }], direct: false }],
  ['longer wage period cannot be cropped', { blocks: [{ text: '😀王甲2026年1月至2月应发工资合计4000元人民币。' }] }],
  ['partial qualifier', { role: '应发工资部分合计' }],
  ['no complete-total cue', { role: '应发工资' }],
  ['negated due statement', { role: '并非应发工资合计' }],
  ['negated paid statement', { role: '未实发工资合计', meaning: 'paid_total' }],
  ['paid event mislabeled as due', { role: '实发工资合计', meaning: 'due_total' }],
  ['due event mislabeled as paid', { role: '应发工资合计', meaning: 'paid_total' }],
  ['due and paid mixed in one amount envelope', { role: '应发实发工资合计' }],
  ['new role must not authorize a partial candidate', { role: '应发工资合计', completeness: 'partial', direct: false }],
  ['new role needs an explicit wage period', { role: '应发工资合计', period: null }],
  ['component is not the wage total vocabulary', { role: '应发奖金合计' }],
  ['following omitted component prevents complete total', { blocks: [{ text: '😀王甲2026年1月应发工资合计4000元人民币但不含加班费。' }] }],
  ['same amount in a paid event cannot serve a due event', { blocks: [{ text: '😀王甲2026年1月实发工资合计4000元人民币。' }, { text: '王甲2026年1月应发工资合计4000元人民币。' }], direct: false }],
]) test(name, () => check({ role: '应发工资合计', supported: false, ...options }));

for (const [name, role, meaning] of [
  ['old simplified due', '全部应付工资合计', 'due_total'],
  ['old simplified paid', '全部已付工资合计', 'paid_total'],
  ['old traditional due', '全部應付工資合計', 'due_total'],
  ['old traditional paid', '全部實付工資合計', 'paid_total'],
]) test(name, () => check({ role, meaning, supported: true }));
