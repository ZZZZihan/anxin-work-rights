import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Five concrete post-d963 review findings. Synthetic module/runtime/source
// checks only: no service, scorer, frozen verifier, model or confirmation.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(ROOT, path)));
const { normalizeMoneyValueV4: money } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates: fresh } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, validateCandidateOutput } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const { hasSupportedCandidateAttribution: attributed } = await load('lib/material-fact-event-review.ts');
const cp = text => Array.from(text).length;
const sourceFor = texts => ({ id: 'round38-independent', name: 'synthetic.txt', sha256: '8'.repeat(64), ready: true,
  analysisRevision: 38, blocks: (Array.isArray(texts) ? texts : [texts]).map((text, i) =>
    ({ id: 'b' + (i + 1), page: 1, text, bbox: null, confidence: null })) });
const entry = (value, quote = value, extra = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual',
  meaning: 'other_money', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated', ...extra });
function stateFor(source, candidates, historical = false) {
  const raw = JSON.stringify({ schemaVersion: 3, candidates }), before = structuredClone(source);
  // The archived batch validator already deduplicates entries. Validate each
  // original representation separately so that its old batch deduplication is
  // not mistaken for a schema error in this production-adapter regression.
  for (const candidate of candidates)
    assert.equal(validateCandidateOutput(JSON.stringify({ schemaVersion: 3, candidates: [candidate] }), source).rejected.length, 0,
      'Every original candidate must satisfy the real input schema.');
  const state = (historical ? legacy : fresh)(emptyFactState(38), source, { raw }, 'independent', 'synthetic', '2026-10-19T03:00:00.000Z', null);
  assert.deepEqual(source, before); assert.equal(state.materials[0].raw, raw);
  assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
  return state;
}
function factFor(source, candidate, state) {
  assert.equal(state.materials[0].candidates.length, 1, 'Acceptance and a usable precise amount are different contracts.');
  const fact = state.materials[0].candidates[0], text = source.blocks.find(b => b.id === candidate.blockId).text;
  const at = text.indexOf(candidate.quote); assert(at >= 0); assert.equal(text.indexOf(candidate.quote, at + 1), -1);
  assert.deepEqual(fact.representation, candidate); assert.equal(fact.start, cp(text.slice(0, at)));
  assert.equal(fact.end, fact.start + cp(candidate.quote)); return fact;
}
function historical(source, candidate, amount) {
  const state = stateFor(source, [candidate], true), fact = factFor(source, candidate, state);
  fact.amount = amount; fact.normalization = { rawValue: candidate.value, status: amount === null ? 'unsupported' : 'exact', amount,
    matchedText: candidate.value, span: { start: 0, end: cp(candidate.value) }, reason: 'Unconfirmed stored synthetic extraction.' };
  const before = structuredClone(state), reviewed = reviewFactsAgainstSources(state, [source]);
  assert.deepEqual(state, before); assert.equal(reviewed.materials[0].raw, state.materials[0].raw);
  assert.deepEqual(reviewed.confirmations, { due: null, paid: null }); assert.equal(reviewed.calculation, null);
  return factFor(source, candidate, reviewed);
}
function checkMoney(text, value, wanted, extra = {}) {
  const source = sourceFor(text), rows = [];
  for (const quote of [value, text]) {
    const candidate = entry(value, quote, extra);
    rows.push({ source, candidate, fresh: factFor(source, candidate, stateFor(source, [candidate])),
      oldExact: historical(source, candidate, '4000.00'), oldNull: historical(source, candidate, null) });
  }
  for (const row of rows) console.log(JSON.stringify({ evidence: 'round38_money', ...row }));
  for (const row of rows) {
    assert.equal(row.fresh.amount, wanted); assert.equal(row.oldExact.amount, wanted);
    assert.equal(row.oldNull.amount, null, 'Read-only review must not upgrade a stored unavailable amount.');
  }
}
function checkDate(text, value, wanted, extra = {}) {
  const source = sourceFor(text), rows = [];
  for (const quote of [value, text]) {
    const candidate = entry(value, quote, { kind: 'date', meaning: 'payment_date', ...extra });
    const normalization = { rawValue: value, status: 'exact', amount: null, matchedText: value,
      span: { start: 0, end: cp(value) }, reason: 'Payment schedule only, not actual receipt.' };
    const fact = factFor(source, candidate, stateFor(source, [candidate]));
    const old = reviewFactsAgainstSources(stateFor(source, [candidate], true), [source]);
    rows.push({ source, candidate, direct: attributed(candidate, text, normalization), fact, old: factFor(source, candidate, old) });
  }
  for (const row of rows) console.log(JSON.stringify({ evidence: 'round38_schedule', ...row }));
  for (const row of rows) {
    assert.equal(row.direct, wanted);
    for (const fact of [row.fact, row.old]) {
      assert.equal(fact.amount, null);
      assert.equal(fact.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), !wanted);
    }
  }
}
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-range-review.ts', 'lib/material-fact-arithmetic-review.ts',
  'lib/material-fact-event-review.ts', 'lib/material-fact-runtime-ingest.ts', 'lib/material-fact-source-review.ts'])
  console.log(JSON.stringify({ evidence: 'round38_implementation', path,
    sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));

for (const bound of ['高达', '高達', '低至']) {
  test('an explicit bounded literal cannot become a precise amount: ' + bound, () => {
    const observed = money(bound + '4000元'); console.log(JSON.stringify({ evidence: 'round38_literal_bound', bound, observed }));
    assert.equal(observed.amount, null); assert.notEqual(observed.status, 'exact');
  });
  test('full and minimal quotes retain the attached boundary and raw positions: ' + bound, () => {
    checkMoney('😀王甲工资' + bound + '4000元。', '4000元', null);
  });
}
test('an explicit numeric doubling instruction is not its base literal', () => {
  const observed = money('4000元翻一倍'); console.log(JSON.stringify({ evidence: 'round38_literal_doubling', observed }));
  assert.equal(observed.amount, null); assert.notEqual(observed.status, 'exact');
});
test('source review rejects a cropped numeric doubling and never upgrades stored null', () => {
  checkMoney('😀王甲工资4000元翻一倍。', '4000元', null);
});
test('the finite recurring 发薪 layout identifies a schedule without asserting receipt', () => {
  checkDate('😀王甲工资每月15日发薪', '每月15日', true);
});
test('recurring 发薪 cannot absorb negation, another recipient or an invalid day', () => {
  checkDate('😀王甲工资每月15日不发薪', '每月15日', false);
  checkDate('😀王甲工资每月15日发薪给李乙', '每月15日', false);
  checkDate('😀王甲工资每月32日发薪', '每月32日', false);
});
test('the existing 发放 schedule stays supported only for its date role', () => {
  checkDate('😀王甲工资每月15日发放', '每月15日', true);
  checkDate('😀王甲工资每月15日发放', '每月15日', false, { meaning: 'employment_period' });
});
for (const value of ['￥4000￥', '人民币4000￥', '4000元￥']) test('repeated currency markers do not define a precise amount: ' + value, () => {
  const observed = money(value); console.log(JSON.stringify({ evidence: 'round38_duplicate_marker', value, observed }));
  assert.equal(observed.amount, null); assert.notEqual(observed.status, 'exact');
});
test('a cropped repeated marker remains unavailable through fresh and stored source review', () => {
  checkMoney('😀王甲收到人民币4000￥。', '4000', null);
});
test('normal single currency markers remain exact without creating confirmation', () => {
  for (const value of ['￥4000', '人民币4000', '4000元']) {
    assert.equal(money(value).amount, '4000.00'); checkMoney('😀王甲收到' + value + '。', value, '4000.00');
  }
});
for (const reverse of [false, true]) test('the same uniquely located wage-prefix wrapper collapses once: reverse=' + reverse, () => {
  const text = '😀王甲收到工资4000元。', source = sourceFor(text);
  const candidates = [entry('工资4000元', text), entry('4000元', text)]; if (reverse) candidates.reverse();
  const state = stateFor(source, candidates), material = state.materials[0];
  console.log(JSON.stringify({ evidence: 'round38_same_event_dedup', reverse, source, candidates, material }));
  assert.equal(material.candidates.length, 1); assert.equal(material.rejected.length, 1);
  assert.match(material.rejected[0].reason, /重复/u); assert.equal(material.candidates[0].amount, '4000.00');
});
test('equal wage amounts belonging to two explicitly different workers stay separate', () => {
  const first = '😀王甲收到工资4000元。', second = '李乙收到工资4000元。', source = sourceFor(first + second);
  const candidates = [entry('工资4000元', first), entry('4000元', second, { subject: '李乙' })];
  const material = stateFor(source, candidates).materials[0];
  console.log(JSON.stringify({ evidence: 'round38_two_owners', source, candidates, material }));
  assert.equal(material.candidates.length, 2); assert.equal(material.rejected.length, 0);
  assert.deepEqual(material.candidates.map(fact => fact.subject), ['王甲', '李乙']);
});
test('same-worker equal amounts at two distinct block positions cannot be deduplicated', () => {
  const text = '😀王甲收到工资4000元。', source = sourceFor([text, text]);
  const candidates = [entry('工资4000元', text), entry('4000元', text, { blockId: 'b2' })];
  const material = stateFor(source, candidates).materials[0];
  console.log(JSON.stringify({ evidence: 'round38_two_positions', source, candidates, material }));
  assert.equal(material.candidates.length, 2); assert.equal(material.rejected.length, 0);
  assert.deepEqual(material.candidates.map(fact => fact.blockId), ['b1', 'b2']);
});
