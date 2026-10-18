import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Synthetic implementation regression checks. No model, service or frozen case.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const at = path => import(pathToFileURL(resolve(ROOT, path)));
const { normalizeMoneyValueV4, normalizeCandidateValueV4 } = await at('lib/material-money-v4.ts');
const { ingestRuntimeCandidates } = await at('lib/material-fact-runtime-ingest.ts');
const { reviewFactsAgainstSources } = await at('lib/material-fact-source-review.ts');
const { emptyFactState, ingestCandidates: ingestHistorical, buildFactView } = await at('lib/material-facts-v3.ts');
const cp = text => Array.from(text).length;
const WHEN = '2026-10-18T15:00:00.000Z';
const sourceFor = text => ({ id: 'round12-author-independent-source', name: 'synthetic-money-boundaries.txt',
  sha256: 'd'.repeat(64), analysisRevision: 11, ready: true,
  blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] });
const entry = (value, quote, changes = {}) => ({ kind: 'money', value, quote, blockId: 'b1',
  subject: '王甲', scope: 'individual', meaning: 'due_total', completeness: 'complete',
  period: null, rateUnit: null, assertion: 'narrated', ...changes });
const output = candidates => JSON.stringify({ schemaVersion: 3, candidates });
function ingest(source, candidates, historical = false) {
  const raw = output(candidates);
  const state = (historical ? ingestHistorical : ingestRuntimeCandidates)(emptyFactState(11), source,
    { raw }, 'author-round12', 'synthetic-owner', WHEN, null);
  assert.equal(state.materials[0].raw, raw);
  assert.deepEqual(JSON.parse(raw).candidates, candidates);
  assert.deepEqual(state.confirmations, { due: null, paid: null });
  assert.equal(state.calculation, null);
  assert.equal(buildFactView(state, [source]).canCalculate, false);
  return state;
}
function stored(source, candidate, state, amount) {
  assert.equal(state.materials[0].candidates.length, 1, 'Complex money remains reviewable.');
  const fact = state.materials[0].candidates[0];
  assert.equal(fact.amount, amount);
  assert.deepEqual(fact.representation, candidate);
  const block = source.blocks.find(block => block.id === candidate.blockId);
  const index = block.text.indexOf(candidate.quote);
  assert(index >= 0);
  assert.equal(fact.start, cp(block.text.slice(0, index)));
  assert.equal(fact.end, fact.start + cp(candidate.quote));
  return fact;
}
function unavailableInSource(text, value, changes = {}) {
  const source = sourceFor(text);
  for (const quote of [text, value]) {
    const candidate = entry(value, quote, changes);
    if (quote === text) assert.equal(normalizeCandidateValueV4(candidate).amount, null, 'Full quote cannot hide the modifier.');
    stored(source, candidate, ingest(source, [candidate]), null);
    const old = ingest(source, [candidate], true), prior = old.materials[0].candidates[0];
    prior.amount = normalizeMoneyValueV4(value).amount ?? '40000.00';
    prior.normalization = { rawValue: value, status: 'exact', amount: prior.amount, matchedText: value,
      span: { start: 0, end: cp(value) }, reason: 'Synthetic pre-fix exact history.' };
    const before = structuredClone(old), reviewed = reviewFactsAgainstSources(old, [source]);
    stored(source, candidate, reviewed, null);
    assert.deepEqual(old, before, 'Read-time review does not rewrite stored evidence.');
    assert.equal(reviewed.materials[0].raw, before.materials[0].raw);
  }
}
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-source-review.ts', 'lib/material-fact-currency-review.ts',
  'lib/material-fact-arithmetic-review.ts', 'lib/material-fact-runtime-ingest.ts', 'experiments/material-facts-v7/assess.mjs'])
  console.log(JSON.stringify({ evidence: 'implementation_hash', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));


const notSubunits = ['5分钟后离开', '5分鐘后离开', '5分米长', '5分贝', '5分数', '5分期支付', '5分批处理', '5角度', '5角色'];
for (const suffix of notSubunits) test('ordinary words cannot become a currency subunit: ' + suffix, () => {
  const value = '1000元' + suffix, text = '😀王甲收到工资' + value;
  assert.equal(normalizeMoneyValueV4(value).amount, null);
  unavailableInSource(text, '1000元' + suffix.slice(0, 2), { meaning: 'payment', completeness: 'partial' });
});
for (const layout of ['', ' ', '\n', '\r\n', '\u2028', '\u200b']) test('source anchors preserve a word split by layout: ' + JSON.stringify(layout), () => {
  unavailableInSource('😀王甲收到工资1000元5分' + layout + '钟后离开', '1000元5分', { meaning: 'payment', completeness: 'partial' });
});
test('the next OCR block completes 分钟 without changing the original block offset', () => {
  const source = sourceFor('😀王甲收到工资1000元5分');
  source.blocks.push({ id: 'b2', page: 1, text: '钟后离开', bbox: null, confidence: null });
  const candidate = entry('1000元5分', '1000元5分', { meaning: 'payment', completeness: 'partial' });
  stored(source, candidate, ingest(source, [candidate]), null);
});
for (const [value, amount] of [['1000元5分', '1000.05'], ['1000元5角', '1000.50'], ['1000元5角2分', '1000.52'], ['一千元五分', '1000.05']]) {
  for (const after of ['。', '整', '，分别支付', '，5分钟后离开']) test('genuine cents remain exact: ' + value + after, () => {
    const source = sourceFor('😀王甲收到工资' + value + after);
    const completeValue = after === '整' ? value + after : value;
    const candidate = entry(completeValue, completeValue, { meaning: 'payment', completeness: 'partial' });
    assert.equal(normalizeMoneyValueV4(value).amount, amount);
    stored(source, candidate, ingest(source, [candidate]), amount);
  });
}
for (const tail of ['2024年5月仍未支付', '4个月内付清', '2024年内结清', '4天内付清', '4小时内付清', '四个月内付清']) {
  for (const link of ['至', '到']) test('a date or duration is not a second money endpoint: ' + link + tail, () => {
    const text = '😀王甲拖欠工资3万元' + link + tail, source = sourceFor(text);
    for (const quote of [text, '3万元']) {
      const candidate = entry('3万元', quote, { meaning: 'arrears', completeness: 'not_applicable' });
      assert.equal(normalizeCandidateValueV4(candidate).amount, '30000.00');
      stored(source, candidate, ingest(source, [candidate]), '30000.00');
    }
  });
}
for (const text of ['3万元至4万元', '3万元到四万元', '3万元至人民币4万元', '3万元至RMB4万元', '3万元至40000人民币', '3万元至4万']) test('a supported money endpoint remains a range: ' + text, () => {
  unavailableInSource('😀王甲工资' + text, '3万元');
});
for (const tail of ['5角', '/月', '每天']) test('a bare crop cannot discard traditional yuan and its subunit or rate: ' + tail, () => {
  unavailableInSource('😀王甲工资4000圓' + tail, '4000');
});

for (const tail of ['4', '四', '4个人', '4元旦']) test('an incomplete or non-money non-time endpoint stays uncertain: ' + tail, () => {
  unavailableInSource('😀王甲工资3万元至' + tail, '3万元');
});
test('the ordinary wage noun following complete cents is not the word 分工', () => {
  const source = sourceFor('😀王甲收到1000元5分工资。'), candidate = entry('1000元5分', '1000元5分', { meaning: 'payment', completeness: 'partial' });
  assert.equal(normalizeMoneyValueV4(source.blocks[0].text).amount, '1000.05');
  stored(source, candidate, ingest(source, [candidate]), '1000.05');
});

for (const [whole, crop] of [['1000元5分之一', '1000元5分'], ['一千元五分之二', '一千元五分'], ['1000元5分之K', '1000元5分']]) test('a fractional denominator cannot be cropped into fen: ' + whole, () => {
  unavailableInSource('😀王甲工资为' + whole, crop);
});
for (const [whole, crop] of [['約四千圓', '四千圓'], ['四千圓餘', '四千圓'], ['約人民幣四千圓', '人民幣四千圓']]) test('traditional currency cannot discard an approximation word: ' + whole, () => {
  assert.equal(normalizeMoneyValueV4(whole).amount, null);
  unavailableInSource('😀王甲工资为' + whole, crop);
});
test('a genuine fen amount followed by 之后 is not a fractional denominator', () => {
  const source = sourceFor('😀王甲收到1000元5分之后离开。'), candidate = entry('1000元5分', '1000元5分', { meaning: 'payment', completeness: 'partial' });
  stored(source, candidate, ingest(source, [candidate]), '1000.05');
});
