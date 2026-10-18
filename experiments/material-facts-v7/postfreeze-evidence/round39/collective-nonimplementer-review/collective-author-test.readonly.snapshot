// R39 finite plural-owner runtime regression. No HTTP, scorer CLI or models.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.MATERIAL_FACT_TEST_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const EVENT = resolve(process.env.MATERIAL_FACT_EVENT_FILE || resolve(ROOT, 'lib/material-fact-event-review.ts'));
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-r39-collective-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(ROOT, 'lib'), resolve(temporary, 'lib'), { recursive: true });
await cp(EVENT, resolve(temporary, 'lib/material-fact-event-review.ts'));
const load = file => import(pathToFileURL(resolve(temporary, 'lib', file)).href);
const { hasSupportedCandidateAttribution: attribution, hasSupportedTotalRelationship: total } = await load('material-fact-event-review.ts');
const { ingestRuntimeCandidates: fresh } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, buildFactView } = await load('material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('material-fact-source-review.ts');
const cpLength = text => Array.from(text).length;
const AT = '2026-10-19T20:00:00.000Z';
console.log(JSON.stringify({ node: process.version, dependency_root: ROOT,
  event_sha256: createHash('sha256').update(await readFile(EVENT)).digest('hex') }));

function normalization(raw, amount = '4000.00') {
  const start = cpLength(raw.value.slice(0, raw.value.indexOf('4000元')));
  return { rawValue: raw.value, status: amount === null ? 'unsupported' : 'exact', amount,
    matchedText: amount === null ? null : '4000元', span: amount === null ? null : { start, end: start + 5 },
    reason: 'Synthetic unconfirmed historical observation.' };
}
function sourceFor(blocks) {
  return { id: 'r39-plural', name: 'synthetic.txt', sha256: '9'.repeat(64), analysisRevision: 39, ready: true,
    blocks: blocks.map((item, index) => ({ id: `b${index + 1}`, page: item.page ?? 1,
      text: item.text, bbox: null, confidence: null })) };
}
function usable(state, source, subject, meaning) {
  const copy = structuredClone(state);
  copy.scope = { worker: subject, employer: '甲公司', start: '2026-01-01', end: '2026-01-31' };
  copy.scopeReview = { note: 'Synthetic scope review only; no amount confirmation.', actor: 'fixture', at: AT };
  const view = buildFactView(copy, [source]);
  assert.equal(view.canCalculate, false); assert.equal(copy.calculation, null);
  assert.deepEqual(copy.confirmations, { due: null, paid: null });
  return view.fields[meaning === 'paid_total' ? 'paid' : 'due'].values;
}
function checkMoney(subject, expected, options = {}) {
  const meaning = options.meaning || 'due_total';
  const role = meaning === 'paid_total' ? '全部已付工资合计' : '全部应付工资合计';
  const blocks = options.blocks || [{ text: `😀${subject}2026年1月${role}4000元人民币。` }];
  const index = options.index || 0, text = blocks[index].text, source = sourceFor(blocks);
  for (const value of ['4000元', '4000元人民币']) for (const quote of [value, text]) {
    const item = { kind: 'money', value, quote, blockId: `b${index + 1}`, subject, scope: 'individual',
      meaning, completeness: 'complete', period: '2026年1月', rateUnit: null, assertion: 'narrated' };
    const raw = JSON.stringify({ schemaVersion: 3, candidates: [item] });
    const directText = text.replace(/[。]$/u, '');
    if (!options.skipDirect) {
      assert.equal(attribution(item, directText, normalization(item)), expected, 'Only a supported single owner can acquire attribution');
      assert.equal(total(item, directText, normalization(item)), expected, 'Plural owners must not acquire a personal complete total');
    }
    const old = legacy(emptyFactState(39), source, { raw }, 'synthetic', 'fixture', AT);
    assert.equal(old.materials[0].candidates.length, 1);
    Object.assign(old.materials[0].candidates[0], { amount: '4000.00', normalization: normalization(item) });
    const stored = structuredClone(old), original = structuredClone({ source, item });
    for (const state of [fresh(emptyFactState(39), source, { raw }, 'synthetic', 'fixture', AT), reviewFactsAgainstSources(old, [source])]) {
      assert.equal(state.materials[0].candidates.length, 1, 'Retain the observation instead of deleting a plural-owner candidate');
      const candidate = state.materials[0].candidates[0];
      assert.equal(candidate.amount, '4000.00', 'Literal precision is separate from personal-total eligibility');
      assert.equal(candidate.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), !expected);
      assert.deepEqual(usable(state, source, subject, meaning), expected ? ['4000.00'] : []);
      assert.deepEqual(candidate.representation, item); assert.equal(state.materials[0].raw, raw);
      assert.equal(Array.from(text).slice(candidate.start, candidate.end).join(''), quote);
      assert.equal(candidate.start, cpLength(text.slice(0, text.indexOf(quote))));
      assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
    }
    assert.deepEqual(old, stored, 'Read-time review must not rewrite stored raw, status or history');
    assert.deepEqual({ source, item }, original);
    old.materials[0].candidates[0].amount = null;
    old.materials[0].candidates[0].normalization = normalization(item, null);
    const oldNull = reviewFactsAgainstSources(old, [source]);
    assert.equal(oldNull.materials[0].candidates[0].amount, null, 'Never upgrade an older unavailable amount');
    assert.deepEqual(usable(oldNull, source, subject, meaning), []);
  }
}

