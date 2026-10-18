// Direct coordinated-owner aliases requested in R37. Synthetic source only.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = resolve(process.env.MATERIAL_FACT_TEST_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const EVENT = resolve(process.env.MATERIAL_FACT_EVENT_FILE || resolve(ROOT, 'lib/material-fact-event-review.ts'));
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-r37-coordinator-alias-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(ROOT, 'lib'), resolve(temporary, 'lib'), { recursive: true });
await cp(EVENT, resolve(temporary, 'lib/material-fact-event-review.ts'));
const load = file => import(pathToFileURL(resolve(temporary, 'lib', file)).href);
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, buildFactView, ingestCandidates } = await load('material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('material-fact-source-review.ts');
console.log(JSON.stringify({ node: process.version, event_sha256: createHash('sha256').update(await readFile(EVENT)).digest('hex') }));
const cpLength = text => Array.from(text).length;
for (const [subject, supported] of [['王跟欧', false], ['王暨欧', false], ['王或欧', false], ['王同欧', false],
  ['王&欧', false], ['王／欧', false], ['王甲', true], ['何和', true], ['周及', true]]) {
  test(`coordinated-owner alias cannot be a usable single total: ${subject}`, () => {
    const text = `😀${subject}2026年1月全部应付工资合计4000元。`;
    const source = { id: 'r37-alias', name: 'synthetic.txt', sha256: '4'.repeat(64), analysisRevision: 37, ready: true,
      blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
    for (const quote of ['4000元', text]) {
      const representation = { kind: 'money', value: '4000元', quote, blockId: 'b1', subject, scope: 'individual', meaning: 'due_total',
        completeness: 'complete', period: '2026年1月', rateUnit: null, assertion: 'narrated' };
      const raw = JSON.stringify({ schemaVersion: 3, candidates: [representation] }), at = '2026-10-19T19:00:00.000Z';
      const fresh = ingestRuntimeCandidates(emptyFactState(37), source, { raw }, 'synthetic', 'fixture', at);
      const old = ingestCandidates(emptyFactState(37), source, { raw }, 'synthetic', 'fixture', at);
      old.materials[0].candidates[0].amount = '4000.00';
      old.materials[0].candidates[0].normalization = { rawValue: representation.value, status: 'exact', amount: '4000.00', matchedText: representation.value,
        span: { start: 0, end: cpLength(representation.value) }, reason: 'Synthetic historical observation' };
      const unchanged = structuredClone({ old, source }), reviewed = reviewFactsAgainstSources(old, [source]);
      assert.deepEqual({ old, source }, unchanged);
      for (const state of [fresh, reviewed]) {
        const item = state.materials[0].candidates[0];
        assert.equal(item.amount, '4000.00'); assert.deepEqual(item.representation, representation); assert.equal(state.materials[0].raw, raw);
        assert.equal(Array.from(text).slice(item.start, item.end).join(''), quote);
        assert.equal(item.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), !supported);
        state.scope = { worker: subject, employer: '甲公司', start: '2026-01-01', end: '2026-01-31' };
        state.scopeReview = { actor: 'fixture', at, note: 'Synthetic existing scope only' };
        const view = buildFactView(state, [source]);
        assert.deepEqual(view.fields.due.values, supported ? ['4000.00'] : []);
        assert.equal(view.canCalculate, false); assert.deepEqual(state.confirmations, { due: null, paid: null });
      }
      old.materials[0].candidates[0].amount = null;
      old.materials[0].candidates[0].normalization = { ...old.materials[0].candidates[0].normalization, status: 'unsupported', amount: null };
      assert.equal(reviewFactsAgainstSources(old, [source]).materials[0].candidates[0].amount, null);
    }
  });
}
