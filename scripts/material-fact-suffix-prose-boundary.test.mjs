import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const IMPLEMENTATION = fileURLToPath(new URL('../', import.meta.url));
const BASE = resolve(process.env.V7_ROUND21_BASELINE_ROOT || IMPLEMENTATION);
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
  const source = { id: 'round21-qualified-money', name: 'synthetic-qualified-money', sha256: 'c'.repeat(64), ready: true, analysisRevision: 15,
    blocks: [{ id: 'b1', page: 1, text: prefix + expression + '。', bbox: null, confidence: null }] };
  const candidate = { kind: 'money', value, quote: value, blockId: 'b1', subject: '王甲', scope: 'individual',
    meaning: 'arrears', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [candidate] });
  return { source, candidate, raw, prefix, expression };
}
function ingest(f, old = false) {
  const before = structuredClone(f.source);
  const state = (old ? legacy : fresh)(emptyFactState(15), f.source, { raw: f.raw }, 'round21-author', 'synthetic', '2026-10-18T00:00:00Z');
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

for (const prose of ['起诉至法院','起訴至法院','多次催讨','多人申请执行','余额已经确认','餘額已经确认','余款已结清','许可支付','許可支付','许诺支付']) {
 for (const full of [false,true]) test(`ordinary prose cannot lend its first character as a money bound: ${prose}, full=${full}`,()=>{
  const f=fixture('四万元'+prose,'四万元');
  if(full){f.candidate.quote=f.source.blocks[0].text;f.raw=JSON.stringify({schemaVersion:3,candidates:[f.candidate]});}
  assert.equal(ingest(f).materials[0].candidates[0].amount,'40000.00');
  assert.equal(normalize({...f.candidate,quote:f.source.blocks[0].text}).amount,'40000.00');
  const old=ingest(f,true);Object.assign(old.materials[0].candidates[0],{amount:'40000.00',normalization:money('四万元')});
  const before=structuredClone(old), checked=review(old,[f.source]);
  assert.equal(checked.materials[0].candidates[0].amount,'40000.00');assert.deepEqual(old,before);assert.equal(checked.materials[0].raw,f.raw);
 });
}
for (const suffix of ['起','多','余','许','起价','多一点','余工资','许工资','以上','以下','开外']) {
 for(const layout of ['', '\n', '\u200b']) test(`actual bounds remain unavailable: ${JSON.stringify(layout)}${suffix}`,()=>unavailable('四万元'+layout+suffix,'四万元','approximate'));
}
