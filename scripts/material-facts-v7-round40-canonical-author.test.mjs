// Comparison-only aliases: no raw rewrite or authority to use a qualified amount.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = resolve(process.env.MATERIAL_FACT_TEST_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const {canonicalMonetaryExpression: key, normalizeMoneyValueV4: parse, normalizeCandidateValueV4: normalize} = await import(pathToFileURL(resolve(ROOT,'lib/material-money-v4.ts')).href);
for (const prefix of ['人民币','人民幣','RMB','CNY','rmb','cny','¥','￥']) {
  for (const qualifier of ['约','至少','可能']) test(`qualified RMB alias ${prefix}/${qualifier}`, () => {
    const value = `${prefix}${qualifier}4000元`;
    const candidate = {kind:'money',value,quote:value,subject:'王甲',scope:'individual',meaning:'other_money',completeness:'not_applicable',period:null,rateUnit:null,assertion:'narrated'};
    const original=structuredClone(candidate), result=normalize(candidate);
    assert.equal(key(value),key(`人民币${qualifier}4000元`)); assert.notEqual(key(value),null);
    assert.equal(parse(value).amount,null); assert.equal(result.amount,null); assert.equal(result.normalization.rawValue,value); assert.deepEqual(candidate,original);
  });
}
for (const a of ['约','至少','至多','可能']) test(`qualifier ${a} stays distinct from others and exact`,()=>{
 const current=key(`RMB${a}4000元`);assert.notEqual(current,null);assert.notEqual(current,key('4000元'));
 for(const b of ['约','至少','至多','可能'])if(a!==b)assert.notEqual(current,key(`CNY${b}4000元`));
});
for(const value of ['USD约4000元','港币约4000元','RMB人民币约4000元','RMB约4000元港币','ACNY约4000元','RMB约4000元和5000元','(4000元)'])test('unsupported text cannot acquire an alias key: '+value,()=>assert.equal(key(value),null));
test('same amount key alone never carries event or calculation authority',()=>{
 assert.equal(key('RMB约4000元'),key('CNY约4000元'));
 assert.equal(parse('RMB约4000元').amount,null);assert.equal(parse('CNY约4000元').amount,null);
});
