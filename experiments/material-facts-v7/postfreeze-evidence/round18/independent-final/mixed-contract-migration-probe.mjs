import assert from 'node:assert/strict';
import { normalizeMoneyValueV4, normalizeCandidateValueV4 } from '/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-code-review/lib/material-money-v4.ts';
const observations=[];
for(const[value,amount,crop]of[['四元五角伍分','4.55','四元'],['一千万元伍分','10000000.05','一千万元'],['伍仟元五角','5000.50','伍仟元']]){
 const whole=normalizeMoneyValueV4(value);
 const candidate={kind:'money',value:crop,quote:'王甲工资'+value+'。',blockId:'b1',subject:'王甲',scope:'individual',meaning:'due_total',completeness:'complete',period:null,rateUnit:null,assertion:'narrated'};
 const cropped=normalizeCandidateValueV4(candidate);
 assert.equal(whole.status,'exact');assert.equal(whole.amount,amount);assert.equal(cropped.amount,null);
 observations.push({value,expected:amount,whole,crop,cropped});
}
for(const value of ['四元零零分','四元五角零五分','四元五分六分','4万元五角'])assert.equal(normalizeMoneyValueV4(value).amount,null);
console.log(JSON.stringify({status:'PASS',contract:'Explicit mixed digits are newly supported; invalid precision and clipped subunits remain unavailable.',observations},null,2));
