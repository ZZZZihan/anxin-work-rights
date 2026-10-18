import assert from 'node:assert/strict';
import { normalizeMoneyValueV4, normalizeCandidateValueV4 } from '/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-code-review/lib/material-money-v4.ts';
const value='四元5角';const whole=normalizeMoneyValueV4(value);
assert.equal(whole.status,'exact');assert.equal(whole.amount,'4.50');
const crop=normalizeCandidateValueV4({kind:'money',value:'四元',quote:'王甲工资四元5角。',blockId:'b1',subject:'王甲',scope:'individual',meaning:'due_total',completeness:'complete',period:null,rateUnit:null,assertion:'narrated'});
assert.equal(crop.amount,null);
for(const invalid of ['四元15角','四元5角12分','四元5角2角','四元5角零2分'])assert.equal(normalizeMoneyValueV4(invalid).amount,null);
console.log(JSON.stringify({status:'PASS',migrated_contract:{value,amount:whole.amount,status:whole.status},cropped_yuan_amount:crop.amount,invalid_precision_retained:true},null,2));
