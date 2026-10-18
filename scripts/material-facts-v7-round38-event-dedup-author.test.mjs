// R38 synthetic actual runtime/store checks. No HTTP, model, scorer or history CLI.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.MATERIAL_FACT_TEST_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const EVENT = resolve(process.env.MATERIAL_FACT_EVENT_FILE || resolve(ROOT, 'lib/material-fact-event-review.ts'));
const RUNTIME = resolve(process.env.MATERIAL_FACT_RUNTIME_MODULE || resolve(ROOT, 'lib/material-fact-runtime-ingest.ts'));
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-r38-event-dedup-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(ROOT, 'lib'), resolve(temporary, 'lib'), { recursive: true });
await cp(EVENT, resolve(temporary, 'lib/material-fact-event-review.ts'));
await cp(RUNTIME, resolve(temporary, 'lib/material-fact-runtime-ingest.ts'));
const load = name => import(pathToFileURL(resolve(temporary, 'lib', name)).href);
const { hasSupportedCandidateAttribution: attribution } = await load('material-fact-event-review.ts');
const { validateRuntimeCandidateOutput: validate, ingestRuntimeCandidates: fresh } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy } = await load('material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('material-fact-source-review.ts');
const cpLength = text => Array.from(text).length;
const digest = async file => createHash('sha256').update(await readFile(file)).digest('hex');
console.log(JSON.stringify({ node: process.version, dependency_root: ROOT, event_sha256: await digest(EVENT), runtime_sha256: await digest(RUNTIME) }));
const AT = '2026-10-19T00:00:00.000Z';
function sourceFor(texts) {
  return { id: 'r38-event-dedup', name: 'synthetic.txt', sha256: '8'.repeat(64), analysisRevision: 38, ready: true,
    blocks: texts.map((text, index) => ({ id: `b${index + 1}`, page: 1, text, bbox: null, confidence: null })) };
}
function entry(value, quote, options = {}) {
  return { kind: 'money', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'payment',
    completeness: 'unknown', period: null, rateUnit: null, assertion: 'narrated', ...options };
}
function checkDate(text, value, expected, options = {}) {
  const source = sourceFor([text]);
  for (const quote of [value, text]) {
    const item = entry(value, quote, { kind: 'date', meaning: 'payment_date', completeness: 'not_applicable', ...options });
    const normalized = { rawValue: value, status: 'unsupported', amount: null, matchedText: null, span: null, reason: 'Synthetic stored date; no money derivation.' };
    const before = structuredClone({ source, item, normalized });
    assert.equal(attribution(item, text.replace(/[。]$/u, ''), normalized), expected, 'Finite date attribution must retain owner/role/polarity gates');
    const raw = JSON.stringify({ schemaVersion: 3, candidates: [item] });
    const historical = legacy(emptyFactState(38), source, { raw }, 'synthetic', 'fixture', AT);
    const originalHistory = structuredClone(historical);
    for (const state of [fresh(emptyFactState(38), source, { raw }, 'synthetic', 'fixture', AT), reviewFactsAgainstSources(historical, [source])]) {
      const material = state.materials[0], candidate = material.candidates[0];
      assert.equal(material.candidates.length, 1); assert.equal(material.raw, raw);
      assert.equal(candidate.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), !expected, 'Actual fresh/history review must agree with the bound event');
      assert.equal(candidate.amount, null); assert.deepEqual(candidate.representation, item);
      assert.equal(Array.from(text).slice(candidate.start, candidate.end).join(''), quote, 'Raw Unicode CP quote survives');
      assert.equal(candidate.start, cpLength(text.slice(0, text.indexOf(quote))));
      assert.equal(state.calculation, null); assert.deepEqual(state.confirmations, { due: null, paid: null });
    }
    assert.deepEqual(historical, originalHistory, 'Read-time review cannot rewrite stored extraction');
    assert.deepEqual({ source, item, normalized }, before);
  }
}
for (const [text, value] of [
  ['😀王甲工资每月15日发薪。', '每月15日'],
  ['😀王甲的工资每个月十五号发薪。', '每个月十五号'],
  ['😀王甲工資每個月十五號發薪。', '每個月十五號'],
  ['😀王甲薪资在每月第31日发薪。', '每月第31日'],
  ['😀王甲每月15日发薪工资。', '每月15日'],
  ['😀王甲工资每月15日发放。', '每月15日'],
]) test(`recurring scheduled payment finite verb ${text}`, () => checkDate(text, value, true));
for (const [text, value, options] of [
  ['😀王甲工资每月15日未发薪。', '每月15日', {}],
  ['😀王甲工资并非每月15日发薪。', '每月15日', {}],
  ['😀王甲工资每月15日发薪通知。', '每月15日', {}],
  ['😀王甲工资每月15日发薪待核实。', '每月15日', {}],
  ['😀王甲工资每月15日由王乙发薪。', '每月15日', {}],
  ['😀王甲工资每月15日发薪给王乙。', '每月15日', {}],
  ['😀王甲替王乙每月15日发薪。', '每月15日', {}],
  ['😀王乙每月15日向王甲发薪。', '每月15日', {}],
  ['😀王甲和王乙工资每月15日发薪。', '每月15日', { subject: '王甲和王乙' }],
  ['😀王甲工资每月15日发薪。', '每月15日', { meaning: 'wage_period' }],
  ['😀王甲工资每月15日发薪。', '每月15日', { scope: 'organization' }],
  ['😀王甲工资每月15日发薪。', '15日', {}],
  ['😀王甲工资每月32日发薪。', '每月32日', {}],
  ['😀王甲工资每月0日发薪。', '每月0日', {}],
  ['😀王甲工资每月15日前发薪。', '每月15日', {}],
]) test(`recurring owner/role/negation/boundary control ${text} ${JSON.stringify(options)}`, () => checkDate(text, value, false, options));

