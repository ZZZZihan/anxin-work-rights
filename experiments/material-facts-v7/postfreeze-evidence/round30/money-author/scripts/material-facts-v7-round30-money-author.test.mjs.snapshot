// Fixed synthetic ROUND30 author regressions; no model or HTTP execution.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const OWN=fileURLToPath(new URL('../',import.meta.url));
const BASE=resolve(process.env.MATERIAL_FACT_TEST_ROOT||OWN);
const PATCH=resolve(process.env.MATERIAL_FACT_PATCH_ROOT||OWN);
const temporary=await mkdtemp(resolve(tmpdir(),'anxin-round30-money-'));
after(()=>rm(temporary,{recursive:true,force:true}));
await cp(resolve(BASE,'lib'),resolve(temporary,'lib'),{recursive:true});
await cp(resolve(BASE,'experiments/material-facts-v7/assess.mjs'),resolve(temporary,'experiments/material-facts-v7/assess.mjs'),{recursive:true});
await cp(resolve(PATCH,'lib/material-money-v4.ts'),resolve(temporary,'lib/material-money-v4.ts'));
const load=file=>import(pathToFileURL(resolve(temporary,file)).href);
const {normalizeMoneyValueV4:parse,normalizeCandidateValueV4:normalize,canonicalMonetaryExpression:canonical}=await load('lib/material-money-v4.ts');
const candidateFor=(value,quote)=>({kind:'money',value,quote,blockId:'b1',subject:'王甲',scope:'individual',meaning:'arrears',completeness:'not_applicable',period:null,rateUnit:null,assertion:'narrated'});
const {ingestRuntimeCandidates}=await load('lib/material-fact-runtime-ingest.ts');
const {emptyFactState,ingestCandidates}=await load('lib/material-facts-v3.ts');
const {reviewFactsAgainstSources}=await load('lib/material-fact-source-review.ts');
const {assessCase}=await load('experiments/material-facts-v7/assess.mjs');
const cpLength = value => Array.from(value).length;
const AT = '2026-10-18T00:00:00.000Z';
const modes = ['raw_basic', 'raw_relational', 'raw_strict', 'accepted_basic', 'accepted_relational', 'accepted_strict'];
function fixture(expression, { value = expression, fullQuote = false, nextBlock = null } = {}) {
  const source = { id: 'round30-author', name: '合成金额边界', sha256: 'a'.repeat(64), analysisRevision: 1, ready: true,
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
    const text = f.source.blocks[0].text, start = cpLength(text.slice(0, text.indexOf(f.candidate.quote)));
    assert.deepEqual([fact.start, fact.end], [start, start + cpLength(f.candidate.quote)]);
    assert.equal(Array.from(text).slice(fact.start, fact.end).join(''), f.candidate.quote);
    assert.equal(fact.normalization.rawValue, f.candidate.value);
  };
  const fresh = ingestRuntimeCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'round30-author', AT);
  assert.equal(fresh.materials[0].raw, f.raw); check(fresh.materials[0].candidates[0]);
  assert.deepEqual(fresh.confirmations, { due: null, paid: null }); assert.equal(fresh.calculation, null);
  const history = ingestCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'round30-author', AT);
  const fact = history.materials[0].candidates[0]; assert(fact);
  fact.amount = amount ?? '4000.00'; fact.normalization = { rawValue: fact.value, amount: fact.amount, status: 'exact', matchedText: fact.value,
    span: { start: 0, end: cpLength(fact.value) }, reason: 'Synthetic historical exact.' };
  const stored = structuredClone(history), reviewed = reviewFactsAgainstSources(history, [f.source]);
  check(reviewed.materials[0].candidates[0]); assert.deepEqual(history, stored); assert.deepEqual(reviewed.history, history.history); assert.equal(reviewed.materials[0].raw, f.raw);
  fact.amount = null; fact.normalization = { rawValue: fact.value, amount: null, status: 'unsupported', matchedText: null, span: null, reason: 'Synthetic historical unsupported.' };
  const unavailable = structuredClone(history); assert.equal(reviewFactsAgainstSources(history, [f.source]).materials[0].candidates[0].amount, null);
  assert.deepEqual(history, unavailable); assert.deepEqual(f, original);
}


