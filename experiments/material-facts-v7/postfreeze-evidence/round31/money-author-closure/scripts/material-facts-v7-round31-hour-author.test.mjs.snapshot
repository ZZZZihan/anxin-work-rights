// ROUND31 author-only synthetic module checks. No scorer, HTTP, model or history CLI.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const OWN=fileURLToPath(new URL('../',import.meta.url));
const BASE=resolve(process.env.MATERIAL_FACT_TEST_ROOT||OWN);
const PATCH=resolve(process.env.MATERIAL_FACT_PATCH_ROOT||OWN);
const temporary=await mkdtemp(resolve(tmpdir(),'anxin-round31-hour-'));
after(()=>rm(temporary,{recursive:true,force:true}));
await cp(resolve(BASE,'lib'),resolve(temporary,'lib'),{recursive:true});
await cp(resolve(PATCH,'lib/material-money-v4.ts'),resolve(temporary,'lib/material-money-v4.ts'));
const load=file=>import(pathToFileURL(resolve(temporary,file)).href);
const {normalizeMoneyValueV4:parse,normalizeCandidateValueV4:normalize}=await load('lib/material-money-v4.ts');
const raw=(value,quote=value,meaning='rate',rateUnit='hour')=>({kind:'money',value,quote,blockId:'b1',subject:'王甲',scope:'individual',meaning,completeness:'not_applicable',period:null,rateUnit,assertion:'narrated'});
for(const suffix of ['/小時','每小時','/時'])test('minimum traditional hour '+suffix,()=>assert.equal(normalize(raw('4000元'+suffix)).amount,'4000.00'));
const {ingestRuntimeCandidates}=await load('lib/material-fact-runtime-ingest.ts');
const {emptyFactState,ingestCandidates}=await load('lib/material-facts-v3.ts');
const {reviewFactsAgainstSources}=await load('lib/material-fact-source-review.ts');
const cpLength=value=>Array.from(value).length;
const AT='2026-10-18T00:00:00.000Z';
function fixture(expression,{value='4000元',fullQuote=false,meaning='rate',rateUnit='hour',nextBlock=null}={}){
 const source={id:'round31-hour-author',name:'合成小时费率',sha256:'a'.repeat(64),analysisRevision:1,ready:true,
  blocks:[{id:'b1',page:1,text:'😀王甲工资'+expression+'。',bbox:null,confidence:null}]};
 if(nextBlock!==null){source.blocks[0].text='😀王甲工资'+expression;source.blocks.push({id:'b2',page:1,text:nextBlock,bbox:null,confidence:null});}
 const candidate=raw(value,fullQuote?source.blocks[0].text:value,meaning,rateUnit);
 return {source,candidate,raw:JSON.stringify({schemaVersion:3,candidates:[candidate]})};
}
function pipeline(f,amount){
 const original=structuredClone(f);
 const check=fact=>{
  assert(fact);assert.equal(fact.amount,amount);assert.deepEqual(fact.representation,f.candidate);assert.equal(fact.value,f.candidate.value);assert.equal(fact.quote,f.candidate.quote);
  assert.equal(fact.normalization.rawValue,f.candidate.value);
  const text=f.source.blocks[0].text,start=cpLength(text.slice(0,text.indexOf(f.candidate.quote)));
  assert.deepEqual([fact.start,fact.end],[start,start+cpLength(f.candidate.quote)]);
  assert.equal(Array.from(text).slice(fact.start,fact.end).join(''),f.candidate.quote);
 };
 const fresh=ingestRuntimeCandidates(emptyFactState(1),f.source,{raw:f.raw},'synthetic','round31-hour-author',AT);
 check(fresh.materials[0].candidates[0]);assert.equal(fresh.materials[0].raw,f.raw);assert.deepEqual(fresh.confirmations,{due:null,paid:null});assert.equal(fresh.calculation,null);
 const history=ingestCandidates(emptyFactState(1),f.source,{raw:f.raw},'synthetic','round31-hour-author',AT),fact=history.materials[0].candidates[0];assert(fact);
 fact.amount=amount??'4000.00';fact.normalization={rawValue:fact.value,amount:fact.amount,status:'exact',matchedText:fact.value,span:{start:0,end:cpLength(fact.value)},reason:'Synthetic old exact.'};
 const stored=structuredClone(history),reviewed=reviewFactsAgainstSources(history,[f.source]);check(reviewed.materials[0].candidates[0]);assert.deepEqual(history,stored);assert.deepEqual(reviewed.history,history.history);assert.equal(reviewed.materials[0].raw,f.raw);
 fact.amount=null;fact.normalization={rawValue:fact.value,amount:null,status:'unsupported',matchedText:null,span:null,reason:'Synthetic old unsupported.'};
 const unavailable=structuredClone(history);assert.equal(reviewFactsAgainstSources(history,[f.source]).materials[0].candidates[0].amount,null);assert.deepEqual(history,unavailable);assert.deepEqual(f,original);
}
const suffixes=['/小時','／小時','每小時','按小時計','按小時計價','/時','每時','按時計'];
for(const suffix of suffixes){
 test('traditional hour full literal raw/CP '+suffix,()=>{
  const value='4000元'+suffix,got=parse('😀'+value),normalized=normalize(raw(value));
  assert.equal(got.amount,'4000.00');assert.equal(got.rawValue,'😀'+value);assert.equal(got.matchedText,'4000元');assert.deepEqual(got.span,{start:1,end:6});
  assert.equal(normalized.amount,'4000.00');assert.equal(normalized.rateUnit,'hour');assert.equal(normalized.normalization.rawValue,value);
  pipeline(fixture(value,{value}),'4000.00');
 });
 for(const fullQuote of [false,true])test('traditional hour crop raw/source/history '+JSON.stringify({suffix,fullQuote}),()=>pipeline(fixture('4000元'+suffix,{fullQuote}),'4000.00'));
 for(const rateUnit of ['month','day','piece'])test('hour cannot become another unit '+JSON.stringify({suffix,rateUnit}),()=>{
  const f=fixture('4000元'+suffix,{fullQuote:true,rateUnit});assert.equal(normalize(f.candidate).amount,null);pipeline(f,null);
 });
 test('hour rate cannot become total '+suffix,()=>{
  const f=fixture('4000元'+suffix,{fullQuote:true,meaning:'arrears',rateUnit:null});assert.equal(normalize(f.candidate).amount,null);pipeline(f,null);
 });
}
for(const prefix of ['每小時','按小時','小時工資','時薪'])for(const fullQuote of [false,true])test('preposed traditional hour source module '+JSON.stringify({prefix,fullQuote}),()=>{
 const expression=prefix+'4000元';pipeline(fixture(expression,{fullQuote}),'4000.00');
 pipeline(fixture(expression,{fullQuote,meaning:'arrears',rateUnit:null}),null);
 pipeline(fixture(expression,{fullQuote,rateUnit:'month'}),null);
});
for(const [expression,value,amount] of [['４０００元/小時','４０００元','4000.00'],['5元5角/小時','5元5角','5.50'],['4000元整/小時','4000元整','4000.00'],['4000元/小\u200d時','4000元','4000.00'],['4000元/ 小時','4000元','4000.00']])
 test('hour aliases preserve existing complete number grammar '+expression,()=>pipeline(fixture(expression,{value,fullQuote:true}),amount));