for (const subject of ['王氏兄弟', '双方', '雙方', '张氏姐妹', '李某夫妻', '李某夫妇', '李某夫婦', '父子', '父女', '母子', '母女', '祖孙', '祖孫', '各方', '多方'])
  test(`explicit plural owner cannot suggest an individual due total: ${subject}`, () => checkMoney(subject, false));
for (const subject of ['王氏兄弟', '双方'])
  test(`plural paid-total uses the same owner guard: ${subject}`, () => checkMoney(subject, false, { meaning: 'paid_total' }));
for (const subject of ['王甲', '何和', '周及', '王等明', '王兄', '李姐'])
  test(`existing finite individual owner control: ${subject}`, () => checkMoney(subject, true));
for (const subject of ['王甲和王乙', '王等', '全体工人'])
  test(`pre-existing collective guards stay in force: ${subject}`, () => checkMoney(subject, false));
for (const subject of ['王氏', '王甲']) {
  const owner = subject === '王氏' ? '王氏兄弟' : '王甲与王乙';
  test(`cropping the model subject cannot remove visible plural cue: ${subject}`, () => checkMoney(subject, false,
    { blocks: [{ text: `😀${owner}2026年1月全部应付工资合计4000元人民币。` }] }));
}
for (const page of [1, 2]) {
  test(`a preceding plural header remains unresolved across source block/page ${page}`, () => checkMoney('王甲', false, {
    blocks: [{ text: '王氏兄弟', page: 1 }, { text: '😀王甲2026年1月全部应付工资合计4000元人民币。', page }],
    index: 1, skipDirect: true,
  }));
  test(`another independent plural event cannot be silently borrowed on page ${page}`, () => checkMoney('王甲', false, {
    blocks: [{ text: '😀王甲2026年1月全部应付工资合计4000元人民币。', page: 1 },
      { text: '双方2026年2月另有工资5000元。', page }], skipDirect: true,
  }));
}
test('a repeated same-amount different-owner occurrence is not personal evidence for the plural one', () => {
  const first = '😀双方2026年1月全部应付工资合计4000元人民币。';
  checkMoney('双方', false, { blocks: [{ text: first }, { text: '王甲2026年1月全部应付工资合计4000元人民币。' }] });
});
for (const subject of ['王氏兄弟', '双方']) test(`plural owner cannot borrow a supported individual date: ${subject}`, () => {
  const value = '2026年1月', text = `😀${subject}於${value}入職`;
  const item = { kind: 'date', value, quote: text, blockId: 'b1', subject, scope: 'individual',
    meaning: 'employment_period', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
  const normalized = { rawValue: value, status: 'unsupported', amount: null, span: null, matchedText: null, reason: 'Synthetic date.' };
  const before = structuredClone({ item, normalized });
  assert.equal(attribution(item, text, normalized), false);
  assert.deepEqual({ item, normalized }, before);
});