for(const value of ['４０００元','人民币４０００元','￥４０００元'])test('minimum fullwidth '+value,()=>assert.equal(parse(value).amount,'4000.00'));
for(const suffix of ['一次性支付','一并支付','三日内支付'])test('minimum complete amount payment prose '+suffix,()=>{
 assert.equal(parse('4000元'+suffix).amount,'4000.00');
 assert.equal(normalize(candidateFor('4000元','王甲工资4000元'+suffix)).amount,'4000.00');
});

const fullwidthAmounts=[['４０００元','4000.00'],['人民币４０００元','4000.00'],['￥４０００元','4000.00'],['人民幣４０００圓','4000.00'],
 ['RMB４０００','4000.00'],['CNY４０００','4000.00'],['４，０００元','4000.00'],['４０００．５０元','4000.50'],['４０００.５０元','4000.50'],
 ['５元５角２分','5.52'],['五元５角２分','5.52'],['伍元５角２分','5.52'],['人民币５角２分','0.52'],['５角２分RMB','0.52'],['CNY２分','0.02'],
 ['４万元','40000.00'],['０元','0.00'],['４０００元整','4000.00'],['４０００元正','4000.00'],['１２３４５６７８９０．９９元','1234567890.99']];
for(const [value,amount] of fullwidthAmounts)test('fullwidth parse preserves raw token and CP '+value,()=>{
 const raw='😀'+value,got=parse(raw);assert.equal(got.amount,amount);assert.equal(got.status,'exact');assert.equal(got.rawValue,raw);
 assert.equal(got.matchedText,value);assert.deepEqual(got.span,{start:1,end:1+cpLength(value)});assert.equal(canonical(value),'exact:'+amount);
});
for(const [value,amount] of fullwidthAmounts.slice(0,16))for(const fullQuote of [false,true])test('fullwidth fresh/source/history/raw '+JSON.stringify({value,fullQuote}),()=>pipeline(fixture(value,{fullQuote}),amount));
const unsafe=['４０００元５角２分３','４０００元三百','４０００元５','４０００元万','４０００元万元','４０００元五角二','４０００元５分２角',
 '４０００元5角2分3元','４０００元美元','美元４０００元','４０００元港币','４０００元整USD','４０００元整人民币５角','４０００元正RMB５角',
 '４０００元?','４０００元不詳','４０００元暫定','４０００元至５０００元','４０００元以上','≤４０００元','負４０００元',
 '４０００元的２倍','４０００元×２','４０００元／２','４０００元乘以出勤率','４０００元/年','４０００元按周计','４０００元宝','４０００元组',
 '１２，３４元','４０００．５５５元','４万元５角','５．５元５角','１００００００００００００元','４０００元５角２分另有３元'];
for(const value of unsafe)test('fullwidth capability keeps complete-token finite guards '+value,()=>assert.equal(parse(value).amount,null));
for(const [expression,value] of [['４０００元５角','４０００元'],['４０００元５角２分','４０００元'],['４０００元至５０００元','４０００元'],
 ['４０００元不詳','４０００元'],['４０００元×２','４０００元'],['４０００元/年','４０００元'],['５角２分RMB','２分RMB']])
 for(const fullQuote of [false,true])test('fullwidth cropped source never exposes operand/partial total '+JSON.stringify({expression,value,fullQuote}),()=>pipeline(fixture(expression,{value,fullQuote}),null));