for(const [expression,value] of [['5元5角/小時','5元'],['4000元至5000元/小時','4000元'],['4000元不详/小時','4000元'],['4000元×2/小時','4000元'],['4000元港币/小時','4000元'],['4000元/小時','000元']])
 test('hour alias cannot recover partial or unsafe monetary token '+expression+' '+value,()=>pipeline(fixture(expression,{value,fullQuote:true}),null));
test('traditional hour amount retains unresolved candidate unit without authorizing calculation',()=>pipeline(fixture('4000元/小時',{fullQuote:true,rateUnit:'unknown'}),'4000.00'));
test('simplified hour control remains precise',()=>pipeline(fixture('4000元/小时',{fullQuote:true}),'4000.00'));

// Keep the original eighty cases unchanged above. These checks close a new
// alias-enablement leak: a cropped rate cannot discard its unknown tail.
for(const ending of ['待定','？','待確認'])for(const suffix of ['/小時','每小時']){
 test('closure direct cropped rate retains unknown '+JSON.stringify({suffix,ending}),()=>{
  const f=fixture('4000元'+suffix+ending,{fullQuote:true});
  assert.equal(normalize(f.candidate).amount,null);
  const complete=raw('4000元'+suffix+ending);assert.equal(normalize(complete).amount,null);
  assert.equal(complete.value,'4000元'+suffix+ending);
 });
 for(const layout of ['same','line','block'])for(const fullQuote of [false,true])test('closure source raw/history unknown '+JSON.stringify({suffix,ending,layout,fullQuote}),()=>{
  const expression='4000元'+suffix+(layout==='same'?ending:layout==='line'?'\n'+ending:'');
  pipeline(fixture(expression,{fullQuote,nextBlock:layout==='block'?ending+'。':null}),null);
 });
}
for(const ending of ['待定','？'])test('closure complete raw rate value remains unknown '+ending,()=>{
 const expression='4000元/小時'+ending;pipeline(fixture(expression,{value:expression,fullQuote:true}),null);
});
for(const [tail,amount] of [['計酬待定',null],['计价？',null],['，李乙金额待定','4000.00'],['。李乙金额待定','4000.00']])
 test('closure finite pricing ending and clause barriers '+tail,()=>pipeline(fixture('4000元/小時'+tail,{fullQuote:true}),amount));
test('closure neighboring new owner cannot supply uncertainty',()=>pipeline(fixture('4000元/小時。',{nextBlock:'李乙工资待定。'}),'4000.00'));
test('closure simplified supported rate also retains its attached unknown',()=>pipeline(fixture('4000元/小时待定',{fullQuote:true}),null));
