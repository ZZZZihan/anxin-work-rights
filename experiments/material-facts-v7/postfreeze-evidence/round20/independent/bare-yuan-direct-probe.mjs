import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const root=process.env.V7_REVIEW_ROOT;
const {normalizeCandidateValueV4: normalize}=await import(pathToFileURL(resolve(root,'lib/material-money-v4.ts')));
const rows=[];
for(const [value,tail,expected] of [['2','元论',null],['3','元催化器',null],['2','元工资','2.00'],['3','元工资','3.00']]){
 const candidate={kind:'money',value,quote:'王甲资料'+value+tail+'。',blockId:'b1',subject:'王甲',scope:'individual',meaning:'due_total',completeness:'complete',period:null,rateUnit:null,assertion:'narrated'};
 const got=normalize(candidate); rows.push({value,quote:candidate.quote,expected,status:got.normalization.status,amount:got.amount});
}
console.log(JSON.stringify(rows,null,2));
assert(rows.every(row=>row.amount===row.expected));
