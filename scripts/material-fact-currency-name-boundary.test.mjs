import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(process.env.MATERIAL_FACT_ROUND17_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const load = file => import(pathToFileURL(resolve(root, 'lib', file)).href);
const { emptyFactState, ingestCandidates } = await load('material-facts-v3.ts');
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest.ts');
const { reviewCandidateAgainstSource } = await load('material-fact-source-review.ts');

function check(text, amount, status, attributes = {}) {
  const source = { id: 'round17-root', name: 'synthetic', sha256: 'b'.repeat(64), analysisRevision: 1, ready: true,
    blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
  const representation = { kind: 'money', value: '四万元', quote: '四万元', blockId: 'b1', subject: '王甲', scope: 'individual',
    meaning: 'arrears', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated', ...attributes };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [representation] });
  const stored = ingestCandidates(emptyFactState(1), source, { raw }, 'synthetic', 'owner', '2026-10-18T00:00:00.000Z');
  const candidate = stored.materials[0].candidates[0];
  candidate.amount = '40000.00';
  candidate.normalization = { rawValue: representation.value, amount: '40000.00', status: 'exact', matchedText: '四万元', span: { start: 0, end: 3 }, reason: 'synthetic historical exact' };
  const snapshot = structuredClone({ source, stored });
  const fresh = ingestRuntimeCandidates(emptyFactState(1), source, { raw }, 'synthetic', 'owner', '2026-10-18T00:00:00.000Z');
  for (const actual of [fresh.materials[0].candidates[0], reviewCandidateAgainstSource(candidate, source)]) {
    assert(actual); assert.equal(actual.amount, amount); assert.equal(actual.normalization.status, status);
    assert.deepEqual(actual.representation, representation);
    assert.equal(actual.value, representation.value); assert.equal(actual.quote, representation.quote);
    assert.equal(Array.from(text).slice(actual.start, actual.end).join(''), representation.quote);
  }
  assert.equal(fresh.materials[0].raw, raw);
  assert.deepEqual({ source, stored }, snapshot);
}

for (const currency of ['港币', '港幣', '美元', 'HKD', 'ＨＫＤ']) {
  for (const text of [`😀王甲的工资以${currency}折合四万元。`, `王甲工资四万元折合${currency}。`, `王甲工资四万元以${currency}折合。`]) {
    test(`attached foreign valuation remains unsupported: ${text}`, () => check(text, null, 'unsupported'));
  }
}
test('format control cannot hide the valuation verb', () => check('王甲工资以港\u200b币折\u200b合四万元。', null, 'unsupported'));
for (const separator of ['，', '。', '\n', '\u2028', '\u2029']) {
  test(`a separate foreign valuation does not invalidate RMB: ${JSON.stringify(separator)}`, () => check(`王甲工资人民币四万元${separator}王乙工资以港币折合三万元。`, '40000.00', 'exact'));
}
test('explicit RMB valuation is supported', () => check('王甲工资以人民币折合四万元。', '40000.00', 'exact'));

for (const subject of ['王一', '李三', '赵十', '王正', '王腊', '王零']) {
  test(`a numeral-ending subject does not supply a calendar month: ${subject}`, () => check(`${subject}月工资四万元。`, null, 'rate_unit_mismatch', { subject }));
  test(`the same subject retains a correct monthly rate: ${subject}`, () => check(`${subject}月工资四万元。`, '40000.00', 'exact', { subject, meaning: 'rate', rateUnit: 'month' }));
  test(`a month after that whole subject is still a wage period: ${subject}`, () => check(`${subject}一月工资四万元。`, '40000.00', 'exact', { subject, period: '一月' }));
}
for (const period of ['2026年1月', '三月', '正月', '腊月']) {
  test(`an actual calendar remains a total: ${period}`, () => check(`王甲${period}工资四万元。`, '40000.00', 'exact', { period }));
}
