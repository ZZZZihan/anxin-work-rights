import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Synthetic source/history checks only: no HTTP, model, frozen data or scoring.
const OWN = fileURLToPath(new URL('../', import.meta.url));
const BASE = resolve(process.env.V7_WEEKDAY_BASE_ROOT || OWN);
const PATCH = resolve(process.env.V7_WEEKDAY_PATCH_ROOT || OWN);
const temp = await mkdtemp(resolve(tmpdir(), 'anxin-weekday-source-rate-author-'));
after(() => rm(temp, { recursive: true, force: true }));
await cp(resolve(BASE, 'lib'), resolve(temp, 'lib'), { recursive: true });
const sourceFile = 'lib/material-fact-source-review.ts';
await cp(resolve(PATCH, sourceFile), resolve(temp, sourceFile));
console.log(JSON.stringify({ reviewed_source_sha256: createHash('sha256').update(await readFile(resolve(temp, sourceFile))).digest('hex') }));
const load = name => import(pathToFileURL(resolve(temp, 'lib', name)).href);
const { ingestRuntimeCandidates: fresh } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, buildFactView } = await load('material-facts-v3.ts');
const { reviewFactsAgainstSources: review } = await load('material-fact-source-review.ts');
const chars = text => Array.from(text).length;

function fixture(before, { full = false, blocks = false, subject = '王甲', meaning = 'due_total', rateUnit = null,
  value = '400元', after = '。' } = {}) {
  const parts = blocks ? before.split('\n') : [before];
  const texts = parts.map((part, index) => (index === 0 ? '😀𠮷' : '') + part);
  texts[texts.length - 1] += value + after;
  const blockId = `b${texts.length}`, blockText = texts.at(-1);
  const candidate = { kind: 'money', value, quote: full ? blockText : value, blockId, subject, scope: 'individual', meaning,
    completeness: ['due_total', 'paid_total'].includes(meaning) ? 'complete' : 'not_applicable', period: null, rateUnit, assertion: 'narrated' };
  return { candidate, raw: JSON.stringify({ schemaVersion: 3, candidates: [candidate] }), source: {
    id: 'weekday-source-author', name: '合成星期期间费率边界', sha256: '2'.repeat(64), analysisRevision: 21, ready: true,
    blocks: texts.map((text, index) => ({ id: `b${index + 1}`, page: index + 1, text, bbox: null, confidence: null })),
  } };
}
function ingest(f, historical = false) {
  const sourceBefore = structuredClone(f.source);
  const state = (historical ? legacy : fresh)(emptyFactState(21), f.source, { raw: f.raw }, 'weekday-source-author', 'synthetic', '2026-10-18T00:00:00Z');
  assert.deepEqual(f.source, sourceBefore); assert.equal(state.materials[0].raw, f.raw);
  assert.equal(state.materials[0].candidates.length, 1); assert.equal(state.materials[0].rejected.length, 0);
  const fact = state.materials[0].candidates[0], block = f.source.blocks.find(item => item.id === fact.blockId);
  assert.deepEqual(fact.representation, f.candidate);
  assert.equal(Array.from(block.text).slice(fact.start, fact.end).join(''), f.candidate.quote);
  assert.equal(fact.start, chars(block.text.slice(0, block.text.indexOf(f.candidate.quote))));
  assert.equal(fact.sourceSha256, f.source.sha256);
  assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
  assert.equal(buildFactView(state, [f.source]).canCalculate, false);
  return state;
}
function check(before, options = {}, expected = null, status = 'unsupported') {
  const f = fixture(before, options), state = ingest(f), current = state.materials[0].candidates[0];
  assert.equal(current.amount, expected); assert.equal(current.normalization.status, status);
  const old = ingest(f, true), stored = old.materials[0].candidates[0];
  Object.assign(stored, { amount: '400.00', normalization: { rawValue: f.candidate.value, amount: '400.00', status: 'exact',
    matchedText: f.candidate.value, span: { start: 0, end: chars(f.candidate.value) }, reason: 'Synthetic pre-fix exact, not a real experiment result.' } });
  const snapshot = structuredClone(old), checked = review(old, [f.source]).materials[0].candidates[0];
  assert.equal(checked.amount, expected); assert.equal(checked.normalization.status, status);
  assert.deepEqual(checked.representation, f.candidate); assert.equal(checked.normalization.rawValue, f.candidate.value);
  assert.deepEqual(old, snapshot); assert.equal(old.materials[0].raw, f.raw);
  stored.amount = null; stored.normalization = { ...stored.normalization, amount: null, status: 'unsupported' };
  const nullSnapshot = structuredClone(old); assert.equal(review(old, [f.source]).materials[0].candidates[0].amount, null);
  assert.deepEqual(old, nullSnapshot);
}

