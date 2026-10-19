import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const root = process.argv[2];
if (!root) throw new Error('Expected a read-only implementation root');
const load = path => import(pathToFileURL(resolve(root, path)));
const {normalizeMoneyValueV4:money, normalizeCandidateValueV4:normalize}=await load('lib/material-money-v4.ts');
const {ingestRuntimeCandidates:fresh}=await load('lib/material-fact-runtime-ingest.ts');
const {emptyFactState,ingestCandidates:legacy}=await load('lib/material-facts-v3.ts');
const {reviewFactsAgainstSources:review}=await load('lib/material-fact-source-review.ts');
let failures=0, tests=0;
for(const expression of ['30000人民币至40000人民币','30000CNY至40000RMB','30000元人民币至40000元人民币','CNY30000元至RMB40000元']) {
 for(const value of ['30000','40000']) {
  tests++;
  const text='😀王甲工资'+expression+'。';
  const source={id:'rmb-range-probe',name:'synthetic.txt',sha256:'e'.repeat(64),analysisRevision:15,ready:true,blocks:[{id:'b1',page:1,text,bbox:null,confidence:null}]};
  const candidate={kind:'money',value,quote:value,blockId:'b1',subject:'王甲',scope:'individual',meaning:'due_total',completeness:'complete',period:null,rateUnit:null,assertion:'narrated'};
  const raw=JSON.stringify({schemaVersion:3,candidates:[candidate]});
  const ingest=fn=>fn(emptyFactState(15),source,{raw},'rmb-range-probe','synthetic','2026-10-18T08:00:00.000Z',null);
  const state=ingest(fresh), old=ingest(legacy), historical=old.materials[0].candidates[0];
  historical.amount=Number(value).toFixed(2);
  historical.normalization={rawValue:value,status:'exact',amount:historical.amount,matchedText:value,span:{start:0,end:value.length},reason:'Synthetic unsafe history'};
  const oldBytes=JSON.stringify(old), reviewed=review(old,[source]);
  assert.equal(JSON.stringify(old),oldBytes);
  assert.equal(state.materials[0].raw,raw);assert.equal(state.materials[0].candidates.length,1);
  const amounts={whole:money(expression).amount,quote:normalize({...candidate,quote:text}).amount,source:state.materials[0].candidates[0].amount,history:reviewed.materials[0].candidates[0].amount};
  const passed=Object.values(amounts).every(amount=>amount===null);
  console.log(JSON.stringify({expression,value,amounts,passed})); if(!passed) failures++;
 }
}
console.log(JSON.stringify({tests,passed:tests-failures,failed:failures,model_requests:0}));
process.exitCode=failures?1:0;
