// ROUND38 synthetic module checks: no model, HTTP, scorer or historical CLI.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OWN = fileURLToPath(new URL('../', import.meta.url));
const BASE = resolve(process.env.MATERIAL_FACT_TEST_ROOT || OWN);
const PATCH = resolve(process.env.MATERIAL_FACT_PATCH_ROOT || OWN);
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-round38-postfix-currency-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(BASE, 'lib'), resolve(temporary, 'lib'), { recursive: true });
await cp(resolve(PATCH, 'lib/material-money-v4.ts'), resolve(temporary, 'lib/material-money-v4.ts'));
const load = file => import(pathToFileURL(resolve(temporary, 'lib', file)).href);
const { normalizeMoneyValueV4: parse, normalizeCandidateValueV4: normalize, canonicalMonetaryExpression: canonical } = await load('material-money-v4.ts');
const { ingestRuntimeCandidates, validateRuntimeCandidateOutput } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates, validateCandidateOutput } = await load('material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('material-fact-source-review.ts');
const AT = '2026-10-19T00:00:00.000Z';
const length = value => Array.from(value).length;

function fixture(expression, value = expression, { fullQuote = false, nextBlock = null } = {}) {
  const text = '😀王甲工资记载' + expression + (nextBlock === null ? '。' : '');
  const source = { id: 'round38-postfix-currency', name: '合成重复人民币标签', sha256: 'c'.repeat(64), analysisRevision: 1, ready: true,
    blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
  if (nextBlock !== null) source.blocks.push({ id: 'b2', page: 1, text: nextBlock + '。', bbox: null, confidence: null });
  const candidate = { kind: 'money', value, quote: fullQuote ? text : value, blockId: 'b1', subject: '王甲', scope: 'individual',
    meaning: 'other_money', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
  return { source, candidate, raw: JSON.stringify({ schemaVersion: 3, candidates: [candidate] }) };
}

function pipeline(f, amount) {
  const original = structuredClone(f);
  assert.equal(validateCandidateOutput(f.raw, f.source).candidates.length, 1, 'all eleven candidate fields and envelope are valid');
  assert.equal(validateRuntimeCandidateOutput(f.raw, f.source).candidates.length, 1, 'ambiguous money stays reviewable');
  const check = fact => {
    assert(fact); assert.equal(fact.amount, amount); assert.deepEqual(fact.representation, f.candidate);
    assert.equal(fact.value, f.candidate.value); assert.equal(fact.quote, f.candidate.quote);
    assert.equal(fact.normalization.rawValue, f.candidate.value);
    const text = f.source.blocks[0].text, start = length(text.slice(0, text.indexOf(f.candidate.quote)));
    assert.deepEqual([fact.start, fact.end], [start, start + length(f.candidate.quote)]);
    assert.equal(Array.from(text).slice(fact.start, fact.end).join(''), f.candidate.quote);
  };
  const fresh = ingestRuntimeCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'round38-author', AT);
  assert.equal(fresh.materials[0].raw, f.raw); check(fresh.materials[0].candidates[0]);
  assert.deepEqual(fresh.confirmations, { due: null, paid: null }); assert.equal(fresh.calculation, null);
  const history = ingestCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'round38-author', AT);
  const fact = history.materials[0].candidates[0]; assert(fact);
  fact.amount = amount ?? '4000.00'; fact.normalization = { rawValue: fact.value, status: 'exact', amount: fact.amount,
    matchedText: fact.value, span: { start: 0, end: length(fact.value) }, reason: 'Synthetic persisted exact amount.' };
  const stored = structuredClone(history), reviewed = reviewFactsAgainstSources(history, [f.source]);
  check(reviewed.materials[0].candidates[0]); assert.equal(reviewed.materials[0].raw, f.raw);
  assert.deepEqual(history, stored); assert.deepEqual(reviewed.history, stored.history);
  fact.amount = null; fact.normalization = { rawValue: fact.value, status: 'unsupported', amount: null,
    matchedText: null, span: null, reason: 'Synthetic stored unsupported; never auto-upgrade.' };
  const unavailable = structuredClone(history), rechecked = reviewFactsAgainstSources(history, [f.source]);
  assert.equal(rechecked.materials[0].candidates[0].amount, null); assert.deepEqual(history, unavailable);
  assert.deepEqual(rechecked.history, unavailable.history); assert.deepEqual(f, original);
}

const duplicates = [
 ['￥4000￥','￥4000'], ['¥4000¥','¥4000'], ['人民币4000￥','人民币4000'], ['人民幣4000¥','人民幣4000'],
 ['4000元￥','4000元'], ['4000圆¥','4000圆'], ['四千圓￥','四千圓'], ['4000元整￥','4000元'],
 ['４０００元\u200d￥','４０００元'], ['4000元人民币￥','4000元人民币'], ['4000元CNY¥','4000元CNY'],
 ['RMB4000¥','RMB4000'], ['￥4000元￥','￥4000元'], ['5角人民币￥','5角人民币'],
];
for (const [expression,value] of duplicates) {
 test('complete attached postfix RMB symbol remains unavailable: '+expression,()=>{
  assert.equal(parse(expression).amount,null); assert.equal(canonical(expression),null); pipeline(fixture(expression),null);
 });
 for (const fullQuote of [false,true]) test('clipped postfix RMB symbol cannot produce an exact fact: '+JSON.stringify({expression,value,fullQuote}),()=>pipeline(fixture(expression,value,{fullQuote}),null));
}
for (const symbol of ['¥','￥']) for (const value of ['4000元','4000']) for (const layout of ['line','block'])
 test('source layout cannot remove postfix symbol: '+JSON.stringify({symbol,value,layout}),()=>{
  pipeline(fixture('4000元'+(layout==='line'?'\n'+symbol:''),value,{nextBlock:layout==='block'?symbol:null}),null);
 });
for (const [expression,amount] of [['￥4000','4000.00'],['¥4000元','4000.00'],['￥４０００元','4000.00'],['人民币￥4000元','4000.00'],['￥4000元人民币','4000.00'],['4000元人民币','4000.00'],['4000CNY','4000.00'],['人民币5角','0.50']])
 test('existing single prefix and finite named-unit contracts remain: '+expression,()=>{assert.equal(parse(expression).amount,amount);assert.equal(canonical(expression),'exact:'+amount);pipeline(fixture(expression),amount);});
for (const tail of ['。￥是符号','；¥是符号','。王乙金额￥5000']) test('separate statement cannot attach a postfix symbol: '+tail,()=>pipeline(fixture('4000元'+tail,'4000元'),'4000.00'));
test('another page cannot attach a postfix symbol',()=>{const f=fixture('4000元','4000元',{nextBlock:'￥'});f.source.blocks[1].page=2;pipeline(f,'4000.00');});
