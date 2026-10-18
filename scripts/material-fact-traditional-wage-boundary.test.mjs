import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(process.env.MATERIAL_FACT_ROUND18_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const load = file => import(pathToFileURL(resolve(root, 'lib', file)).href);
const { emptyFactState, ingestCandidates } = await load('material-facts-v3.ts');
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest.ts');
const { reviewCandidateAgainstSource } = await load('material-fact-source-review.ts');

function check(text, amount, status, attributes = {}) {
  const source = { id: 'round18-root', name: 'synthetic', sha256: 'b'.repeat(64), analysisRevision: 1, ready: true,
    blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
  const representation = { kind: 'money', value: '40000圓', quote: '40000圓', blockId: 'b1', subject: '王甲', scope: 'individual',
    meaning: 'arrears', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated', ...attributes };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [representation] });
  const stored = ingestCandidates(emptyFactState(1), source, { raw }, 'synthetic', 'owner', '2026-10-18T00:00:00.000Z');
  const candidate = stored.materials[0].candidates[0];
  candidate.amount = '40000.00';
  candidate.normalization = { rawValue: representation.value, amount: '40000.00', status: 'exact', matchedText: '40000圓', span: { start: 0, end: 6 }, reason: 'synthetic historical exact' };
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

const nouns = ['工資', '基本工資', '薪資', '勞動報酬', '報酬', '計價', '計付', '計發', '計薪', '計酬', '發放', '結算', '標準', '約定', '合計', '金額'];
for (const noun of nouns) {
  test(`traditional foreign prefix ${noun}`, () => check(`王甲港幣${noun}40000圓。`, null, 'unsupported'));
  test(`traditional foreign suffix ${noun}`, () => check(`王甲40000圓${noun}為港幣。`, null, 'unsupported'));
}
for (const [label, unit] of [['月工資','month'],['每月工資','month'],['月薪標準','month'],['日工資','day'],['每日工資','day'],['日薪標準','day'],['小時工資','hour'],['每小時工資','hour'],['時薪標準','hour'],['計件單價','piece'],['計件工資','piece']]) {
  test(`traditional rate not total ${label}`, () => check(`王甲${label}40000圓。`, null, 'rate_unit_mismatch'));
  test(`traditional correct rate ${label}`, () => check(`王甲${label}40000圓。`, '40000.00', 'exact', {meaning:'rate',rateUnit:unit}));
}
for (const [period, subject] of [['2026年1月','王甲'],['上月','王甲'],['今日','王甲'],['一月','王一']]) {
 test(`traditional actual period ${subject}${period}`, () => check(`${subject}${period}工資40000圓。`, '40000.00','exact',{subject,period}));
}
test('traditional numeral-ending subject rate', () => check('王一月工資40000圓。',null,'rate_unit_mismatch',{subject:'王一'}));
for (const separator of ['，','。','\n','\u2028','\u2029']) {
 test(`traditional separate foreign event ${JSON.stringify(separator)}`,()=>check(`王甲工資人民幣40000圓${separator}王乙港幣工資3000圓。`,'40000.00','exact'));
}
test('traditional controls and horizontal spaces',()=>check('😀王甲港\u200b幣工 資40000圓。',null,'unsupported'));
