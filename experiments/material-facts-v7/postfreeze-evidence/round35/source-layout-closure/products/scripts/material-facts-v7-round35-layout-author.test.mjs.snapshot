// ROUND35: synthetic real-ingest/read-review checks only. No model, HTTP,
// historical CLI, scorer, build, or frozen material is executed/read.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const OWN = fileURLToPath(new URL('../', import.meta.url));
const BASE = resolve(process.env.MATERIAL_FACT_TEST_ROOT || OWN);
const PATCH = resolve(process.env.MATERIAL_FACT_PATCH_ROOT || OWN);
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-round33-group-layout-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(BASE, 'lib'), resolve(temporary, 'lib'), { recursive: true });
for (const file of ['material-fact-source-review.ts']) await cp(resolve(PATCH, 'lib', file), resolve(temporary, 'lib', file));
const load = path => import(pathToFileURL(resolve(temporary, 'lib', path)));
const { ingestRuntimeCandidates: ingest } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, buildFactView } = await load('material-facts-v3.ts');
const { normalizeMoneyValueV4: money } = await load('material-money-v4.ts');
const { reviewCandidateAgainstSource: review } = await load('material-fact-source-review.ts');
console.log(JSON.stringify({ node: process.version, implementation: Object.fromEntries(await Promise.all(
  ['material-fact-source-review.ts'].map(async name => [name, createHash('sha256').update(await readFile(resolve(temporary, 'lib', name))).digest('hex')]))) }));
const cpLength = s => Array.from(s).length;
function check({ texts, value = '4000元', amount = '4000.00', pages, bboxes, blockIndex = 0,
  full = false, subject = '王甲', group, complete = false, sourceMismatch, unresolvedBoundary, relationWarning, status }) {
  const source = { id: 'round33-synthetic', name: '合成币种人数与块边界', sha256: 'a'.repeat(64), analysisRevision: 33, ready: true,
    blocks: texts.map((text, i) => ({ id: `b${i + 1}`, page: pages?.[i] || 1, text, bbox: bboxes?.[i] || null, confidence: null })) };
  const quote = full ? texts[blockIndex] : value;
  const row = { kind: 'money', value, quote, blockId: `b${blockIndex + 1}`, subject, scope: subject ? 'individual' : 'unknown', meaning: complete ? 'due_total' : 'other_money',
    completeness: complete ? 'complete' : 'not_applicable', period: complete ? '2026年1月' : null, rateUnit: null, assertion: 'narrated' };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [row] });
  const sourceBefore = structuredClone(source);
  const state = ingest(emptyFactState(33), source, { raw }, 'synthetic', 'author', '2026-10-19T00:00:00.000Z');
  assert.equal(state.materials[0].candidates.length, 1, 'Fixture reaches the actual candidate store');
  assert.equal(state.materials[0].rejected.length, 0);
  const old = legacy(emptyFactState(33), source, { raw }, 'synthetic', 'author', '2026-10-19T00:00:00.000Z');
  const candidate = old.materials[0].candidates[0]; assert(candidate);
  const normalized = money(value); assert.notEqual(normalized.amount, null, 'Standalone literal is a supported amount before source constraints');
  Object.assign(candidate, { amount: normalized.amount, normalization: normalized });
  const storedBefore = structuredClone(old);
  const observed = { fresh: state.materials[0].candidates[0], storedExact: review(candidate, source) };
  console.log(JSON.stringify({ evidence: 'round33_observation', texts, pages, bboxes, row, observed }));
  for (const [path, item] of Object.entries(observed)) {
    assert.equal(item.amount, amount, `${path}: ${JSON.stringify(texts)}`);
    if (relationWarning) assert(item.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'));
    if (status) assert.equal(item.normalization.status, status);
    if (group !== undefined) assert.equal(item.reviewIssues.some(issue => issue.code === 'scope_text_mismatch'), group, `${path}: group warning`);
    if (sourceMismatch !== undefined) assert.equal(item.reviewIssues.some(issue => issue.code === 'source_amount_context_mismatch'), sourceMismatch);
    if (unresolvedBoundary) assert.match(item.normalization.reason, /连续|边界/u);
    assert.deepEqual(item.representation, row); assert.equal(item.quote, quote); assert.equal(item.value, value);
    const text = texts[blockIndex], start = cpLength(text.slice(0, text.indexOf(quote)));
    assert.equal(item.start, start); assert.equal(item.end, start + cpLength(quote));
    assert.equal(Array.from(text).slice(item.start, item.end).join(''), quote);
    assert.equal(item.sourceSha256, source.sha256);
  }
  assert.deepEqual(old, storedBefore, 'Read-time review does not rewrite stored raw/state/history');
  assert.deepEqual(source, sourceBefore); assert.equal(state.materials[0].raw, raw);
  assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
  assert.equal(buildFactView(state, [source]).canCalculate, false);
  candidate.amount = null; candidate.normalization = { ...normalized, status: 'unsupported', amount: null };
  const nullBefore = structuredClone(old); assert.equal(review(candidate, source).amount, null); assert.deepEqual(old, nullBefore);
  return observed;
}

