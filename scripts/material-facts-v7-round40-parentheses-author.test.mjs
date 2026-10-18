// Parenthesized accounting literals are ambiguous; no sign is invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const ROOT=resolve(process.env.MATERIAL_FACT_TEST_ROOT||fileURLToPath(new URL('../',import.meta.url)));
const load=n=>import(pathToFileURL(resolve(ROOT,'lib',n)).href);
const {normalizeMoneyValueV4:parse,normalizeCandidateValueV4:normalize,canonicalMonetaryExpression:key}=await load('material-money-v4.ts');
const {ingestRuntimeCandidates:fresh}=await load('material-fact-runtime-ingest.ts');
const {emptyFactState,ingestCandidates:legacy,buildFactView}=await load('material-facts-v3.ts');
const {reviewFactsAgainstSources:review}=await load('material-fact-source-review.ts');
const cp=t=>Array.from(t).length;
function run(text,amount,{value='4000元',full=false,next=null,page=1}={}){
 const source={id:'r40-parenthesis',name:'synthetic',sha256:'4'.repeat(64),ready:true,analysisRevision:40,blocks:[{id:'b1',page:1,text:'😀王甲记载：'+text,bbox:null,confidence:null}]};
 if(next!==null)source.blocks.push({id:'b2',page,text:next,bbox:null,confidence:null});
 const candidate={kind:'money',value,quote:full?text:value,blockId:'b1',subject:'王甲',scope:'individual',meaning:'other_money',completeness:'not_applicable',period:null,rateUnit:null,assertion:'narrated'};
 const raw=JSON.stringify({schemaVersion:3,candidates:[candidate]}),original=structuredClone({source,candidate});
 const history=legacy(emptyFactState(40),source,{raw},'synthetic','r40','2026-10-19T05:00:00Z');
 const old=history.materials[0].candidates[0];assert(old);old.amount='4000.00';old.normalization={rawValue:value,amount:'4000.00',status:'exact',matchedText:value,span:{start:0,end:cp(value)},reason:'Synthetic historical exact'};
 const stored=structuredClone(history);
 for(const state of [fresh(emptyFactState(40),source,{raw},'synthetic','r40','2026-10-19T05:00:00Z'),review(history,[source])]){
  const item=state.materials[0].candidates[0];assert(item);assert.equal(item.amount,amount);assert.equal(state.materials[0].raw,raw);assert.deepEqual(item.representation,candidate);
  const start=cp(source.blocks[0].text.slice(0,source.blocks[0].text.indexOf(candidate.quote)));assert.deepEqual([item.start,item.end],[start,start+cp(candidate.quote)]);
  assert.equal(buildFactView(state,[source]).canCalculate,false);assert.deepEqual(state.confirmations,{due:null,paid:null});assert.equal(state.calculation,null);
 }
 assert.deepEqual(history,stored);old.amount=null;Object.assign(old.normalization,{amount:null,status:'unsupported',matchedText:null,span:null});
 const oldNull=structuredClone(history);assert.equal(review(history,[source]).materials[0].candidates[0].amount,null);assert.deepEqual(history,oldNull);assert.deepEqual({source,candidate},original);
}
for(const text of ['(4000元)','（4000元）','(人民币4000元)','（RMB4000元）','( 4000元 )','(\n4000元\n)','（\u200d4000元\u200d）']){
 test('whole accounting literal unavailable: '+text,()=>{assert.equal(parse(text).amount,null);assert.equal(key(text),null);});
 for(const full of [false,true])test(`fresh/history accounting crop full=${full} ${text}`,()=>run(text,null,{full}));
}
test('full value retains the original parentheses',()=>run('(4000元)',null,{value:'(4000元)',full:true}));
test('adjacent same-page closing parenthesis remains part of the amount',()=>run('(4000元',null,{next:')'}));
test('a different page cannot close an accounting expression',()=>run('(4000元','4000.00',{next:')',page:2}));
for(const text of ['4000元（税前）','（工资说明）4000元','（王甲工资4000元）','4000元。李乙（5000元）'])test('ordinary independent parenthetical prose does not change literal: '+text,()=>run(text,'4000.00'));
test('quoted accounting crop is rejected before source lookup',()=>{
 const value='4000元',candidate={kind:'money',value,quote:'(4000元)',subject:'王甲',scope:'individual',meaning:'other_money',completeness:'not_applicable',period:null,rateUnit:null,assertion:'narrated'};
 assert.equal(normalize(candidate).amount,null);assert.equal(candidate.quote,'(4000元)');
});
