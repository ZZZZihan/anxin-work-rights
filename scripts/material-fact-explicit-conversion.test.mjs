// Author-only synthetic source/currency checks. No model, rates or FX math.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OWN = fileURLToPath(new URL('../', import.meta.url));
const SOURCE = resolve(process.env.MATERIAL_FACT_TEST_ROOT || OWN);
const CURRENCY_ROOT = resolve(process.env.MATERIAL_FACT_CURRENCY_ROOT || OWN);
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-explicit-rmb-conversion-'));
after(() => rm(temporary, { recursive: true, force: true }));
if (process.env.MATERIAL_FACT_TEST_REVISION) {
  const archive = execFileSync('git', ['archive', '--format=tar', process.env.MATERIAL_FACT_TEST_REVISION, 'lib'], { cwd: SOURCE, maxBuffer: 30 * 1024 * 1024 });
  execFileSync('tar', ['-xf', '-', '-C', temporary], { input: archive });
} else await cp(resolve(SOURCE, 'lib'), resolve(temporary, 'lib'), { recursive: true });
await cp(resolve(CURRENCY_ROOT, 'lib/material-fact-currency-review.ts'), resolve(temporary, 'lib/material-fact-currency-review.ts'));
const load = file => import(pathToFileURL(resolve(temporary, 'lib', file)).href);
const { sourceMoneyHasUnsupportedCurrency, monetaryExpressionHasUnsupportedCurrency } = await load('material-fact-currency-review.ts');
const { normalizeMoneyValueV4, normalizeCandidateValueV4 } = await load('material-money-v4.ts');
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates } = await load('material-facts-v3.ts');
const { reviewCandidateAgainstSource, reviewFactsAgainstSources } = await load('material-fact-source-review.ts');
const AT = '2026-10-18T00:00:00.000Z';

function check(text, value, style, amount, oldAmount = '4000.00') {
  const source = { id: 'synthetic-explicit-rmb-conversion', name: '合成明确折算结果（不计算汇率）', sha256: 'e'.repeat(64), analysisRevision: 1, ready: true,
    blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
  const representation = { kind: 'money', value, quote: style === 'full' ? text : value, blockId: 'b1', subject: '王甲', scope: 'individual',
    meaning: 'payment', completeness: 'unknown', period: null, rateUnit: null, assertion: 'narrated' };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [representation] });
  const immutable = candidate => {
    assert.equal(candidate.value, value); assert.equal(candidate.quote, representation.quote);
    assert.deepEqual(candidate.representation, representation); assert.equal(candidate.sourceSha256, source.sha256);
    const start = Array.from(text.slice(0, text.indexOf(representation.quote))).length;
    assert.equal(candidate.start, start); assert.equal(candidate.end, start + Array.from(representation.quote).length);
    assert.equal(Array.from(text).slice(candidate.start, candidate.end).join(''), representation.quote);
  };
  const fresh = ingestRuntimeCandidates(emptyFactState(1), source, { raw }, 'synthetic', 'synthetic-author', AT);
  assert.equal(fresh.materials[0].raw, raw); assert.equal(fresh.materials[0].candidates.length, 1); assert.equal(fresh.materials[0].rejected.length, 0);
  const candidate = fresh.materials[0].candidates[0];
  assert.equal(candidate.amount, amount, `fresh ${JSON.stringify({ text, value, style })}`); immutable(candidate);
  assert.deepEqual(fresh.confirmations, emptyFactState(1).confirmations); assert.equal(fresh.calculation, null);

  const stored = ingestCandidates(emptyFactState(1), source, { raw }, 'synthetic', 'synthetic-author', AT);
  const old = stored.materials[0].candidates[0]; assert(old);
  old.amount = oldAmount; old.normalization = { rawValue: value, amount: oldAmount, status: 'exact', matchedText: value, span: { start: 0, end: Array.from(value).length }, reason: 'Synthetic old exact; no FX computation' };
  const snapshot = structuredClone({ source, stored });
  const reviewed = reviewCandidateAgainstSource(old, source);
  assert.equal(reviewed.amount, amount, 'forced historical exact'); immutable(reviewed);
  const view = reviewFactsAgainstSources(stored, [source]);
  assert.equal(view.materials[0].candidates[0].amount, amount); assert.equal(view.materials[0].raw, raw); assert.deepEqual(view.history, stored.history);
  assert.deepEqual({ source, stored }, snapshot);

  old.amount = null; old.normalization = { rawValue: value, amount: null, status: 'unsupported', matchedText: null, span: null, reason: 'Synthetic unavailable history' };
  const unavailableBefore = structuredClone(stored);
  const unavailable = reviewFactsAgainstSources(stored, [source]);
  assert.equal(unavailable.materials[0].candidates[0].amount, null, 'No unavailable historical value may be automatically upgraded.');
  assert.equal(unavailable.materials[0].raw, raw); assert.deepEqual(stored, unavailableBefore);
}

