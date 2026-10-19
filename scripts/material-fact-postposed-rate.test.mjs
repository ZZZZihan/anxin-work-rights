import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(process.env.MATERIAL_FACT_ROUND19_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const load = file => import(pathToFileURL(resolve(root, 'lib', file)).href);
const { emptyFactState, ingestCandidates } = await load('material-facts-v3.ts');
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest.ts');
const { reviewCandidateAgainstSource } = await load('material-fact-source-review.ts');

function check(text, amount, status, attributes = {}) {
  const source = { id: 'round19-root', name: 'synthetic', sha256: 'b'.repeat(64), analysisRevision: 1, ready: true,
    blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] };
  const representation = { kind: 'money', value: '40000元', quote: '40000元', blockId: 'b1', subject: '王甲', scope: 'individual',
    meaning: 'arrears', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated', ...attributes };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [representation] });
  const stored = ingestCandidates(emptyFactState(1), source, { raw }, 'synthetic', 'owner', '2026-10-18T00:00:00.000Z');
  const candidate = stored.materials[0].candidates[0];
  candidate.amount = '40000.00';
  candidate.normalization = { rawValue: representation.value, amount: '40000.00', status: 'exact', matchedText: '40000元', span: { start: 0, end: 6 }, reason: 'synthetic historical exact' };
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

const labels = [['按月','month'],['按日','day'],['按天','day'],['按小时','hour'],['按时','hour'],['按件','piece'],['按小時','hour'],['按時','hour']];
for (const [label, unit] of labels) {
 for (const tail of ['', '计', '計', '标准为']) {
  const text = `😀王甲工資${label}${tail}40000元。`;
  test(`postposed rate cannot be total ${label}${tail}`,()=>check(text,null,'rate_unit_mismatch',{meaning:'due_total',completeness:'complete'}));
  test(`postposed supported rate ${label}${tail}`,()=>check(text,'40000.00','exact',{meaning:'rate',rateUnit:unit}));
 }
 test(`postposed wrong declared unit ${label}`,()=>check(`王甲工资${label}40000元。`,null,'rate_unit_mismatch',{meaning:'rate',rateUnit:unit==='month'?'day':'month'}));
}
test('postposed rate horizontal spacing and control',()=>check('王甲工 資按\u200b小 時 計40000元。',null,'rate_unit_mismatch'));
for (const period of ['2026年1月','上月','今日']) {
 test(`calendar wages retain amount ${period}`,()=>check(`王甲${period}工资40000元。`,'40000.00','exact',{period}));
}
for (const separator of ['，','。','；','\n','\u2028','\u2029']) {
 test(`rate from separate event not transferred ${JSON.stringify(separator)}`,()=>check(`王乙工资按月5000元${separator}王甲工资40000元。`,'40000.00','exact'));
 test(`bare prefix cannot cross event ${JSON.stringify(separator)}`,()=>check(`王乙工资按月${separator}王甲工资40000元。`,'40000.00','exact'));
}