for (const weekday of ['周日', '星期日', '礼拜日'])
  test(`minimal explicit weekday is a wage period ${weekday}`, () => check('王甲' + weekday + '工资', {}, '400.00', 'exact'));
for (const weekday of ['周日', '週日', '星期日', '礼拜日', '禮拜日'])
  for (const wage of ['工资', '基本工资']) for (const full of [false, true])
    test(`weekday period remains usable ${weekday}${wage}, full=${full}`,
      () => check('王甲' + weekday + wage, { full }, '400.00', 'exact'));
for (const before of ['王甲周 日工资', '王甲星\u200d期日工资', '王甲禮拜日工資合計', '王甲週日基本工資為'])
  for (const full of [false, true]) test(`finite weekday detection copy ${JSON.stringify(before)}, full=${full}`,
    () => check(before, { full }, '400.00', 'exact'));
for (const before of ['王甲每日工资', '王甲每天工资', '王甲按日工资', '王甲按天工资',
  '王甲日工资', '王甲日基本工资', '王甲周日工资标准为', '王甲星期日基本工资标准为'])
  for (const full of [false, true]) test(`explicit day rate retains precedence ${before}, full=${full}`, () => {
    check(before, { full }, null, 'rate_unit_mismatch');
    check(before, { full, meaning: 'rate', rateUnit: 'day' }, '400.00', 'exact');
  });
for (const before of ['王甲每周日工资', '王甲按星期日工资'])
  for (const full of [false, true]) test(`repeating weekday cannot become an unlabelled total ${before}, full=${full}`,
    () => check(before, { full }, null, 'rate_unit_mismatch'));
for (const [before, subject] of [['王甲每日工资', '王甲每日'], ['王甲每天工资', '王甲每天']])
  for (const full of [false, true]) test(`supplied subject cannot absorb explicit day rate ${subject}, full=${full}`,
    () => check(before, { subject, full }, null, 'rate_unit_mismatch'));
for (const subject of ['王周', '李星期']) for (const full of [false, true])
  test(`a literal subject ending in a weekday introducer retains its following day rate ${subject}, full=${full}`, () => {
    check(subject + '日工资', { subject, full }, null, 'rate_unit_mismatch');
    check(subject + '日工资', { subject, full, meaning: 'rate', rateUnit: 'day' }, '400.00', 'exact');
  });
for (const [value, status] of [['工资金额不详', 'masked'], ['约400元', 'approximate'], ['400元至500元', 'range']])
  test(`weekday does not erase uncertainty ${value}`, () => {
    const f = fixture('王甲周日', { value }), state = ingest(f);
    assert.equal(state.materials[0].candidates[0].amount, null);
    assert.equal(state.materials[0].candidates[0].normalization.status, status);
  });
for (const unit of ['日', '天']) test(`suffix /${unit} remains a rate after weekday wording`, () => {
  check('王甲周日工资', { after: '/' + unit + '。' }, null, 'rate_unit_mismatch');
  check('王甲周日工资', { after: '/' + unit + '。', meaning: 'rate', rateUnit: 'day' }, '400.00', 'exact');
});
for (const before of ['王甲周一工资', '王甲星期六基本工资']) test(`other weekday period remains unchanged ${before}`,
  () => check(before, {}, '400.00', 'exact'));
