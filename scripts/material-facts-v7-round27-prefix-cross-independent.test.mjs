import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(ROOT, path)));
const { normalizeMoneyValueV4: money } = await load('lib/material-money-v4.ts');
const { hasAttachedMoneyArithmetic } = await load('lib/material-fact-arithmetic-review.ts');
const { ingestRuntimeCandidates: fresh } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, buildFactView } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const cp = text => Array.from(text).length;
const sourceFor = texts => ({ id: 'round27-prefix', name: 'synthetic.txt', sha256: '8'.repeat(64), analysisRevision: 27, ready: true,
  blocks: (Array.isArray(texts) ? texts : [texts]).map((text, index) => ({ id: 'b' + (index + 1), page: 1, text, bbox: null, confidence: null })) });
const candidate = (source, quote) => ({ kind: 'money', value: '4000元', quote, blockId: source.blocks.find(block => block.text.includes('4000元')).id,
  subject: '王甲', scope: 'individual', meaning: 'other_money', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' });
function ingest(source, item, old) {
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [item] });
  const state = (old ? legacy : fresh)(emptyFactState(27), source, { raw }, 'independent', 'synthetic', '2026-10-18T21:30:00.000Z', null);
  assert.equal(state.materials[0].raw, raw);
  assert.equal(state.calculation, null); assert.deepEqual(state.confirmations, { due: null, paid: null });
  assert.equal(buildFactView(state, [source]).canCalculate, false);
  return state;
}
function fact(source, item, state) {
  assert.equal(state.materials[0].candidates.length, 1);
  const result = state.materials[0].candidates[0], text = source.blocks.find(block => block.id === item.blockId).text;
  const at = text.indexOf(item.quote); assert(at >= 0); assert.equal(text.indexOf(item.quote, at + 1), -1);
  assert.deepEqual(result.representation, item);
  assert.equal(result.start, cp(text.slice(0, at))); assert.equal(result.end, result.start + cp(item.quote));
  return result;
}
function observed(source) {
  const block = source.blocks.find(item => item.text.includes('4000元')), rows = [];
  for (const quote of [block.text, '4000元']) {
    const item = candidate(source, quote), current = fact(source, item, ingest(source, item, false));
    const historical = [];
    for (const [status, amount] of [['exact', '4000.00'], ['unsupported', null]]) {
      const stored = ingest(source, item, true), previous = fact(source, item, stored);
      previous.amount = amount;
      previous.normalization = { rawValue: item.value, status, amount, matchedText: item.value, span: { start: 0, end: cp(item.value) }, reason: 'Synthetic unconfirmed stored value.' };
      const before = structuredClone(stored), reviewed = reviewFactsAgainstSources(stored, [source]);
      assert.deepEqual(stored, before); assert.equal(reviewed.materials[0].raw, stored.materials[0].raw);
      historical.push(fact(source, item, reviewed).amount);
    }
    rows.push({ fresh: current.amount, storedExact: historical[0], storedUnavailable: historical[1] });
  }
  return rows;
}
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-source-review.ts', 'lib/material-fact-arithmetic-review.ts'])
  console.log(JSON.stringify({ evidence: 'round27_prefix_implementation', path, sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));

for (const prefix of ['奖金乘以', '加班费加上', '提成除以'])
  test('a complete named-pay prefix operation cannot expose the following amount: ' + prefix, () => {
    const rows = [];
    for (const layout of ['same', 'newline', 'block']) {
      const source = sourceFor(layout === 'block' ? ['😀王甲工资' + prefix, '4000元。'] : '😀王甲工资' + prefix + (layout === 'newline' ? '\n' : '') + '4000元。');
      rows.push({ layout, observed: observed(source) });
    }
    console.log(JSON.stringify({ evidence: 'prefix_pay_operation', prefix, whole: money(prefix + '4000元'), rows }));
    // Assert actual pipelines as well as the lexical helper. A failure of the
    // helper alone is not evidence that a usable money value escaped.
    for (const row of rows) for (const item of row.observed) assert.deepEqual(item, { fresh: null, storedExact: null, storedUnavailable: null });
    assert.equal(money(prefix + '4000元').amount, null);
    assert.equal(hasAttachedMoneyArithmetic(prefix, ''), true);
  });

test('the existing plus-sign path continues to block a named-pay sum', () => {
  assert.equal(money('奖金+4000元').amount, null);
  for (const row of observed(sourceFor('😀王甲工资奖金+4000元。')))
    assert.deepEqual(row, { fresh: null, storedExact: null, storedUnavailable: null });
});

test('a complete independent payment is not an operand of another payment clause', () => {
  for (const text of ['😀王甲工资4000元。王乙奖金另付。', '😀王甲奖金另付；王甲工资4000元。']) {
    for (const row of observed(sourceFor(text))) assert.deepEqual(row, { fresh: '4000.00', storedExact: '4000.00', storedUnavailable: null });
  }
});
