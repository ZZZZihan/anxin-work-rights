import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// One bounded interaction: the newly accepted terminator must not hide a
// second explicit RMB subunit behind it, including an OCR block boundary.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(ROOT, path)));
const { ingestRuntimeCandidates } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates, buildFactView } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const cp = text => Array.from(text).length;
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-source-review.ts', 'lib/material-fact-runtime-ingest.ts'])
  console.log(JSON.stringify({ evidence: 'round25_rmb_subunit_source', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));

test('a single whole-amount terminator followed by RMB and another subunit never exposes the cropped base amount', () => {
  const observations = [];
  for (const terminal of ['整', '正']) for (const layout of ['same', 'newline', 'block']) {
    const lead = '😀𠮷。王甲工资4000元';
    const texts = layout === 'block' ? [lead, terminal + '人民币5角。']
      : [lead + terminal + (layout === 'newline' ? '\n' : '') + '人民币5角。'];
    const source = { id: 'r25-rmb-subunit-cross', name: 'synthetic.txt', sha256: 'd'.repeat(64), analysisRevision: 25, ready: true,
      blocks: texts.map((text, index) => ({ id: 'b' + (index + 1), page: 1, text, bbox: null, confidence: null })) };
    for (const quote of ['4000元', texts[0]]) for (const stored of [false, true]) {
      const item = { kind: 'money', value: '4000元', quote, blockId: 'b1', subject: '王甲', scope: 'individual',
        meaning: 'other_money', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
      const raw = JSON.stringify({ schemaVersion: 3, candidates: [item] });
      const state = (stored ? ingestCandidates : ingestRuntimeCandidates)(emptyFactState(25), source, { raw }, 'independent', 'synthetic', '2026-10-18T20:00:00.000Z', null);
      assert.equal(state.materials[0].candidates.length, 1);
      if (stored) {
        const fact = state.materials[0].candidates[0]; fact.amount = '4000.00';
        fact.normalization = { rawValue: item.value, status: 'exact', amount: '4000.00', matchedText: item.value,
          span: { start: 0, end: cp(item.value) }, reason: 'Synthetic old exact amount, never confirmed.' };
      }
      const before = structuredClone(state), reviewed = stored ? reviewFactsAgainstSources(state, [source]) : state;
      assert.deepEqual(state, before);
      const fact = reviewed.materials[0].candidates[0], at = texts[0].indexOf(quote);
      assert.equal(reviewed.materials[0].raw, raw); assert.deepEqual(fact.representation, item);
      assert.equal(fact.start, cp(texts[0].slice(0, at))); assert.equal(fact.end, fact.start + cp(quote));
      assert.deepEqual(reviewed.confirmations, { due: null, paid: null }); assert.equal(reviewed.calculation, null);
      assert.equal(buildFactView(reviewed, [source]).canCalculate, false);
      observations.push({ terminal, layout, quote, stored, amount: fact.amount, status: fact.normalization?.status });
    }
  }
  console.log(JSON.stringify({ evidence: 'round25_rmb_subunit_cross_observations', observations }));
  for (const row of observations) assert.equal(row.amount, null, JSON.stringify(row));
});
