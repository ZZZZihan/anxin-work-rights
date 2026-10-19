// ROUND35 complete-currency closure: synthetic real-ingest/read-review checks only. No model, HTTP,
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
  full = false, omitBbox = false, subject = '王甲', group, complete = false, sourceMismatch, unresolvedBoundary, relationWarning, status }) {
  const source = { id: 'round33-synthetic', name: '合成币种人数与块边界', sha256: 'a'.repeat(64), analysisRevision: 33, ready: true,
    blocks: texts.map((text, i) => ({ id: `b${i + 1}`, page: pages?.[i] || 1, text, ...(omitBbox ? {} : { bbox: bboxes?.[i] || null }), confidence: null })) };
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

// Seven groups share identical actual-ingest/read-review assertions. USD/港币
// are previous passing controls; the other five expose the private-wordlist gap.
for (const currency of ['USD', '港币', '港元', '美元', 'EUR', 'JPY', 'HKD'])
  test('all existing whole-tail foreign currency guards remain unavailable: '+currency, () => {
    for (const full of [false, true]) for (const value of ['4000元', '4000元整']) check({
      texts:['😀王甲工资4000元整',currency+'。'], value, full, amount:null, sourceMismatch:true, relationWarning:true,
    });
  });
for (const [first,second,value] of [
  ['😀王甲收到人民币五角','星','人民币五角'],
  ['😀王甲收到人民币2分','钟','人民币2分'],
]) test('optional bbox does not throw in lexical continuation: '+value, () => {
  for (const full of [false,true]) check({texts:[first,second],value,full,amount:null,omitBbox:true});
});
