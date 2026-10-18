import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const base = resolve(process.env.V7_POSTPOSED_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const temp = await mkdtemp(resolve(tmpdir(), 'anxin-postposed-uncertainty-'));
after(() => rm(temp, { recursive: true, force: true }));
await cp(resolve(base, 'lib'), resolve(temp, 'lib'), { recursive: true });
const load = name => import(pathToFileURL(resolve(temp, 'lib', name)).href);
const { ingestRuntimeCandidates: ingest } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState } = await load('material-facts-v3.ts');
const { reviewFactsAgainstSources: review } = await load('material-fact-source-review.ts');
const { normalizeMoneyValueV4: money, normalizeCandidateValueV4: normalize } = await load('material-money-v4.ts');
function fixture(tail, full = false, split = false) {
 const text = '😀。王甲2026年1月全部应付工资合计4000元' + (split ? '' : tail);
 const source = { id: 'postposed-uncertainty', name: 'synthetic', sha256: 'c'.repeat(64), ready: true, analysisRevision: 15,
  blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }, ...(split ? [{ id: 'b2', page: 1, text: tail, bbox: null, confidence: null }] : [])] };
 const candidate = { kind: 'money', value: '4000元', quote: full ? text : '4000元', blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'due_total', completeness: 'complete', period: '2026年1月', rateUnit: null, assertion: 'narrated' };
 const raw = JSON.stringify({ schemaVersion: 3, candidates: [candidate] });
 const state = ingest(emptyFactState(15), source, {raw}, 'synthetic', 'synthetic', '2026-10-18T00:00:00Z');
 const fact = state.materials[0].candidates[0]; assert(fact);
 assert.equal(state.materials[0].raw, raw); assert.deepEqual(fact.representation, candidate);
 const at = text.indexOf(candidate.quote);assert.equal(fact.start, Array.from(text.slice(0, at)).length);assert.equal(fact.end, Array.from(text.slice(0, at + candidate.quote.length)).length);
 assert.equal(state.calculation, null);assert.deepEqual(state.confirmations, { due: null, paid: null });
 return { source, candidate, raw, state, fact };
}
for (const marker of ['？','?','待核实','待定','未知','待确认','（待核实）','不详']) {
 for (const full of [false, true]) for (const layout of ['', ' \u200b', '\n', 'block']) test(`postposed uncertainty stays unavailable: ${marker}/${full}/${JSON.stringify(layout)}`, () => {
  const f = fixture((layout === 'block' ? '' : layout) + marker, full, layout === 'block');
  assert.equal(f.fact.amount, null);
  if (layout !== 'block') assert.equal(normalize({ ...f.candidate, quote: f.source.blocks[0].text }).amount, null);
  const historical = structuredClone(f.state);Object.assign(historical.materials[0].candidates[0], { amount: '4000.00', normalization: money('4000元') });
  const before = structuredClone(historical), checked = review(historical, [f.source]);
  assert.equal(checked.materials[0].candidates[0].amount, null);assert.deepEqual(historical, before);assert.equal(checked.materials[0].raw, f.raw);
 });
}
for (const tail of ['。','已核实。','，王乙工资3000元？','。金额未知的是王乙工资。','；待核实的是另一材料。','\n王乙工资未知。']) for (const full of [false, true]) test(`separate event or confirmed amount keeps its number: ${tail}/${full}`, () => {
 assert.equal(fixture(tail, full).fact.amount, '4000.00');
});

for (const group of ['班組', '全體工人', '多名員工', '兩名農民工']) test(`traditional source group remains a review warning: ${group}`, () => {
 const f = fixture('。'); f.source.blocks.unshift({ id: 'heading', page: 1, text: group, bbox: null, confidence: null });
 const state = ingest(emptyFactState(15), f.source, {raw: f.raw}, 'synthetic', 'synthetic', '2026-10-18T00:00:00Z');
 assert(state.materials[0].candidates[0].reviewIssues.some(issue => issue.code === 'scope_text_mismatch'));
 assert.equal(state.materials[0].raw, f.raw);
});