const independentTails = ['以上事实无争议', '至5000元为李乙工资', '×2是附件编号'];
for (const tail of independentTails) for (const full of [false, true]) test(`another page is not an attached expression: ${tail} full=${full}`, () => check({
  texts: ['😀王甲收到工资4000元', tail], pages: [1,2], full, amount:'4000.00', sourceMismatch:false, relationWarning:true }));
for (const head of ['不超过', '5000元至', '2×']) for (const full of [false,true]) test(`the previous page is not an attached expression: ${head} full=${full}`, () => check({
  texts:[head, '😀王甲收到工资4000元'], pages:[1,2], blockIndex:1,full,amount:'4000.00', sourceMismatch:false,relationWarning:true }));
for (const tail of independentTails) test(`unverified same-page prose is not asserted to be a formula: ${tail}`, () => check({
  texts:['😀王甲收到工资4000元',tail],amount:null,status:'uncertain',unresolvedBoundary:true,relationWarning:true }));
for (const [texts, blockIndex] of [
  [['😀王甲收到工资4000元','的2倍'],0], [['😀王甲收到工资4000元的','2倍'],0],
  [['😀王甲工资4000元','×2'],0], [['😀王甲工资4000元×','2'],0],
  [['😀王甲工资4000元','乘以出勤系数'],0], [['😀王甲工资4000元乘以','出勤係數'],0],
  [['😀王甲工资奖金乘以','4000元'],1], [['😀王甲工资2×','4000元'],1],
  [['😀王甲工资4000元至','5000元'],0], [['😀王甲工资4000元','至5000元'],0],
  [['😀王甲工资不得超过','4000元'],1], [['不得超过','4000元'],1],
  [['😀王甲工资4000元','以上'],0], [['😀王甲工资4000元','按月计'],0],
  [['😀王甲工资4000元按','周','计'],0], [['😀王甲工资4000元','/','小时'],0],
  [['😀王甲工资4000元','？'],0], [['😀王甲工资4000元暂','定'],0],
  [['😀王甲收到4000元','5角'],0], [['😀王甲收到5角','2分RMB。'],1],
]) for (const full of [false,true]) test(`explicit same-page fragment remains unavailable: ${JSON.stringify(texts)} full=${full}`, () => check({texts, blockIndex,full,amount:null,
  subject: texts[blockIndex].includes('王甲')?'王甲':null, value: blockIndex===1 && texts[1].startsWith('2分')?'2分RMB':'4000元'}));
for (const [texts,value] of [
  [['😀王甲收到人民币五角','星'],'人民币五角'], [['😀王甲收到人民币2分','钟'],'人民币2分'],
]) test('the existing lexical fragment guard remains: '+JSON.stringify(texts),()=>check({texts,value,amount:null}));
for (const texts of [ ['😀王甲收到4000元。','×2'], ['😀王甲收到4000元','备注：另一个人。','×2'],
  ['😀王甲收到4000元','李乙工资5000元'], ['😀王甲收到4000元','工人：李乙收到5000元'] ])
  test('an explicit break or independent owner cannot disappear: '+JSON.stringify(texts),()=>check({texts,amount:'4000.00',sourceMismatch:false,relationWarning:true}));
for (const tail of ['每月15日支付','每月第十五号发放']) test('a proven recurring schedule remains an amount: '+tail,()=>check({texts:['😀王甲工资4000元',tail],amount:'4000.00',relationWarning:true}));
