import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Finite synthetic contracts for the five post-4330 review findings. No model,
// HTTP, build, historical verifier or whole-experiment scoring run is involved.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const load = path => import(pathToFileURL(resolve(ROOT, path)));
const { normalizeMoneyValueV4: money, normalizeCandidateValueV4: normalize } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates: fresh } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, validateCandidateOutput } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const { hasSupportedCandidateAttribution: attributed } = await load('lib/material-fact-event-review.ts');
const { resolveCandidateEvent } = await load('experiments/material-facts-v7/assess.mjs');
const cp = text => Array.from(text).length;
const sourceFor = text => ({ id: 'round34-independent', name: 'synthetic.txt', sha256: 'a'.repeat(64), analysisRevision: 34,
  ready: true, blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] });
const entry = (value, quote = value, extra = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲',
  scope: 'individual', meaning: 'other_money', completeness: 'not_applicable', period: null, rateUnit: null,
  assertion: 'narrated', ...extra });
const rawFor = candidates => JSON.stringify({ schemaVersion: 3, candidates });
function stateFor(source, item, old = false) {
  const raw = rawFor([item]), structural = validateCandidateOutput(raw, source), before = structuredClone(source);
  assert.equal(structural.rejected.length, 0, 'Every fixture must pass structural validation.');
  const state = (old ? legacy : fresh)(emptyFactState(34), source, { raw }, 'independent', 'synthetic', '2026-10-19T01:00:00.000Z', null);
  assert.deepEqual(source, before); assert.equal(state.materials[0].raw, raw);
  assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
  return state;
}
function factFor(source, item, state) {
  assert.equal(state.materials[0].candidates.length, 1, 'Accepted candidate and usable amount are separate.');
  const fact = state.materials[0].candidates[0], text = source.blocks[0].text, at = text.indexOf(item.quote);
  assert(at >= 0); assert.equal(text.indexOf(item.quote, at + 1), -1);
  assert.deepEqual(fact.representation, item); assert.equal(fact.start, cp(text.slice(0, at)));
  assert.equal(fact.end, fact.start + cp(item.quote)); return fact;
}
function reviewStored(source, item, amount) {
  const state = stateFor(source, item, true), fact = factFor(source, item, state);
  fact.amount = amount; fact.normalization = { rawValue: item.value, status: amount === null ? 'unsupported' : 'exact', amount,
    matchedText: item.value, span: { start: 0, end: cp(item.value) }, reason: 'Synthetic stored extraction; never confirmed.' };
  const before = structuredClone(state), reviewed = reviewFactsAgainstSources(state, [source]);
  assert.deepEqual(state, before); assert.equal(reviewed.materials[0].raw, rawFor([item]));
  return factFor(source, item, reviewed);
}
function checkMoney(text, value, wanted, extra = {}) {
  const source = sourceFor(text), rows = [];
  for (const quote of [value, text]) {
    const item = entry(value, quote, extra), direct = normalize(item);
    const observed = { direct, fresh: factFor(source, item, stateFor(source, item)), storedExact: reviewStored(source, item, '4000.00'),
      storedUnavailable: reviewStored(source, item, null) };
    console.log(JSON.stringify({ evidence: 'round34_money', source, item, observed })); rows.push(observed);
  }
  for (const observed of rows) {
    assert.equal(observed.fresh.amount, wanted); assert.equal(observed.storedExact.amount, wanted);
    assert.equal(observed.storedUnavailable.amount, null, 'Read-only review must not upgrade stored null.');
  }
}
function checkDate(text, value, wanted, changes = {}) {
  const source = sourceFor(text), rows = [];
  for (const quote of [value, text]) {
    const item = entry(value, quote, { kind: 'date', meaning: 'payment_date', ...changes });
    const normalized = { rawValue: value, status: 'exact', amount: null, matchedText: value,
      span: { start: 0, end: cp(value) }, reason: 'Date role only; no amount or actual payment claim.' };
    const direct = attributed(item, text, normalized), fact = factFor(source, item, stateFor(source, item));
    const old = stateFor(source, item, true), reviewed = reviewFactsAgainstSources(old, [source]);
    const stored = factFor(source, item, reviewed);
    console.log(JSON.stringify({ evidence: 'round34_date', source, item, direct, fact, stored })); rows.push({ direct, fact, stored });
  }
  for (const row of rows) {
    assert.equal(row.direct, wanted);
    for (const fact of [row.fact, row.stored]) {
      assert.equal(fact.amount, null); assert.equal(fact.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), !wanted);
    }
  }
}
for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-event-review.ts', 'lib/material-fact-source-review.ts',
  'lib/material-fact-runtime-ingest.ts', 'experiments/material-facts-v7/assess.mjs'])
  console.log(JSON.stringify({ evidence: 'round34_implementation', path,
    sha256: createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex') }));

for (const prep of ['于', '在']) test('a finite preposition keeps the same-worker recurring payment schedule: ' + prep, () => {
  checkDate('😀王甲工资' + prep + '每月十五日发放', '每月十五日', true);
});
for (const verb of ['給付', '支付完畢']) test('traditional deadline glyphs preserve the explicit deadline layout: ' + verb, () => {
  checkDate('😀王甲工資應於2026年1月15日前' + verb, '2026年1月15日前', true);
});
test('recurring prepositions cannot swallow negation, another recipient or an invalid day', () => {
  checkDate('😀王甲工资于每月15日不发放', '每月15日', false);
  checkDate('😀王甲工资在每月15日发放给李乙', '每月15日', false);
  checkDate('😀王甲工资于每月32日发放', '每月32日', false);
});
test('an already supported simple schedule remains a date and cannot claim another role', () => {
  checkDate('😀王甲工资每月15日发放', '每月15日', true);
  checkDate('😀王甲工资每月15日发放', '每月15日', false, { meaning: 'employment_period' });
});

for (const subject of ['王近', '王约']) test('a complete anchored name does not qualify the wage number: ' + subject, () => {
  assert.equal(money('4000元').amount, '4000.00');
  checkMoney('😀' + subject + '工资4000元。', '4000元', '4000.00', { subject });
});
test('a genuine modifier outside the owner stays non-exact, including an untrusted enlarged subject', () => {
  const text = '😀王甲工资约4000元。';
  checkMoney(text, '4000元', null);
  checkMoney(text, '4000元', null, { subject: '王甲工资约' });
});
test('a later different-owner estimate does not contaminate an exact first payment', () => {
  checkMoney('😀王甲收到4000元。李乙工资约5000元。', '4000元', '4000.00');
});

for (const denominator of ['月亮', '月份', '小时候']) test('the whole slash denominator is required, not its unit prefix: ' + denominator, () => {
  const value = '4000元/' + denominator, normalized = money(value);
  console.log(JSON.stringify({ evidence: 'round34_denominator', value, normalized }));
  checkMoney('😀王甲工资' + value + '。', '4000元', null, { meaning: 'rate', rateUnit: denominator.startsWith('小时') ? 'hour' : 'month' });
  assert.equal(normalized.amount, null); assert.equal(normalized.status, 'unsupported');
});
test('a complete supported slash unit retains a rate, while its attached unknown remains null', () => {
  assert.equal(money('4000元/月').amount, '4000.00');
  checkMoney('😀王甲工资4000元/月。', '4000元', '4000.00', { meaning: 'rate', rateUnit: 'month' });
  checkMoney('😀王甲工资4000元/月待核。', '4000元', null, { meaning: 'rate', rateUnit: 'month' });
});

function alignment(value, text, inner, anchorOuter = false, subject = '王甲') {
  const source = sourceFor(text), raw = entry(value, text, { kind: 'date', meaning: 'employment_period', subject });
  const at = text.indexOf(inner); assert(at >= 0);
  const start = cp(text.slice(0, at)), end = start + cp(inner);
  const label = { events: [{ id: 'first', anchors: [{ blockId: 'b1', start, end }] }] };
  const before = structuredClone({ raw, source, label }), result = resolveCandidateEvent(raw, { source }, label);
  assert.deepEqual({ raw, source, label }, before);
  console.log(JSON.stringify({ evidence: 'round34_date_alignment', value, text, inner, anchorOuter, result })); return result;
}
for (const [outer, inner] of [['從2026年1月起', '2026年1月'], ['2026年1月後', '2026年1月'], ['2026年1月期間', '2026年1月']])
  test('a traditional date wrapper aligns to its registered inner position only: ' + outer, () => {
    assert.equal(alignment(outer, '😀王甲入职' + outer + '。', inner).event, 'first');
    assert.equal(alignment(inner, '😀王甲入职' + outer + '。', outer, true).event, 'first');
  });
test('date alignment does not admit narrative wrappers or borrow a second same-date event', () => {
  assert.equal(alignment('于2026年1月入职', '😀王甲于2026年1月入职。', '2026年1月').event, null);
  const first = '😀王甲從2026年1月起入职。', second = '李乙從2026年1月起入职。', text = first + second;
  const result = alignment('從2026年1月起', text, '2026年1月');
  assert.equal(result.event, null, 'One registered event cannot resolve a quote with two literal occurrences.');
});
