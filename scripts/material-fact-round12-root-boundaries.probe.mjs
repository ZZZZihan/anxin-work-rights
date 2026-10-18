import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Read-only synthetic probes of another implementer's subunit/range/rate work.
// V7_REVIEW_ROOT may point to a captured code copy. No live services or data.
const ROOT = resolve(process.env.V7_REVIEW_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const load = file => import(pathToFileURL(resolve(ROOT, file)).href);
const { normalizeMoneyValueV4: money, normalizeCandidateValueV4: normalize } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const cp = value => Array.from(value).length;
for (const file of ['lib/material-money-v4.ts', 'lib/material-fact-currency-review.ts', 'lib/material-fact-source-review.ts', 'lib/material-fact-arithmetic-review.ts', 'lib/material-fact-range-review.ts'])
  console.log(JSON.stringify({ file, sha256: createHash('sha256').update(await readFile(resolve(ROOT, file))).digest('hex') }));

function fixture(expression, value, changes = {}, next = null) {
  const source = { id: 'round12-root-boundaries', name: '合成边界复核', sha256: 'c'.repeat(64), analysisRevision: 12, ready: true,
    blocks: [{ id: 'b1', page: 1, text: `😀王甲工资为${expression}`, bbox: null, confidence: null }] };
  if (next !== null) source.blocks.push({ id: 'b2', page: 1, text: next, bbox: null, confidence: null });
  const candidate = { kind: 'money', value, quote: value, blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'arrears',
    completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated', ...changes };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [candidate] });
  return { source, candidate, raw };
}
function stateFor(f, old = false) {
  const state = (old ? ingestCandidates : ingestRuntimeCandidates)(emptyFactState(12), f.source, { raw: f.raw }, 'read-only-review', 'synthetic', '2026-10-18T00:00:00Z');
  assert.equal(state.materials[0].raw, f.raw);
  assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
  assert.equal(state.materials[0].candidates.length, 1);
  const actual = state.materials[0].candidates[0];
  assert.deepEqual(actual.representation, f.candidate);
  const offset = f.source.blocks[0].text.indexOf(f.candidate.quote);
  assert.equal(actual.start, cp(f.source.blocks[0].text.slice(0, offset)));
  assert.equal(actual.end, actual.start + cp(f.candidate.quote));
  return state;
}
function assertSource(f, expected) {
  assert.equal(stateFor(f).materials[0].candidates[0].amount, expected, 'fresh full-source defense');
  assertHistory(f, expected);
}
function assertHistory(f, expected) {
  const old = stateFor(f, true), stored = old.materials[0].candidates[0];
  const normalization = money(f.candidate.value);
  Object.assign(stored, { amount: normalization.amount ?? '1000.05', normalization });
  const before = structuredClone(old), reviewed = reviewFactsAgainstSources(old, [f.source]);
  assert.equal(reviewed.materials[0].candidates[0].amount, expected, 'forced precise history read-time defense');
  assert.deepEqual(old, before, 'review must not mutate history'); assert.equal(reviewed.materials[0].raw, f.raw);
}

for (const join of ['', ' ', '\t', '\n', '\r\n', '\u2028', '\u2029', '\u200d', '\u2060', '\u00a0'])
  test(`minute word cannot lend a fen unit through layout ${JSON.stringify(join)}`, () => {
    const expression = `1000元5分${join}钟后离开`, f = fixture(expression, '1000元5分');
    assert.equal(money(expression).amount, null);
    assert.equal(normalize({ ...f.candidate, quote: f.source.blocks[0].text }).amount, null);
    assertSource(f, null);
  });
for (const ending of ['钟后离开', '鐘后离开', '\n钟后离开', '\u200b钟后离开'])
  test(`OCR next block completes a minute word: ${JSON.stringify(ending)}`, () => assertSource(fixture('1000元5分', '1000元5分', {}, ending), null));
for (const [value, expected] of [['5元5角', '5.50'], ['5元5角2分', '5.52'], ['一千元五分', '1000.05'],
  ['一千元五角二分', '1000.52'], ['5圓5角2分', '5.52'], ['人民幣一千圓五分', '1000.05']])
  for (const ending of ['工资。', '之后支付。', '。钟某另案处理。']) test(`genuine cents survive an ordinary following clause: ${value + ending}`, () => {
    assert.equal(money(value).amount, expected); assertSource(fixture(value + ending, value), expected);
  });
for (const ending of ['。钟某另案处理', '，钟某另案处理', '；钟某另案处理'])
  test(`a visible separator protects a genuine cent amount before a next OCR event: ${ending}`, () => assertSource(fixture('1000元5分', '1000元5分', {}, ending), '1000.05'));

for (const tail of ['2024年5月仍未支付', '4个月内付清', '四个月内付清', '４个月内付清', '2024-05-01仍未支付',
  '2024/05/01仍未支付', '4小时内付清', '5分钟后支付', '四天内付清'])
  for (const link of ['至', '到']) test(`a genuine date/duration does not become a monetary range: ${link + tail}`, () => {
    const f = fixture('3万元' + link + tail, '3万元');
    assert.equal(normalize({ ...f.candidate, quote: f.source.blocks[0].text }).amount, '30000.00');
    assertSource(f, '30000.00');
  });
for (const tail of ['4', '四', '４', '4个人', '4元旦', '4元年', '4角', '4分米', '人民币4', 'RMB4'])
  test(`an unfinished or non-money endpoint must not become precise: 至${tail}`, () => {
    const f = fixture('3万元至' + tail, '3万元');
    assert.equal(normalize({ ...f.candidate, quote: f.source.blocks[0].text }).amount, null); assertSource(f, null);
  });
for (const expression of ['3万元至4万元', '人民幣3万元至人民幣4万元', '3万元至RMB4万元', '3万元至4万', '3万元至40000人民币'])
  test(`real range does not expose its first endpoint: ${expression}`, () => {
    const f = fixture(expression, '3万元'); assert.equal(money(expression).amount, null); assertSource(f, null);
  });
for (const tail of ['/月', '/日', '每天', '\u200d/\u200d月', '／月'])
  for (const value of ['4000', '4000圓']) test(`traditional yuan does not hide a rate behind cropped value: ${value}/${JSON.stringify(tail)}`, () => assertSource(fixture('4000圓' + tail, value), null));
test('a fully declared traditional-yuan rate remains exact', () => {
  const f = fixture('4000圓/月', '4000圓/月', { meaning: 'rate', rateUnit: 'month' });
  assert.equal(normalize({ ...f.candidate, quote: f.source.blocks[0].text }).amount, '4000.00'); assertSource(f, '4000.00');
});

for (const [expression, value] of [['1000元5分之一', '1000元5分'], ['一千元五分之一', '一千元五分'],
  ['1000元5分之2', '1000元5分'], ['1000元5分之K', '1000元5分'], ['一千元五分之factor', '一千元五分'],
  ['一千元五分之α', '一千元五分'], ['一千元五分之', '一千元五分']]) {
  test(`fraction word cannot be swallowed into a fen token in a full value: ${expression}`, () => assert.equal(money(expression).amount, null));
  test(`fraction word cannot be swallowed into a fen token in a full quote: ${expression}`, () => {
    const f = fixture(expression, value); assert.equal(normalize({ ...f.candidate, quote: f.source.blocks[0].text }).amount, null);
  });
  test(`fraction word cannot be swallowed into a fen token through source/history: ${expression}`, () => assertSource(fixture(expression, value), null));
  test(`fraction word cannot keep a previously persisted exact cent amount: ${expression}`, () => assertHistory(fixture(expression, value), null));
}
