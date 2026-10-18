import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Finite full-check regression closure. Original ROUND35 14+2 remain unchanged.
// Actual module/runtime/source review only; no service, scorer or frozen CLI.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = name => import(pathToFileURL(resolve(ROOT, name)));
const { ingestRuntimeCandidates } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates, validateCandidateOutput, buildFactView } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const cp = text => Array.from(text).length;
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-source-review.ts']) console.log(JSON.stringify({
  evidence: 'round35_continuation_product', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex'),
}));

function check(texts, { pages = texts.map(() => 1), block = 0, value = '4000元', wanted = null, seed = '4000.00', status = null } = {}) {
  const source = { id: 'r35-continuation-independent', name: 'synthetic.txt', sha256: '3'.repeat(64), ready: true, analysisRevision: 35,
    blocks: texts.map((text, i) => ({ id: 'b' + (i + 1), page: pages[i], text, bbox: null, confidence: null })) };
  for (const quote of [value, texts[block]]) {
    const candidate = { kind: 'money', value, quote, blockId: 'b' + (block + 1), subject: '王甲', scope: 'individual',
      meaning: 'other_money', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
    const raw = JSON.stringify({ schemaVersion: 3, candidates: [candidate] });
    assert.equal(validateCandidateOutput(raw, source).rejected.length, 0, 'The regression fixture must pass the actual schema.');
    const observations = [];
    for (const history of [null, 'exact', 'unsupported']) {
      const supplied = (history ? ingestCandidates : ingestRuntimeCandidates)(emptyFactState(35), source, { raw }, 'independent', 'synthetic', '2026-10-19T00:00:00.000Z', null);
      assert.equal(supplied.materials[0].candidates.length, 1);
      if (history) {
        const fact = supplied.materials[0].candidates[0], amount = history === 'exact' ? seed : null;
        fact.amount = amount; fact.normalization = { rawValue: value, status: history, amount, matchedText: value,
          span: { start: 0, end: cp(value) }, reason: 'Synthetic unconfirmed historical value.' };
      }
      const before = structuredClone({ supplied, source });
      const state = history ? reviewFactsAgainstSources(supplied, [source]) : supplied;
      assert.deepEqual({ supplied, source }, before);
      const material = state.materials[0], fact = material.candidates[0], at = texts[block].indexOf(quote);
      assert.equal(material.raw, raw); assert.deepEqual(fact.representation, candidate);
      assert(at >= 0); assert.equal(texts[block].indexOf(quote, at + 1), -1);
      assert.equal(fact.start, cp(texts[block].slice(0, at))); assert.equal(fact.end, fact.start + cp(quote));
      assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
      assert.equal(buildFactView(state, [source]).canCalculate, false);
      observations.push({ history: history ?? 'fresh', amount: fact.amount, status: fact.normalization.status, issues: fact.reviewIssues });
    }
    console.log(JSON.stringify({ evidence: 'round35_continuation_observation', source, candidate, wanted, observations }));
    for (const fact of observations) {
      assert.equal(fact.amount, fact.history === 'unsupported' ? null : wanted, JSON.stringify({ texts, pages, quote, fact }));
      if (status && fact.history !== 'unsupported') assert.equal(fact.status, status);
    }
  }
}

test('same-page omitted ending cannot hide a question mark', () => {
  for (const terminal of ['整', '正']) check(['😀王甲工资4000元' + terminal, '？']);
});
test('same-page omitted ending cannot hide a foreign currency marker', () => {
  for (const terminal of ['整', '正']) check(['😀王甲工资4000元' + terminal, 'USD']);
});
test('same-page split payment instruction retains its terminal uncertainty', () => check(['😀王甲工资4000元', '三日内支付?。']));
test('same-page split multiplication retains the unsupported classification', () => check(['😀王甲工资4000元×', '２。'], { status: 'unsupported' }));
test('same-page split 暫定 never becomes a precise amount', () => check(['😀王甲工资4000元暫', '定。']));
test('same-page cents tail cannot be exposed as an independent 0.02', () => check(['😀王甲工资5角', '2分RMB。'], { block: 1, value: '2分RMB', seed: '0.02' }));
test('same-page split unsupported rate prefix is not a complete total', () => check(['😀王甲每', '周工资4000元。'], { block: 1 }));
test('page breaks keep separate questions and currency text out of the amount expression', () => {
  for (const tail of ['？', 'USD']) check(['😀王甲工资4000元整', tail], { pages: [1, 2], wanted: '4000.00' });
});
test('a sentence boundary and another explicit owner stay separate on the same page', () => check(['😀王甲工资4000元整。', '李乙工资5角待定。'], { wanted: '4000.00' }));
