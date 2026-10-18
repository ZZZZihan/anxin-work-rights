// R40 nonimplementer controls for the finite complete-total role extension.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.MATERIAL_FACT_TEST_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const load = name => import(pathToFileURL(resolve(ROOT, 'lib', name + '.ts')).href);
const { emptyFactState, ingestCandidates: legacy, validateCandidateOutput, buildFactView } = await load('material-facts-v3');
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest');
const { reviewFactsAgainstSources } = await load('material-fact-source-review');
const AT = '2026-10-19T04:15:00.000Z';

function check(text, expected, changes = {}, additionalSourceText = null) {
  const value = '4800元';
  const source = { id: 'r40-independent-total', name: 'synthetic.txt', sha256: '7'.repeat(64), ready: true, analysisRevision: 40,
    blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
  if (additionalSourceText !== null) source.blocks.push({ id: 'b2', page: 2, text: additionalSourceText, bbox: null, confidence: null });
  for (const quote of [value, text]) {
    const item = { kind: 'money', value, quote, blockId: 'b1', subject: '赵丙', scope: 'individual', meaning: 'due_total',
      completeness: 'complete', period: '2026年2月', rateUnit: null, assertion: 'claimed', ...changes };
    const raw = JSON.stringify({ schemaVersion: 3, candidates: [item] });
    assert.equal(validateCandidateOutput(raw, source).rejected.length, 0);
    const older = legacy(emptyFactState(40), source, { raw }, 'synthetic', 'independent', AT);
    assert.equal(older.materials[0].candidates.length, 1);
    Object.assign(older.materials[0].candidates[0], { amount: '4800.00', normalization: { rawValue: value, status: 'exact',
      amount: '4800.00', matchedText: value, span: { start: 0, end: 5 }, reason: 'Synthetic historical unconfirmed exact.' } });
    const before = structuredClone({ older, source });
    for (const state of [ingestRuntimeCandidates(emptyFactState(40), source, { raw }, 'synthetic', 'independent', AT), reviewFactsAgainstSources(older, [source])]) {
      const fact = state.materials[0].candidates[0];
      assert.equal(fact.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), !expected);
      assert.deepEqual(fact.representation, item); assert.equal(state.materials[0].raw, raw);
      assert.equal(Array.from(text).slice(fact.start, fact.end).join(''), quote);
      const scoped = structuredClone(state);
      scoped.scope = { worker: '赵丙', employer: '甲公司', start: '2026-02-01', end: '2026-02-28' };
      scoped.scopeReview = { note: 'Synthetic scope only; no amount confirmation.', actor: 'independent', at: AT };
      const view = buildFactView(scoped, [source]);
      assert.deepEqual(view.fields.due.values, expected ? ['4800.00'] : []);
      assert.deepEqual(view.fields.paid.values, []); assert.equal(view.canCalculate, false);
      assert.deepEqual(scoped.confirmations, { due: null, paid: null }); assert.equal(scoped.calculation, null);
    }
    assert.deepEqual({ older, source }, before);
  }
}
test('another explicit single worker and whole period can suggest its due amount, without confirmation', () => check('😀赵丙2026年2月应发工资总计4800元。', true));
test('a model cannot borrow a period from another worker event', () => check('😀赵丙2026年2月应发工资总计4800元。', false, { period: '2026年1月' }, '钱丁2026年1月应付工资合计5000元。'));
test('a coordinated source label does not become an individual by model metadata', () => check('😀赵丙和钱丁2026年2月应发工资总计4800元。', false));
test('a partial claim is not a complete total despite the source word 总计', () => check('😀赵丙2026年2月应发工资总计4800元。', false, { completeness: 'partial' }));
test('实发 cannot become an 应发 total by role metadata', () => check('😀赵丙2026年2月实发工资总计4800元。', false));
test('an omitted wage component cannot disappear behind a total cue', () => check('😀赵丙2026年2月应发工资总计4800元但另有工资未计。', false));
test('the amount from another worker event cannot serve the first owner', () => check('😀赵丙2026年2月应发工资合计5000元。钱丁2026年2月应发工资合计4800元。', false));