function checkDedup(texts, entries, count, rejected = [], expectedAmount) {
  const source = sourceFor(texts), raw = JSON.stringify({ schemaVersion: 3, candidates: entries });
  const before = structuredClone({ source, entries });
  const initial = emptyFactState(38), checked = validate(raw, source);
  const state = fresh(initial, source, { raw }, 'synthetic', 'fixture', AT), material = state.materials[0];
  assert.equal(checked.candidates.length, count, 'Only proven same-occurrence finite wrappers collapse');
  assert.equal(material.candidates.length, count, 'Dedup result must reach the real ingestion state');
  assert.deepEqual(checked.rejected.map(item => item.index), rejected); assert.deepEqual(material.rejected, checked.rejected);
  assert.equal(checked.raw, raw); assert.equal(material.raw, raw);
  assert.deepEqual(JSON.parse(material.raw).candidates, entries, 'Both raw observations remain, including the rejected duplicate');
  assert.deepEqual(material.candidates.map(item => item.representation), entries.filter((_, index) => !rejected.includes(index)));
  for (const candidate of [...checked.candidates, ...material.candidates]) {
    if (expectedAmount !== undefined) assert.equal(candidate.amount, expectedAmount, 'This fixture must satisfy its literal precision precondition');
    const text = source.blocks.find(block => block.id === candidate.blockId).text;
    assert.equal(Array.from(text).slice(candidate.start, candidate.end).join(''), candidate.quote);
    assert.equal(candidate.start, cpLength(text.slice(0, text.indexOf(candidate.quote))));
  }
  assert.deepEqual({ source, entries }, before); assert.deepEqual(initial, emptyFactState(38));
  assert.equal(material.coverage.rawCount, entries.length); assert.equal(material.coverage.acceptedCount, count);
  assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
  return material;
}
for (const reverse of [false, true]) {
  for (const noun of ['工资', '工資', '劳务费', '勞務費', '劳动报酬', '勞動報酬']) {
    test(`unique occurrence finite wage prefix ${noun}, reverse=${reverse}`, () => {
      const text = `😀王甲收到${noun}4000元。`, entries = [entry('4000元', text), entry(`${noun}4000元`, text)];
      if (reverse) entries.reverse();
      checkDedup([text], entries, 1, [1], '4000.00');
    });
  }
  test(`finite prefix plus existing currency wrapper, reverse=${reverse}`, () => {
    const text = '😀王甲收到人民币工资4000元。', entries = [entry('4000元', text), entry('人民币工资4000元', text)];
    if (reverse) entries.reverse(); checkDedup([text], entries, 1, [1], '4000.00');
  });
  test(`separate same-amount payments stay separate, reverse=${reverse}`, () => {
    const first = '😀王甲第一次收到工资4000元。', second = '王甲第二次收到工资4000元。';
    const entries = [entry('4000元', first), entry('工资4000元', second)];
    if (reverse) entries.reverse(); checkDedup([first + second], entries, 2, [], '4000.00');
  });
  test(`equal literals in separate blocks stay separate, reverse=${reverse}`, () => {
    const text = '😀王甲收到工资4000元。', entries = [entry('4000元', text), entry('工资4000元', text, { blockId: 'b2' })];
    if (reverse) entries.reverse(); checkDedup([text, text], entries, 2, [], '4000.00');
  });
  test(`ambiguous short quotes cannot prove an occurrence, reverse=${reverse}`, () => {
    const text = '王甲收到工资4000元。王甲又收到工资4000元。', entries = [entry('4000元', '4000元'), entry('工资4000元', '工资4000元')];
    if (reverse) entries.reverse(); checkDedup([text], entries, 2);
  });
  test(`repeated values inside a unique quote stay ambiguous, reverse=${reverse}`, () => {
    const text = '王甲收到工资4000元。王甲又收到工资4000元。', entries = [entry('4000元', text), entry('工资4000元', text)];
    if (reverse) entries.reverse(); checkDedup([text], entries, 2);
  });
  test(`different assertions do not merge, reverse=${reverse}`, () => {
    const text = '😀王甲收到工资4000元。', entries = [entry('4000元', text, { assertion: 'claimed' }), entry('工资4000元', text)];
    if (reverse) entries.reverse(); checkDedup([text], entries, 2, [], '4000.00');
  });
  test(`arbitrary prefix narration is not a wrapper, reverse=${reverse}`, () => {
    const text = '😀王甲收到公司应当补发工资4000元。', entries = [entry('4000元', text), entry('公司应当补发工资4000元', text)];
    if (reverse) entries.reverse(); checkDedup([text], entries, 2);
  });
  test(`unregistered doubled wage prefix is not a wrapper, reverse=${reverse}`, () => {
    const text = '😀王甲收到工资工资4000元。', entries = [entry('4000元', text), entry('工资工资4000元', text)];
    if (reverse) entries.reverse(); checkDedup([text], entries, 2);
  });
  test(`conflicting foreign prefix is not a wrapper, reverse=${reverse}`, () => {
    const text = '😀王甲收到港币工资4000元。', entries = [entry('4000元', text), entry('港币工资4000元', text)];
    if (reverse) entries.reverse(); checkDedup([text], entries, 2, [], null);
  });
}