const positive = [
  ['😀王甲工资美元折合人民币4000元。', '4000元'],
  ['😀王甲工资美元折算为人民币4000元。', '4000元'],
  ['😀王甲工资港幣折算為人民幣四千圓。', '四千圓'],
  ['😀王甲工资USD折合RMB4000元。', '4000元'],
  ['😀王甲工资ＵＳＤ 折算为 ＲＭＢ 4000元。', '4000元'],
  ['😀王甲工资美\u200d元折\u2060合人\u200b民币4000元。', '4000元'],
  ['😀王甲工资美元（折合）人民币4000元。', '4000元'],
  ['😀王甲工资美元折合人民币4000元。', '人民币4000元'],
  ['😀王甲工资美元折合￥4000元。', '￥4000元'],
  ['😀王甲工资美元折算为人民币4000元。', '4000'],
  ['😀王甲工资500美元折合人民币4000元。', '4000元'],
  ['😀王甲工资美元折合4000人民币。', '4000人民币'],
  ['😀王甲工资美元折合4000人民币。', '4000'],
];
for (const [text, value] of positive) {
  test(`anchored explicit RMB result ${JSON.stringify({ text, value })}`, () => {
    const n = normalizeMoneyValueV4(value); assert.equal(n.amount, '4000.00');
    const anchor = { blockText: text, valueStart: text.indexOf(value) }, before = structuredClone({ anchor, n });
    assert.equal(sourceMoneyHasUnsupportedCurrency(anchor, n, '王甲'), false); assert.deepEqual({ anchor, n }, before);
  });
  for (const style of ['full', 'crop']) test(`fresh/read/raw/CP explicit result (${style}) ${JSON.stringify({ text, value })}`, () => check(text, value, style, '4000.00'));
}

const negative = [
  ['😀王甲工资美元人民币4000元。', '4000元'],
  ['😀王甲工资美元计价人民币4000元。', '4000元'],
  ['😀王甲工资美元折算人民币4000元。', '4000元'],
  ['😀王甲工资美元折合4000元。', '4000元'],
  ['😀王甲工资美元折算为4000元。', '4000元'],
  ['😀王甲工资人民币折算为美元4000元。', '4000元'],
  ['😀王甲工资美元折合人民币4000元港币。', '4000元'],
  ['😀王甲工资美元折合人民币4000元工资以港币计价。', '4000元'],
  ['😀王甲工资美元港币折合人民币4000元。', '4000元'],
  ['😀王甲工资$美元折合人民币4000元。', '4000元'],
  ['😀王甲工资美元人民币折合人民币4000元。', '4000元'],
  ['😀王甲工资500美元折合人民币4000元。', '500'],
  ['😀王甲工资美元4000元，王乙工资折合人民币5000元。', '4000元'],
  ['😀王甲工资美元4000元\n折合人民币5000元。', '4000元'],
  ['😀王甲工资美元4000元。折合人民币5000元。', '4000元'],
];
for (const [text, value] of negative) for (const style of ['full', 'crop'])
  test(`RMB mention cannot wash a conflicting/source currency (${style}) ${JSON.stringify({ text, value })}`, () => check(text, value, style, null, value === '500' ? '500.00' : '4000.00'));

for (const separator of ['，', '。', '；', '\n', '\r\n', '\u2028', '\u2029']) for (const style of ['full', 'crop']) {
  test(`another event remains separate (${style}) ${JSON.stringify(separator)}`, () => check(`😀王乙以美元计500元${separator}王甲工资人民币4000元。`, '4000元', style, '4000.00'));
  test(`split conversion does not erase a same-line foreign marker (${style}) ${JSON.stringify(separator)}`, () => check(`😀王乙折合${separator}王甲工资美元人民币4000元。`, '4000元', style, null));
}
for (const value of ['美元折合人民币4000元', '美元人民币4000元', '人民币4000元港币']) test(`full foreign literal stays conservative: ${value}`, () => {
  assert.equal(monetaryExpressionHasUnsupportedCurrency(value), true); assert.equal(normalizeMoneyValueV4(value).amount, null);
});
for (const style of ['full', 'crop']) for (const text of ['😀王甲工资人民币4000元。', '😀王甲工资4000元。', '😀王甲工资美元换成人民币4000元。'])
  test(`existing RMB conversion/ordinary controls (${style}) ${text}`, () => check(text, '4000元', style, '4000.00'));

test('candidate full quote and source anchor keep the same explicit RMB target', () => {
  const raw = { kind: 'money', value: '4000元', quote: '😀王甲工资美元折合人民币4000元。', blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'payment', completeness: 'unknown', period: null, rateUnit: null, assertion: 'narrated' };
  const before = structuredClone(raw); assert.equal(normalizeCandidateValueV4(raw).amount, '4000.00'); assert.deepEqual(raw, before);
});
