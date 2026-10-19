import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Finite tests for the post-8ac parser/group/lexical findings. Synthetic runtime/source
// functions are allowed; no scorer, historical CLI, HTTP, build or model runs.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(ROOT, path)));
const { normalizeMoneyValueV4: money, classifyMonetaryExpression: classify } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates: fresh } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, validateCandidateOutput } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const { hasSupportedCandidateAttribution: attributed } = await load('lib/material-fact-event-review.ts');
const cp = text => Array.from(text).length;
const sourceFor = texts => ({ id: 'round33-independent', name: 'synthetic.txt', sha256: '3'.repeat(64), analysisRevision: 33, ready: true,
  blocks: (Array.isArray(texts) ? texts : [texts]).map((text, index) => ({ id: 'b' + (index + 1), page: 1, text, bbox: null, confidence: null })) });
const entry = (value, quote = value, extra = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual',
  meaning: 'other_money', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated', ...extra });
const rawFor = rows => JSON.stringify({ schemaVersion: 3, candidates: rows });
function stateFor(source, rows, old = false) {
  const raw = rawFor(rows), sourceBefore = structuredClone(source), structural = validateCandidateOutput(raw, source);
  assert.equal(structural.rejected.length, 0, 'Every fixture must pass the frozen structural schema before runtime semantics.');
  const state = (old ? legacy : fresh)(emptyFactState(33), source, { raw }, 'independent', 'synthetic', '2026-10-18T23:00:00.000Z', null);
  assert.deepEqual(source, sourceBefore); assert.equal(state.materials[0].raw, raw);
  assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
  return state;
}
function factFor(source, item, state) {
  assert.equal(state.materials[0].candidates.length, 1, 'One review candidate does not imply one usable amount.');
  const fact = state.materials[0].candidates[0], text = source.blocks.find(block => block.id === item.blockId).text;
  const at = text.indexOf(item.quote); assert(at >= 0); assert.equal(text.indexOf(item.quote, at + 1), -1);
  assert.deepEqual(fact.representation, item); assert.equal(fact.start, cp(text.slice(0, at))); assert.equal(fact.end, fact.start + cp(item.quote));
  return fact;
}
function stored(source, item, amount, status) {
  const state = stateFor(source, [item], true), fact = factFor(source, item, state);
  fact.amount = amount;
  fact.normalization = { rawValue: item.value, status, amount, matchedText: item.value,
    span: { start: 0, end: cp(item.value) }, reason: 'Synthetic stored state, never confirmed.' };
  const before = structuredClone(state), reviewed = reviewFactsAgainstSources(state, [source]);
  assert.deepEqual(state, before); assert.equal(reviewed.materials[0].raw, rawFor([item]));
  return factFor(source, item, reviewed);
}
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-range-review.ts', 'lib/material-fact-event-review.ts',
  'lib/material-fact-source-review.ts', 'lib/material-fact-runtime-ingest.ts'])
  console.log(JSON.stringify({ evidence: 'round33_implementation', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));


for (const marker of ['人民币', '人民幣']) test('one postposed currency label is not a person count: ' + marker, () => {
  const value = '4000' + marker, text = '😀王甲2026年1月全部应付工资合计' + value + '。';
  const source = sourceFor(text), item = entry(value, value, { meaning: 'due_total', completeness: 'complete', period: '2026年1月' });
  const observations=[];
  for (const quote of [value,text]) {
    const candidate={...item,quote}; const fact=factFor(source,candidate,stateFor(source,[candidate]));
    observations.push(fact);
    console.log(JSON.stringify({evidence:'round33_postfix_scope',candidate,fact}));
  }
  assert.equal(money(value).amount,'4000.00');
  for (const fact of observations) assert(!fact.reviewIssues.some(issue=>issue.code==='scope_text_mismatch'));
});
test('an explicit multi-worker count still conflicts with an individual total', () => {
  const value='四万元',source=sourceFor('😀王甲班组4000人2026年1月全部应付工资合计四万元。');
  const item=entry(value,source.blocks[0].text,{meaning:'due_total',completeness:'complete',period:'2026年1月'});
  const fact=factFor(source,item,stateFor(source,[item]));
  assert(fact.reviewIssues.some(issue=>issue.code==='scope_text_mismatch'));
});
for (const value of ['4000人民币人民币','4000元人民币CNY','4000人民幣人民幣']) test('a second attached currency label cannot leave a usable exact amount: '+value,()=>{
  const normal=money(value),source=sourceFor('😀王甲收到'+value+'。'),item=entry(value);
  const fact=factFor(source,item,stateFor(source,[item]));
  const historical=stored(source,item,'4000.00','exact');
  console.log(JSON.stringify({evidence:'round33_duplicate_currency',normal,fact,historical}));
  assert.equal(normal.amount,null); assert.notEqual(normal.status,'exact');
  assert.equal(fact.amount,null);assert.equal(historical.amount,null);
});
test('a second source marker remains visible when value and quote are cropped to the first label',()=>{
  const source=sourceFor('😀王甲收到4000人民币CNY。'),item=entry('4000人民币');
  const fact=factFor(source,item,stateFor(source,[item]));
  const historical=stored(source,item,'4000.00','exact');
  console.log(JSON.stringify({evidence:'round33_crop_duplicate',fact,historical}));
  assert.equal(fact.amount,null);assert.equal(historical.amount,null);
});
test('one postfix label plus an unrelated later currency sentence stays exact',()=>{
  const source=sourceFor('😀王甲收到4000人民币。李乙另有CNY工资。'),item=entry('4000人民币');
  assert.equal(factFor(source,item,stateFor(source,[item])).amount,'4000.00');
  assert.equal(stored(source,item,null,'unsupported').amount,null);
});
for (const [value,second,amount] of [['4000元','旦日李乙工资另付。','4000.00'],['人民币2分','钟某工资另付。','0.02']]) test('another page cannot complete a lexical word after '+value,()=>{
  const source=sourceFor(['😀王甲收到'+value,second]);source.blocks[1].page=2;
  const item=entry(value),fact=factFor(source,item,stateFor(source,[item]));
  const historical=stored(source,item,amount,'exact');
  console.log(JSON.stringify({evidence:'round33_independent_page',source,item,fact,historical}));
  assert.equal(fact.amount,amount);assert.equal(historical.amount,amount);
  assert.equal(stored(source,item,null,'unsupported').amount,null);
});
test('a same-page explicitly different worker is not an OCR lexical suffix',()=>{
  const source=sourceFor(['😀王甲收到人民币2分','钟某2026年工资待核对。']),item=entry('人民币2分');
  const fact=factFor(source,item,stateFor(source,[item]));
  console.log(JSON.stringify({evidence:'round33_distinct_worker',source,item,fact}));
  assert.equal(fact.amount,'0.02');
});
for (const [value,suffix] of [['人民币五角','星'],['人民币2分','钟']]) test('a genuine adjacent OCR lexical fragment stays unavailable: '+value+'|'+suffix,()=>{
  const source=sourceFor(['😀王甲收到'+value,suffix]),item=entry(value);
  const fact=factFor(source,item,stateFor(source,[item]));
  const historical=stored(source,item,value.includes('五角')?'0.50':'0.02','exact');
  console.log(JSON.stringify({evidence:'round33_actual_ocr_fragment',source,item,fact,historical}));
  assert.equal(fact.amount,null);assert.equal(historical.amount,null);
});
test('a same-block complete ordinary word remains unavailable without joining any pages',()=>{
  const source=sourceFor('😀王甲画人民币五角星。'),item=entry('人民币五角');
  assert.equal(factFor(source,item,stateFor(source,[item])).amount,null);
});
