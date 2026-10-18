import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(ROOT, path)));
const { canonicalMonetaryExpression, classifyMonetaryExpression } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, buildFactView, validateCandidateOutput } = await load('lib/material-facts-v3.ts');

// Separate supplement requested by the parent. The original 14 assertions remain
// locked. This inspects the real view projection and comparison keys, not a UI
// browser session, scorer run, historical CLI, or synthetic confirmation action.
for (const meaning of ['other_money', 'due_total']) test('a retained name-containing empty label is not a usable/precise fact: ' + meaning, () => {
  const value = '王甲人民币工资';
  const text = meaning === 'due_total' ? '😀王甲2026年1月完整应付工资合计王甲人民币工资。' : '😀王甲人民币工资。';
  const source = { id: 'r35-prose', name: 'synthetic.txt', sha256: '6'.repeat(64), ready: true, analysisRevision: 35,
    blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
  const candidate = { kind: 'money', value, quote: value, blockId: 'b1', subject: '王甲', scope: 'individual', meaning,
    completeness: meaning === 'due_total' ? 'complete' : 'not_applicable', period: meaning === 'due_total' ? '2026年1月' : null, rateUnit: null, assertion: 'narrated' };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [candidate] });
  assert.equal(validateCandidateOutput(raw, source).rejected.length, 0);
  const state = ingestRuntimeCandidates(emptyFactState(35), source, { raw }, 'independent', 'synthetic', '2026-10-19T00:00:00.000Z', null);
  const material = state.materials[0]; assert.equal(material.candidates.length, 1);
  const fact = material.candidates[0]; assert.equal(fact.amount, null); assert.equal(fact.normalization.status, 'unsupported');
  assert(fact.normalization.reason.length > 0); assert.equal(material.raw, raw); assert.deepEqual(fact.representation, candidate);
  // Supply an otherwise confirmed scope to make the amount-null requirement
  // substantive; this fixture does not call the confirmation API or authorize it.
  state.scope = { worker: '王甲', employer: '合成单位', start: '2026-01-01', end: '2026-01-31' };
  state.scopeReview = { note: 'Synthetic scope for eligibility projection only.', actor: 'independent', at: '2026-10-19T00:00:00.000Z' };
  const view = buildFactView(state, [source]);
  assert.deepEqual(view.fields.due.values, []); assert.deepEqual(view.fields.paid.values, []); assert.equal(view.canCalculate, false);
  assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
  const canonical = canonicalMonetaryExpression(value); assert.equal(canonical, null);
  const comparisonKey = input => classifyMonetaryExpression(input).kind === 'not_monetary' ? null : canonicalMonetaryExpression(input) ?? `literal:${input}`;
  const literalKey = comparisonKey(value), realAmountKey = comparisonKey('人民币4000元');
  assert.notEqual(literalKey, realAmountKey); assert.equal(realAmountKey, 'exact:4000.00');
  console.log(JSON.stringify({ evidence: 'round35_prose_eligibility', source, candidate, fact, view, literalKey, realAmountKey,
    interpretation: 'Literal-key equality of unsupported prose is not an exact monetary value. It cannot match a real-amount key even before event/attribute matching.' }));
});
