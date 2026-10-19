import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// A finite cross-check of the omitted 整/正 fix. No model, service or stored edit.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(ROOT, path)));
const { normalizeCandidateValueV4: normalize } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates: fresh } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, buildFactView } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const cp = text => Array.from(text).length;
const candidate = quote => ({ kind: 'money', value: '4000元', quote, blockId: 'b1', subject: '王甲', scope: 'individual',
  meaning: 'other_money', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' });
const sourceFor = texts => ({ id: 'r25-terminal-safety', name: 'synthetic.txt', sha256: 'f'.repeat(64), analysisRevision: 25, ready: true,
  blocks: (Array.isArray(texts) ? texts : [texts]).map((text, i) => ({ id: 'b' + (i + 1), page: 1, text, bbox: null, confidence: null })) });
function stateFor(source, item, storedStatus) {
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [item] });
  const state = (storedStatus ? legacy : fresh)(emptyFactState(25), source, { raw }, 'independent', 'synthetic', '2026-10-18T20:00:00.000Z', null);
  assert.equal(state.materials[0].raw, raw);
  assert.equal(state.materials[0].candidates.length, 1, 'Money with an unsafe continuation remains an accepted review candidate.');
  if (storedStatus) {
    const fact = state.materials[0].candidates[0], amount = storedStatus === 'exact' ? '4000.00' : null;
    fact.amount = amount;
    fact.normalization = { rawValue: item.value, status: storedStatus, amount, matchedText: item.value,
      span: { start: 0, end: cp(item.value) }, reason: 'Synthetic historical amount, never confirmed.' };
  }
  const original = structuredClone(state);
  const reviewed = storedStatus ? reviewFactsAgainstSources(state, [source]) : state;
  assert.deepEqual(state, original);
  const fact = reviewed.materials[0].candidates[0], text = source.blocks[0].text, at = text.indexOf(item.quote);
  assert(at >= 0); assert.equal(fact.start, cp(text.slice(0, at))); assert.equal(fact.end, fact.start + cp(item.quote));
  assert.deepEqual(fact.representation, item); assert.equal(reviewed.materials[0].raw, raw);
  assert.deepEqual(reviewed.confirmations, { due: null, paid: null }); assert.equal(reviewed.calculation, null);
  assert.equal(buildFactView(reviewed, [source]).canCalculate, false);
  return fact;
}
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-source-review.ts', 'lib/material-fact-runtime-ingest.ts'])
  console.log(JSON.stringify({ evidence: 'round25_terminal_safety_source', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));

for (const continuation of ['？', '待定', '5角', '五分', '万元', '至4'])
  test('a cropped terminal cannot hide the attached continuation: ' + continuation, () => {
    const observations = [];
    for (const terminal of ['整', '正']) for (const layout of ['same', 'newline', 'block']) {
      const lead = '😀𠮷。王甲工资4000元';
      const source = sourceFor(layout === 'block' ? [lead + terminal, continuation + '。']
        : lead + terminal + (layout === 'newline' ? '\n' : '') + continuation + '。');
      for (const quote of ['4000元', source.blocks[0].text]) {
        const item = candidate(quote);
        observations.push({ terminal, layout, quote, quoteAmount: layout === 'block' ? 'not-applicable' : normalize(item).amount,
          fresh: stateFor(source, item).amount, storedExact: stateFor(source, item, 'exact').amount,
          storedUnsupported: stateFor(source, item, 'unsupported').amount });
      }
    }
    console.log(JSON.stringify({ evidence: 'round25_terminal_continuation_observations', continuation, observations }));
    for (const observation of observations) {
      assert.equal(observation.fresh, null, JSON.stringify(observation));
      assert.equal(observation.storedExact, null, JSON.stringify(observation));
      assert.equal(observation.storedUnsupported, null, JSON.stringify(observation));
      if (observation.layout === 'same' && observation.quote !== '4000元') assert.equal(observation.quoteAmount, null);
    }
  });

test('a sentence boundary prevents a separate uncertainty or subunit event from attaching to a complete amount', () => {
  for (const terminal of ['整', '正']) for (const tail of ['李乙工资5角待定。', '另案4000万元至4。']) {
    const source = sourceFor('😀𠮷。王甲工资4000元' + terminal + '。' + tail);
    for (const quote of ['4000元', '王甲工资4000元' + terminal + '。']) {
      const item = candidate(quote);
      assert.equal(stateFor(source, item).amount, '4000.00');
      assert.equal(stateFor(source, item, 'exact').amount, '4000.00');
      assert.equal(stateFor(source, item, 'unsupported').amount, null);
    }
  }
});

test('a different subject at the next block does not turn its number into a continuation of this amount', () => {
  for (const terminal of ['整', '正']) {
    const source = sourceFor(['😀𠮷。王甲工资4000元' + terminal + '。', '李乙工资5角待定。']);
    const item = candidate('4000元');
    assert.equal(stateFor(source, item).amount, '4000.00');
    assert.equal(stateFor(source, item, 'exact').amount, '4000.00');
    assert.equal(stateFor(source, item, 'unsupported').amount, null);
  }
});
