import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const IMPLEMENTATION = fileURLToPath(new URL('../', import.meta.url));
const BASE = resolve(process.env.V7_ROUND23_BASELINE_ROOT || IMPLEMENTATION);
const temp = await mkdtemp(resolve(tmpdir(), 'anxin-qualified-money-bounds-'));
after(() => rm(temp, { recursive: true, force: true }));
await cp(resolve(BASE, 'lib'), resolve(temp, 'lib'), { recursive: true });
for (const [name, override] of [['material-money-v4.ts', process.env.V7_MONEY_TEST_FILE], ['material-fact-range-review.ts', process.env.V7_RANGE_TEST_FILE]]) {
  const file = resolve(override || resolve(IMPLEMENTATION, 'lib', name));
  await cp(file, resolve(temp, 'lib', name));
  console.log(JSON.stringify({ file: name, sha256: createHash('sha256').update(await readFile(file)).digest('hex') }));
}
const load = name => import(pathToFileURL(resolve(temp, 'lib', name)).href);
const { normalizeMoneyValueV4: money, normalizeCandidateValueV4: normalize } = await load('material-money-v4.ts');
const { ingestRuntimeCandidates: fresh } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy } = await load('material-facts-v3.ts');
const { reviewFactsAgainstSources: review } = await load('material-fact-source-review.ts');
const cpLength = value => Array.from(value).length;
function fixture(expression, value = expression) {
  const prefix = '😀𠮷王甲工资';
  const source = { id: 'round23-qualified-money', name: 'synthetic-qualified-money', sha256: 'c'.repeat(64), ready: true, analysisRevision: 15,
    blocks: [{ id: 'b1', page: 1, text: prefix + expression + '。', bbox: null, confidence: null }] };
  const candidate = { kind: 'money', value, quote: value, blockId: 'b1', subject: '王甲', scope: 'individual',
    meaning: 'arrears', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [candidate] });
  return { source, candidate, raw, prefix, expression };
}
function ingest(f, old = false) {
  const before = structuredClone(f.source);
  const state = (old ? legacy : fresh)(emptyFactState(15), f.source, { raw: f.raw }, 'round23-author', 'synthetic', '2026-10-18T00:00:00Z');
  assert.deepEqual(f.source, before);
  assert.equal(state.materials[0].raw, f.raw);
  assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
  assert.equal(state.materials[0].candidates.length, 1);
  const fact = state.materials[0].candidates[0], quoteAt = f.source.blocks[0].text.indexOf(f.candidate.quote);
  assert.deepEqual(fact.representation, f.candidate);
  assert.equal(fact.start, cpLength(f.source.blocks[0].text.slice(0, quoteAt)));
  assert.equal(fact.end, cpLength(f.source.blocks[0].text.slice(0, quoteAt + f.candidate.quote.length)));
  return state;
}
function unavailable(expression, value, status) {
  const f = fixture(expression, value), normalized = normalize({ ...f.candidate, quote: f.source.blocks[0].text });
  assert.equal(normalized.amount, null);
  assert.equal(normalized.normalization.rawValue, value);
  if (status) assert.equal(normalized.normalization.status, status);
  assert.equal(ingest(f).materials[0].candidates[0].amount, null);
  const old = ingest(f, true), fact = old.materials[0].candidates[0];
  Object.assign(fact, { amount: money(value).amount || '40000.00', normalization: money(value) });
  const before = structuredClone(old), reviewed = review(old, [f.source]);
  assert.equal(reviewed.materials[0].candidates[0].amount, null);
  assert.equal(reviewed.materials[0].raw, f.raw); assert.deepEqual(old, before);
}


for (const [before, after] of [['最多',''], ['最少',''], ['', '内'], ['', '之内'], ['', '內'], ['', '之內']]) {
 const expression=before+'四万元'+after;
 test(`whole compact money bound remains approximate: ${expression}`,()=>{
  const n=money(expression);assert.equal(n.amount,null);assert.equal(n.status,'approximate');assert.equal(n.rawValue,expression);
 });
 for (const layout of ['', ' ', '\n', '\r\n', '\u200b']) {
  test(`cropped compact bound at original source: ${JSON.stringify(before+layout+'四万元'+layout+after)}`,()=>unavailable(before+layout+'四万元'+layout+after,'四万元','approximate'));
 }
 for (const full of [false,true]) test(`compact bound preserves raw and stored null without upgrade: ${expression}/${full}`,()=>{
  const f=fixture(expression,'四万元');if(full){f.candidate.quote=f.source.blocks[0].text;f.raw=JSON.stringify({schemaVersion:3,candidates:[f.candidate]});}
  const state=ingest(f),fact=state.materials[0].candidates[0];assert.equal(fact.amount,null);
  const old=ingest(f,true);Object.assign(old.materials[0].candidates[0],{amount:null,normalization:{...money('四万元'),amount:null,status:'unsupported'}});
  const snapshot=structuredClone(old);assert.equal(review(old,[f.source]).materials[0].candidates[0].amount,null);assert.deepEqual(old,snapshot);
 });
}
for (const prose of ['内部核对','内容已经核对','内控审查','内地发放','內部核對','内含工资']) for(const full of [false,true]) test(`ordinary word keeps its boundary: ${prose}/${full}`,()=>{
 const f=fixture('四万元'+prose,'四万元');if(full){f.candidate.quote=f.source.blocks[0].text;f.raw=JSON.stringify({schemaVersion:3,candidates:[f.candidate]});}
 assert.equal(ingest(f).materials[0].candidates[0].amount,'40000.00');
});
for(const separator of ['，','。','；','\n']) test(`another person's maximum does not govern this amount: ${JSON.stringify(separator)}`,()=>{
 const f=fixture('四万元'+separator+'王乙最多工资三万元','四万元');assert.equal(ingest(f).materials[0].candidates[0].amount,'40000.00');
});
