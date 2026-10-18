import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(process.env.V7_REVIEW_ROOT ?? fileURLToPath(new URL('..', import.meta.url)));
const load = name => import(pathToFileURL(resolve(root, 'lib', name + '.ts')));
const { normalizeMoneyValueV4, normalizeCandidateValueV4 } = await load('material-money-v4');
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest');
const { emptyFactState, buildFactView } = await load('material-facts-v3');
const { reviewFactsAgainstSources } = await load('material-fact-source-review');
const { hasAttachedMoneyArithmetic } = await load('material-fact-arithmetic-review');
const candidate = quote => ({ kind: 'money', value: '四万元', quote, blockId: 'b1', subject: '王甲',
  scope: 'individual', meaning: 'due_total', completeness: 'complete', period: null, rateUnit: null, assertion: 'narrated' });
const sourceFor = blocks => ({ id: 'proportion-root', name: '合成比例算式.txt', sha256: 'e'.repeat(64),
  analysisRevision: 15, ready: true, blocks: blocks.map((text, i) => ({ id: `b${i + 1}`, text, page: 1, bbox: null, confidence: null })) });
function checkSource(blocks, expected) {
  const source = sourceFor(blocks), rawCandidate = candidate('四万元');
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [rawCandidate] });
  const state = ingestRuntimeCandidates(emptyFactState(15), source, { raw }, 'root-probe', 'synthetic', '2026-10-18T08:40:00Z', null);
  const fact = state.materials[0].candidates[0];
  assert(fact, 'Keep the ambiguous monetary candidate available for human review.');
  assert.equal(fact.amount, expected);
  assert.deepEqual(fact.representation, rawCandidate);
  assert.equal(state.materials[0].raw, raw);
  assert.equal(fact.start, Array.from(blocks[0].slice(0, blocks[0].indexOf('四万元'))).length);
  assert.equal(buildFactView(state, [source]).canCalculate, false);
  assert.deepEqual(state.confirmations, { due: null, paid: null });
  assert.equal(state.calculation, null);
  const history = structuredClone(state);
  const historical = history.materials[0].candidates[0];
  historical.amount = '40000.00';
  historical.normalization = normalizeMoneyValueV4('四万元');
  const snapshot = structuredClone(history), reviewed = reviewFactsAgainstSources(history, [source]);
  assert.equal(reviewed.materials[0].candidates[0].amount, expected);
  assert.equal(reviewed.materials[0].raw, raw);
  assert.deepEqual(history, snapshot, 'Reading history must not rewrite the original record.');
}
const expressions = ['四万元的八成', '四万元的八折', '四万元打八折', '四万元的8.5成',
  '四万元的八成五', '四万元的五成半', '四万元打八五折', '四万元打对折', '四万元打對折',
  '四万元工资的八成', '四万元基本工资打八折', '四万元工资八成', '四万元的半成',
  '四万元的八\n成', '四万元打\n八折', '四万元的８．５成', '四万元的八\u200b折',
  '八成的四万元', '八折的四万元', '八成×四万元', '八成五的四万元', '八成半的四万元', '对折的四万元'];
for (const expression of expressions) {
  test('whole expression remains non-exact: ' + JSON.stringify(expression), () => {
    assert.equal(normalizeMoneyValueV4(expression).amount, null);
  });
  test('full quote and cropped source preserve the proportional operation: ' + JSON.stringify(expression), () => {
    const text = '😀王甲应付工资为' + expression + '。';
    assert.equal(normalizeCandidateValueV4(candidate(text)).amount, null);
    checkSource([text], null);
  });
}
for (const tail of ['的八成', '打八折', '工资的八成', '的八\n折', '打\n八折'])
  test('explicit proportion continues across adjacent blocks: ' + JSON.stringify(tail), () => checkSource(['😀王甲工资四万元', tail], null));
for (const text of ['😀王甲工资四万元。王乙奖金打八折。', '😀王甲工资四万元，另一笔款项打八折。',
  '😀王甲八成已经收到工资四万元。', '😀王甲工资打八折后合计四万元。', '😀王甲折合人民币四万元。',
  '😀王甲工资四万元的支付日期待定。', '😀王甲工资四万元成就了梦想。', '😀王甲工资四万元，八成已经发放。'])
  test('ordinary prose and independently stated results stay precise: ' + text, () => checkSource([text], '40000.00'));
test('a bare proportion in a separate row cannot attach as an operation', () => {
  assert.equal(hasAttachedMoneyArithmetic('', '\n八成已发放'), false);
  assert.equal(hasAttachedMoneyArithmetic('', '。打八折'), false);
  assert.equal(hasAttachedMoneyArithmetic('八成的工资合计', ''), false);
});
