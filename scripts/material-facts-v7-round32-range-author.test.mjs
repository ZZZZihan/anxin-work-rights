// Fixed synthetic ROUND32 author regressions; no model or HTTP execution.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const OWN=fileURLToPath(new URL('../',import.meta.url));
const BASE=resolve(process.env.MATERIAL_FACT_TEST_ROOT||OWN);
const PATCH=resolve(process.env.MATERIAL_FACT_PATCH_ROOT||OWN);
const temporary=await mkdtemp(resolve(tmpdir(),'anxin-round32-money-'));
after(()=>rm(temporary,{recursive:true,force:true}));
await cp(resolve(BASE,'lib'),resolve(temporary,'lib'),{recursive:true});
await cp(resolve(PATCH,'lib/material-fact-range-review.ts'),resolve(temporary,'lib/material-fact-range-review.ts'));
const load=file=>import(pathToFileURL(resolve(temporary,file)).href);
const {normalizeMoneyValueV4:parse}=await load('lib/material-money-v4.ts');
const {ingestRuntimeCandidates}=await load('lib/material-fact-runtime-ingest.ts');
const {emptyFactState,ingestCandidates}=await load('lib/material-facts-v3.ts');
const {reviewFactsAgainstSources}=await load('lib/material-fact-source-review.ts');
const cpLength = value => Array.from(value).length;
const AT = '2026-10-18T00:00:00.000Z';
function fixture(expression, { value = expression, fullQuote = false, nextBlock = null } = {}) {
  const source = { id: 'round32-author', name: '合成金额边界', sha256: 'a'.repeat(64), analysisRevision: 1, ready: true,
    blocks: [{ id: 'b1', page: 1, text: '😀王甲工资' + expression + (nextBlock === null ? '。' : ''), bbox: null, confidence: null }] };
  if (nextBlock !== null) source.blocks.push({ id: 'b2', page: 1, text: nextBlock + '。', bbox: null, confidence: null });
  const candidate = { kind: 'money', value, quote: fullQuote ? source.blocks[0].text : value, blockId: 'b1', subject: '王甲', scope: 'individual',
    meaning: 'arrears', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
  return { source, candidate, raw: JSON.stringify({ schemaVersion: 3, candidates: [candidate] }) };
}
function pipeline(f, amount) {
  const original = structuredClone(f);
  const check = fact => {
    assert(fact, 'money observation retained'); assert.equal(fact.amount, amount); assert.deepEqual(fact.representation, f.candidate);
    assert.equal(fact.value, f.candidate.value); assert.equal(fact.quote, f.candidate.quote);
    const text = f.source.blocks.find(block => block.id === f.candidate.blockId).text, start = cpLength(text.slice(0, text.indexOf(f.candidate.quote)));
    assert.deepEqual([fact.start, fact.end], [start, start + cpLength(f.candidate.quote)]);
    assert.equal(Array.from(text).slice(fact.start, fact.end).join(''), f.candidate.quote);
    assert.equal(fact.normalization.rawValue, f.candidate.value);
  };
  const fresh = ingestRuntimeCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'round32-author', AT);
  assert.equal(fresh.materials[0].raw, f.raw); check(fresh.materials[0].candidates[0]);
  assert.deepEqual(fresh.confirmations, { due: null, paid: null }); assert.equal(fresh.calculation, null);
  const history = ingestCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'round32-author', AT);
  const fact = history.materials[0].candidates[0]; assert(fact);
  fact.amount = amount ?? '4000.00'; fact.normalization = { rawValue: fact.value, amount: fact.amount, status: 'exact', matchedText: fact.value,
    span: { start: 0, end: cpLength(fact.value) }, reason: 'Synthetic historical exact.' };
  const stored = structuredClone(history), reviewed = reviewFactsAgainstSources(history, [f.source]);
  check(reviewed.materials[0].candidates[0]); assert.deepEqual(history, stored); assert.deepEqual(reviewed.history, history.history); assert.equal(reviewed.materials[0].raw, f.raw);
  fact.amount = null; fact.normalization = { rawValue: fact.value, amount: null, status: 'unsupported', matchedText: null, span: null, reason: 'Synthetic historical unsupported.' };
  const unavailable = structuredClone(history); assert.equal(reviewFactsAgainstSources(history, [f.source]).materials[0].candidates[0].amount, null);
  assert.deepEqual(history, unavailable); assert.deepEqual(f, original);
}
const qualifiers = ['约有','大约有','将近有','約有','大約有','將近有','约 有','约\n有','约有人民币','大约有工资金额为'];
for(const prefix of qualifiers){
 test('whole approximate 有 connector '+prefix,()=>{const value=prefix+'4000元',got=parse(value);assert.equal(got.status,'approximate');assert.equal(got.amount,null);assert.equal(got.rawValue,value);});
 for(const fullQuote of [false,true])test('source clipped 有 connector fresh/history/raw '+JSON.stringify({prefix,fullQuote}),()=>pipeline(fixture(prefix+'4000元',{value:'4000元',fullQuote}),null));
}
for(const prefix of ['约有','大约有','将近有'])test('layout qualifier before amount across block '+prefix,()=>{
 const f=fixture('4000元',{value:'4000元'});f.source.blocks.unshift({id:'b0',page:1,text:'王甲工资'+prefix,bbox:null,confidence:null});f.source.blocks[1].text='4000元。';pipeline(f,null);
});
for(const expression of ['约定有4000元','约有三人，王甲工资4000元','大约有三天。王甲工资4000元','约有，王甲工资4000元','将近有王乙工资4000元'])test('finite bridge cannot cross words number subject or punctuation '+expression,()=>assert.equal(parse(expression).amount,'4000.00'));
for(const expression of ['约有4000美元','大约有4000元×2','将近有4000元待定'])test('connector never enables unsafe amount '+expression,()=>assert.equal(parse(expression).amount,null));
for(const prefix of ['约有','大约有','将近有'])test('same amount different event cannot borrow precision '+prefix,()=>{
 const f=fixture(prefix+'4000元。王乙工资4000元',{value:'4000元',fullQuote:true});pipeline(f,null);
});