const instructions=['一次性支付','一并支付','一次性付清','一并给付','三日内支付','3天内付清','１５日内发放','三 日 内 支付'];
for(const instruction of instructions)for(const fullQuote of [false,true])test('complete-unit payment count/duration fresh/history '+JSON.stringify({instruction,fullQuote}),()=>pipeline(fixture('4000元'+instruction,{value:'4000元',fullQuote}),'4000.00'));
for(const instruction of instructions)test('whole value payment count/duration '+instruction,()=>assert.equal(parse('4000元'+instruction).amount,'4000.00'));
for(const end of ['整','正'])for(const instruction of ['一次性支付','一并支付','三日内支付'])for(const fullQuote of [false,true])test('whole terminator before finite payment prose '+JSON.stringify({end,instruction,fullQuote}),()=>{
 assert.equal(parse('4000元'+end+instruction).amount,'4000.00');pipeline(fixture('4000元'+end+instruction,{value:'4000元',fullQuote}),'4000.00');
});
for(const nextBlock of ['一次性支付','一并支付','三日内支付'])test('layout-separated complete payment prose is not cents '+nextBlock,()=>pipeline(fixture('4000元',{value:'4000元',nextBlock}),'4000.00'));
for(const [expression,value] of [['4000元五角','4000元'],['4000元一元','4000元'],['4000元三万元','4000元'],['4000元一次性支付待定','4000元'],
 ['4000元一并支付美元','4000元'],['4000元三日内支付?','4000元'],['4000元三日内支付的2倍','4000元'],['4000元整三日内支付５角','4000元'],
 ['4000元正一并支付港币','4000元']])test('payment exception requires bounded payment ending '+expression,()=>{
 assert.equal(parse(expression).amount,expression==='4000元五角'?'4000.50':null);assert.equal(normalize(candidateFor(value,'王甲工资'+expression)).amount,null);pipeline(fixture(expression,{value}),null);
});
test('full source payment question remains unavailable despite local sentence cut',()=>pipeline(fixture('4000元三日内支付?',{value:'4000元',fullQuote:true}),null));
test('neighbor payment question remains unavailable despite local sentence cut',()=>pipeline(fixture('4000元',{value:'4000元',nextBlock:'三日内支付?'}),null));
test('another person payment question cannot attach to this complete amount',()=>pipeline(fixture('4000元',{value:'4000元',nextBlock:'王乙三日内支付?'}),'4000.00'));
for(const suffix of ['/月','每月','按月计'])test('actual rate declaration is still required '+suffix,()=>{
 const f=fixture('４０００元'+suffix,{value:'４０００元',fullQuote:true});assert.equal(normalize(f.candidate).amount,null);
 f.candidate.meaning='rate';f.candidate.rateUnit='month';f.raw=JSON.stringify({schemaVersion:3,candidates:[f.candidate]});pipeline(f,'4000.00');
});
for(const [value,labelValue] of [['４０００元','4000元'],['￥４０００元','人民币4000元']])test('fullwidth same-event amount equivalence across six score layers '+value,()=>{
 const f=fixture(value+'（'+labelValue+'）',{value}),text=f.source.blocks[0].text;
 const anchor=v=>({blockId:'b1',start:cpLength(text.slice(0,text.indexOf(v))),end:cpLength(text.slice(0,text.indexOf(v)))+cpLength(v)});
 const label={id:'same',expected:[{...f.candidate,value:labelValue,quote:labelValue}],expected_event_ids:['e1'],events:[{id:'e1',anchors:[anchor(value),anchor(labelValue)]}]};
 const row=assessCase({id:'same',source:f.source},label,{finish_reason:'stop',raw_output:f.raw});assert(row.protocol);for(const mode of modes)assert.deepEqual([row[mode].tp,row[mode].fp,row[mode].fn],[1,0,0]);
});
test('fullwidth identical amount cannot borrow another event TP',()=>{
 const f=fixture('４０００元。王乙工资4000元',{value:'４０００元'}),text=f.source.blocks[0].text;
 const anchor=v=>({blockId:'b1',start:cpLength(text.slice(0,text.indexOf(v))),end:cpLength(text.slice(0,text.indexOf(v)))+cpLength(v)});
 const label={id:'different',expected:[{...f.candidate,subject:'王乙',value:'4000元',quote:'4000元'}],expected_event_ids:['e2'],events:[{id:'e1',anchors:[anchor('４０００元')]},{id:'e2',anchors:[anchor('4000元')]}]};
 const row=assessCase({id:'different',source:f.source},label,{finish_reason:'stop',raw_output:f.raw});for(const mode of modes)assert.deepEqual([row[mode].tp,row[mode].fp,row[mode].fn],[0,1,1]);
});
