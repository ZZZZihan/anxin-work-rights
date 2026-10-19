import {ingestRuntimeCandidates} from './lib/material-fact-runtime-ingest.ts';
import {emptyFactState} from './lib/material-facts-v3.ts';
for(const suffix of ['圓5角','圓/月','圓每天']) {
 const text='😀王甲工资4000'+suffix+'。',source={id:'probe',name:'synthetic',sha256:'a'.repeat(64),analysisRevision:1,ready:true,blocks:[{id:'b1',page:1,text,bbox:null,confidence:null}]};
 const representation={kind:'money',value:'4000',quote:'4000',blockId:'b1',subject:'王甲',scope:'individual',meaning:'arrears',completeness:'not_applicable',period:null,rateUnit:null,assertion:'narrated'};
 const raw=JSON.stringify({schemaVersion:3,candidates:[representation]}),state=ingestRuntimeCandidates(emptyFactState(1),source,{raw},'synthetic','audit','2026-10-18T00:00:00.000Z');
 const candidate=state.materials[0].candidates[0];console.log(JSON.stringify({text,value:'4000',expected_amount:null,actual_amount:candidate.amount,status:candidate.normalization.status,raw_unchanged:state.materials[0].raw===raw,check:candidate.amount===null?'PASS':'FAIL'}));
}
