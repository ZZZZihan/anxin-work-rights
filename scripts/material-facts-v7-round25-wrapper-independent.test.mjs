import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Only the two post-f16 wrapper findings. Synthetic source/raw; no HTTP/model.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(ROOT, path)));
const { normalizeMoneyValueV4: money, normalizeCandidateValueV4: normalize } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates: fresh } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, buildFactView } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const cp = text => Array.from(text).length;
const raw = candidates => JSON.stringify({ schemaVersion: 3, candidates });
const entry = (value, quote = value, extra = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual',
  meaning: 'other_money', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated', ...extra });
const sourceFor = texts => ({ id: 'r25-wrapper', name: 'synthetic.txt', sha256: 'e'.repeat(64), analysisRevision: 25, ready: true,
  blocks: (Array.isArray(texts) ? texts : [texts]).map((text, i) => ({ id: 'b' + (i + 1), page: 1, text, bbox: null, confidence: null })) });
function ingest(source, candidates, historical = false) {
  const state = (historical ? legacy : fresh)(emptyFactState(25), source, { raw: raw(candidates) }, 'independent', 'synthetic', '2026-10-18T20:00:00.000Z', null);
  assert.equal(state.materials[0].raw, raw(candidates));
  assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
  assert.equal(buildFactView(state, [source]).canCalculate, false);
  for (const fact of state.materials[0].candidates) {
    const candidate = fact.representation, text = source.blocks.find(block => block.id === candidate.blockId).text;
    assert(candidates.some(item => JSON.stringify(item) === JSON.stringify(candidate)));
    const at = text.indexOf(candidate.quote); assert(at >= 0);
    assert.equal(fact.start, cp(text.slice(0, at))); assert.equal(fact.end, fact.start + cp(candidate.quote));
  }
  return state;
}
function history(source, candidate, amount, status) {
  const old = ingest(source, [candidate], true), fact = old.materials[0].candidates[0]; assert(fact);
  fact.amount = amount;
  fact.normalization = { rawValue: candidate.value, status, amount, matchedText: candidate.value,
    span: { start: 0, end: cp(candidate.value) }, reason: 'Synthetic stored state; never confirmed.' };
  const before = structuredClone(old), reviewed = reviewFactsAgainstSources(old, [source]);
  assert.deepEqual(old, before); assert.equal(reviewed.materials[0].raw, raw([candidate]));
  assert.equal(buildFactView(reviewed, [source]).canCalculate, false);
  return reviewed.materials[0].candidates[0];
}
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-source-review.ts', 'lib/material-fact-runtime-ingest.ts'])
  console.log(JSON.stringify({ evidence: 'round25_wrapper_source', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));

for (const terminal of ['整', '正']) for (const layout of ['same', 'newline', 'block'])
  test('cropping only a whole-amount terminal preserves the amount without history upgrade: ' + terminal + '/' + layout, () => {
    const source = sourceFor(layout === 'block' ? ['😀王甲工资4000元', terminal + '。']
      : '😀王甲工资4000元' + (layout === 'newline' ? '\n' : '') + terminal + '。');
    assert.equal(money('4000元' + terminal).amount, '4000.00');
    const observations = [];
    for (const quote of ['4000元', source.blocks[0].text]) {
      const candidate = entry('4000元', quote), state = ingest(source, [candidate]);
      assert.equal(state.materials[0].candidates.length, 1);
      observations.push({ quote, fresh: state.materials[0].candidates[0].amount,
        storedExact: history(source, candidate, '4000.00', 'exact').amount,
        storedUnsupported: history(source, candidate, null, 'unsupported').amount });
    }
    const quoteNormalization = layout === 'same' ? normalize(entry('4000元', source.blocks[0].text)).amount : 'not-applicable';
    console.log(JSON.stringify({ evidence: 'round25_terminal_observation', terminal, layout, quoteNormalization, observations }));
    if (layout === 'same') assert.equal(quoteNormalization, '4000.00');
    for (const observed of observations) {
      assert.equal(observed.fresh, '4000.00'); assert.equal(observed.storedExact, '4000.00');
      assert.equal(observed.storedUnsupported, null);
    }
  });
test('actual omitted subunits and malformed continuations remain null, while full subunits stay precise', () => {
  for (const [text, amount] of [['4000元5角', '4000.50'], ['4000元5分', '4000.05']]) {
    assert.equal(money(text).amount, amount);
    const source = sourceFor('😀王甲工资' + text + '。');
    for (const quote of ['4000元', source.blocks[0].text]) {
      const candidate = entry('4000元', quote);
      assert.equal(ingest(source, [candidate]).materials[0].candidates[0].amount, null);
      assert.equal(history(source, candidate, '4000.00', 'exact').amount, null);
    }
  }
  for (const text of ['4000元整5角', '4000元正5分']) {
    const source = sourceFor('😀王甲工资' + text + '。'), candidate = entry('4000元', source.blocks[0].text);
    assert.equal(normalize(candidate).amount, null);
    assert.equal(ingest(source, [candidate]).materials[0].candidates[0].amount, null);
  }
});
for (const suffix of ['人民币', '人民幣', 'RMB', 'CNY']) for (const reverse of [false, true])
  test('one unique occurrence with a postposed RMB wrapper collapses in both orders: ' + suffix + reverse, () => {
    const source = sourceFor('😀王甲收到4000元' + suffix + '。'), quote = source.blocks[0].text;
    const candidates = [entry('4000元', quote), entry('4000元' + suffix, quote)]; if (reverse) candidates.reverse();
    for (const candidate of candidates) assert.equal(normalize(candidate).amount, '4000.00');
    const state = ingest(source, candidates), material = state.materials[0];
    assert.equal(JSON.parse(material.raw).candidates.length, 2);
    assert.equal(material.candidates.length, 1); assert.equal(material.rejected.length, 1);
    assert.equal(material.candidates[0].amount, '4000.00');
  });
test('different equal-value events retain both postposed wrappers in the same or separate blocks', () => {
  for (const separateBlocks of [false, true]) {
    const first = '😀王甲第一笔收到4000元人民币。', second = '王甲第二笔收到4000元人民币。';
    const source = sourceFor(separateBlocks ? [first, second] : first + second);
    const state = ingest(source, [entry('4000元', first), entry('4000元人民币', second, { blockId: separateBlocks ? 'b2' : 'b1' })]);
    assert.equal(state.materials[0].candidates.length, 2); assert.equal(state.materials[0].rejected.length, 0);
  }
});
test('ambiguous repeated quotes and different assertions do not borrow wrapper deduplication', () => {
  const repeated = sourceFor('😀王甲第一笔4000元人民币。王甲第二笔4000元人民币。');
  const ambiguous = ingest(repeated, [entry('4000元', '4000元人民币'), entry('4000元人民币', '4000元人民币')]);
  assert.equal(ambiguous.materials[0].candidates.length, 2);
  const source = sourceFor('😀王甲收到4000元人民币。'), quote = source.blocks[0].text;
  const assertions = ingest(source, [entry('4000元', quote), entry('4000元人民币', quote, { assertion: 'claimed' })]);
  assert.equal(assertions.materials[0].candidates.length, 2);
});
test('ordinary narrative around an amount is not a permitted finite wrapper', () => {
  const source = sourceFor('😀王甲收到4000元人民币。'), quote = source.blocks[0].text;
  const state = ingest(source, [entry('王甲收到4000元人民币', quote), entry('4000元', quote)]);
  assert.equal(state.materials[0].candidates.length, 2);
});
