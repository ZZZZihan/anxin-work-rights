// R39 date receipt only: synthetic module/source review, no scorer/HTTP/model.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = resolve(process.env.MATERIAL_FACT_TEST_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const EVENT = resolve(process.env.MATERIAL_FACT_EVENT_FILE || resolve(ROOT, 'lib/material-fact-event-review.ts'));
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-r39-date-receipt-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(ROOT, 'lib'), resolve(temporary, 'lib'), { recursive: true });
await cp(EVENT, resolve(temporary, 'lib/material-fact-event-review.ts'));
const load = name => import(pathToFileURL(resolve(temporary, 'lib', name)).href);
const { hasSupportedCandidateAttribution: attributed } = await load('material-fact-event-review.ts');
const { normalizeCandidateValue, emptyFactState, ingestCandidates: legacy, validateCandidateOutput, buildFactView } = await load('material-facts-v3.ts');
const { ingestRuntimeCandidates: fresh } = await load('material-fact-runtime-ingest.ts');
const { reviewFactsAgainstSources } = await load('material-fact-source-review.ts');
const DATE = '2026年1月15日', cpLength = text => Array.from(text).length;
const AT = '2026-10-19T03:00:00.000Z';
const candidate = (quote, options = {}) => ({ kind: 'date', value: DATE, quote, blockId: 'b1', subject: '王甲', scope: 'individual',
  meaning: 'payment_date', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated', ...options });
console.log(JSON.stringify({ node: process.version, dependency_root: ROOT, event_sha256: createHash('sha256').update(await readFile(EVENT)).digest('hex') }));
function direct(text, expected, options = {}) {
  for (const quote of [DATE, text]) {
    const raw = candidate(quote, options), normalization = normalizeCandidateValue(raw).normalization;
    const before = structuredClone({ raw, normalization, text });
    const actual = attributed(raw, text, normalization);
    console.log(JSON.stringify({ evidence: 'r39_date_attribution', text, raw, actual, expected }));
    assert.equal(actual, expected);
    assert.deepEqual({ raw, normalization, text }, before, 'Detection never changes the literal candidate or its normalization.');
  }
}
const sourceFor = (texts, pages) => ({ id: 'r39-date-receipt', name: 'synthetic.txt', sha256: '9'.repeat(64), ready: true,
  analysisRevision: 39, blocks: texts.map((text, i) => ({ id: `b${i + 1}`, page: pages?.[i] ?? 1, text, bbox: null, confidence: null })) });
function runtime(texts, expected, options = {}, pages) {
  const source = sourceFor(Array.isArray(texts) ? texts : [texts], pages), text = source.blocks[0].text;
  for (const quote of [DATE, text]) {
    const entry = candidate(quote, options), raw = JSON.stringify({ schemaVersion: 3, candidates: [entry] });
    const validation = validateCandidateOutput(raw, source);
    assert.equal(validation.rejected.length, 0, 'Every fixture uses the actual valid extraction schema.');
    const stored = legacy(emptyFactState(39), source, { raw }, 'synthetic', 'fixture', AT);
    const before = structuredClone({ stored, source });
    const current = fresh(emptyFactState(39), source, { raw }, 'synthetic', 'fixture', AT);
    const reviewed = reviewFactsAgainstSources(stored, [source]);
    for (const [mode, state] of [['fresh', current], ['stored-read', reviewed]]) {
      assert.equal(state.materials[0].candidates.length, 1, 'A review issue does not silently discard raw evidence.');
      const fact = state.materials[0].candidates[0];
      console.log(JSON.stringify({ evidence: 'r39_runtime_date', mode, source, entry, fact }));
      assert.equal(fact.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), !expected);
      assert.equal(fact.amount, null, 'A payment date is never a payable/paid amount.');
      assert.deepEqual(fact.representation, entry); assert.equal(state.materials[0].raw, raw);
      const start = cpLength(text.slice(0, text.indexOf(quote)));
      assert.equal(fact.start, start); assert.equal(fact.end, start + cpLength(quote));
      assert.equal(Array.from(text).slice(fact.start, fact.end).join(''), quote);
      assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
      const view = buildFactView(state, [source]);
      assert.equal(view.canCalculate, false); assert.deepEqual(view.fields.due.values, []); assert.deepEqual(view.fields.paid.values, []);
    }
    assert.deepEqual({ stored, source }, before, 'Read-time date review preserves original stored evidence and raw CP offsets.');
  }
}
for (const verb of ['到账', '入账', '到帳', '入帳', '到賬', '入賬'])
  test(`point wage receipt supports its finite date envelope: ${verb}`, () => direct(`😀王甲工資於${DATE}${verb}`, true));
for (const verb of ['实际到账', '實際入帳'])
  test(`explicit actual receipt keeps its date only: ${verb}`, () => direct(`😀王甲工资于${DATE}${verb}`, true));
for (const verb of ['收到', '领取', '支付', '发放'])
  test(`existing point payment-date envelope stays supported: ${verb}`, () => direct(`😀王甲工资于${DATE}${verb}`, true));
for (const [text, options] of [
  [`😀王甲工资于${DATE}未到账`, {}], [`😀王甲工资于${DATE}未入帳`, {}],
  [`😀王甲工资于${DATE}到账给李乙`, {}], [`😀王甲工资由李乙于${DATE}到账`, {}],
  [`😀王乙工资于${DATE}到账`, {}], [`😀王甲工资于${DATE}到账`, { meaning: 'employment_period' }],
  [`😀王甲工资于${DATE}到账`, { meaning: 'wage_period' }], [`😀王甲工资于${DATE}到账`, { scope: 'organization' }],
  [`😀王甲工资于${DATE}前到账`, {}], [`😀王甲工资于${DATE}李乙到账`, {}],
]) test(`receipt cannot absorb polarity, another party, boundary or wrong role: ${text} ${JSON.stringify(options)}`, () => direct(text, false, options));
for (const verb of ['到账', '入帳'])
  test(`actual fresh/stored date evidence remains nonmonetary and unconfirmed: ${verb}`, () => runtime(`😀王甲工资于${DATE}${verb}。`, true));
test('actual fresh/stored negation retains evidence and its relation warning', () => runtime(`😀王甲工资于${DATE}未到账。`, false));
test('actual same-block different event cannot lend a receipt verb', () => runtime(`😀王甲工资于${DATE}。李乙到账。`, false));
test('a receipt verb across pages cannot establish the previous date role', () => runtime([`😀王甲工资于${DATE}`, '到账。'], false, {}, [1, 2]));
test('a different owner in the next block cannot lend its receipt', () => runtime([`😀王甲工资于${DATE}`, '李乙工资到账。'], false));
