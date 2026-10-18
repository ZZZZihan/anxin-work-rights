import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Synthetic source/event integration only. Point BASE at a fixed checkout and
// PATCH at the implementation under review; neither tree is changed by tests.
const HERE = fileURLToPath(new URL('../', import.meta.url));
const BASE = resolve(process.env.MATERIAL_FACT_RATE_BASE_ROOT || HERE);
const PATCH = resolve(process.env.MATERIAL_FACT_RATE_PATCH_ROOT || HERE);
const temp = await mkdtemp(resolve(tmpdir(), 'anxin-postposed-unit-source-'));
after(() => rm(temp, { recursive: true, force: true }));
await cp(resolve(BASE, 'lib'), resolve(temp, 'lib'), { recursive: true });
const files = ['material-fact-source-review.ts', 'material-fact-event-review.ts'];
for (const file of files) await cp(resolve(PATCH, 'lib', file), resolve(temp, 'lib', file));
console.log(JSON.stringify({ source_event_sha256: Object.fromEntries(await Promise.all(files.map(async file => [file,
  createHash('sha256').update(await readFile(resolve(temp, 'lib', file))).digest('hex')])))}));
const load = file => import(pathToFileURL(resolve(temp, 'lib', file)).href);
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates, buildFactView } = await load('material-facts-v3.ts');
const { reviewCandidateAgainstSource } = await load('material-fact-source-review.ts');
const { hasSupportedCandidateAttribution } = await load('material-fact-event-review.ts');
const { normalizeMoneyValueV4 } = await load('material-money-v4.ts');
const AT = '2026-10-18T00:00:00.000Z';

function check({ text, texts = [text], full = false, quote, value = '4000元', meaning = 'due_total', rateUnit = null,
  subject = '王甲', period = null, expected = null, relation, mismatch = expected === null, status, direct = false, samePage = false }) {
  const block = texts.findIndex(part => part.includes(value));
  assert.ok(block >= 0);
  const representation = { kind: 'money', value, quote: quote ?? (full ? texts[block] : value), blockId: `b${block + 1}`,
    subject, scope: 'individual', meaning, completeness: ['due_total', 'paid_total'].includes(meaning) ? 'complete' : 'not_applicable',
    rateUnit, period, assertion: 'narrated' };
  const source = { id: 'postposed-unit-source', name: '合成金额后置按单位费率', sha256: '6'.repeat(64), analysisRevision: 26, ready: true,
    blocks: texts.map((text, index) => ({ id: `b${index + 1}`, page: samePage ? 1 : index + 1, text, bbox: null, confidence: null })) };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [representation] });
  const fresh = ingestRuntimeCandidates(emptyFactState(26), source, { raw }, 'synthetic', 'owner', AT);
  assert.equal(fresh.materials[0].candidates.length, 1, 'The monetary fixture must enter the actual candidate store');
  const stored = ingestCandidates(emptyFactState(26), source, { raw }, 'synthetic', 'owner', AT);
  const candidate = stored.materials[0].candidates[0];
  const exact = normalizeMoneyValueV4(value);
  assert.equal(exact.amount, '4000.00', 'Historical fixture must start from a real exact monetary literal');
  Object.assign(candidate, { amount: exact.amount, normalization: exact });
  const snapshot = structuredClone({ source, stored });
  const checked = reviewCandidateAgainstSource(candidate, source);
  if (direct) assert.equal(hasSupportedCandidateAttribution(representation, texts[block].replace(/。$/u, ''), exact), relation,
    'Finite event attribution, independently of the source-review amount guard');
  for (const [path, item] of [['fresh', fresh.materials[0].candidates[0]], ['historical read', checked]]) {
    assert.equal(item.amount, expected, `${path}: source amount`);
    if (status) assert.equal(item.normalization.status, status, `${path}: declared guard status`);
    else if (mismatch) assert.equal(item.normalization.status, 'rate_unit_mismatch', `${path}: explicit rate mismatch`);
    else assert.equal(item.normalization.status, 'exact', `${path}: exact preservation`);
    if (relation !== undefined) assert.equal(item.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'), !relation,
      `${path}: same-event relationship`);
    assert.deepEqual(item.representation, representation, `${path}: original model fields`);
    assert.equal(item.value, value); assert.equal(item.quote, representation.quote);
    assert.equal(item.sourceSha256, source.sha256);
    const quoteStart = texts[block].indexOf(representation.quote);
    assert.equal(item.start, Array.from(texts[block].slice(0, quoteStart)).length);
    assert.equal(item.end, item.start + Array.from(representation.quote).length);
    assert.equal(Array.from(texts[block]).slice(item.start, item.end).join(''), representation.quote);
  }
  assert.equal(fresh.materials[0].raw, raw);
  assert.deepEqual(fresh.confirmations, { due: null, paid: null }); assert.equal(fresh.calculation, null);
  assert.equal(buildFactView(fresh, [source]).canCalculate, false);
  assert.deepEqual({ source, stored }, snapshot, 'Historical review never rewrites stored raw/source/history');
  candidate.amount = null; candidate.normalization = { ...exact, amount: null, status: 'unsupported' };
  const nullSnapshot = structuredClone(stored);
  assert.equal(reviewCandidateAgainstSource(candidate, source).amount, null, 'Historical unavailable values are never upgraded');
  assert.deepEqual(stored, nullSnapshot);
}

const units = [['月', 'month'], ['日', 'day'], ['天', 'day'], ['小时', 'hour'], ['时', 'hour'], ['件', 'piece']];
for (const [word, unit] of units) for (const full of [false, true]) {
  const text = `😀王甲工资4000元按${word}计。`;
  test(`total cannot borrow a postposed rate ${word}, full=${full}`, () => check({ text, full }));
  test(`correct postposed rate owns its event ${word}, full=${full}`, () => check({ text, full,
    meaning: 'rate', rateUnit: unit, expected: '4000.00', relation: true, direct: true }));
  test(`wrong declared rate unit ${word}, full=${full}`, () => check({ text, full,
    meaning: 'rate', rateUnit: unit === 'month' ? 'day' : 'month' }));
}
for (const tail of ['按月计算', '按日计薪', '按天计价', '按小时计酬', '按件计酬', '按時計', '按小時計', '按件計價']) {
  const unit = tail.includes('月') ? 'month' : /日|天/u.test(tail) ? 'day' : tail.includes('件') ? 'piece' : 'hour';
  test(`finite remuneration word ${tail}`, () => check({ text: `王甲工資4000元${tail}。`, meaning: 'rate', rateUnit: unit,
    expected: '4000.00', relation: true, direct: true }));
  test(`finite remuneration word is not a total ${tail}`, () => check({ text: `王甲工資4000元${tail}。` }));
}
for (const [word, unit] of units.filter(([word]) => word !== '时')) {
  test(`bare but explicitly bounded by-unit rate 按${word}`, () => check({ text: `王甲工资4000元按${word}。`,
    meaning: 'rate', rateUnit: unit, expected: '4000.00', relation: true, direct: true }));
}
for (const tail of ['按时支付', '按时', '按时间顺序', '按月15日发放', '按日15日发放', '按月计息', '按件计数', '按小时计算机规定',
  '按原约定', '按2026年1月实际工作结算', '按月度汇总']) {
  test(`ordinary instruction is not a supported postposed rate: ${tail}`,
    () => check({ text: `王甲工资4000元${tail}。`, expected: '4000.00', mismatch: false }));
}
for (const period of ['2026年1月', '2026年1月15日', '今日', '上月']) {
  test(`actual wage period remains an amount: ${period}`, () => check({ text: `王甲${period}工资4000元。`, period,
    expected: '4000.00', mismatch: false }));
}
for (const separator of ['，', '。', '；', '\n', '\u2028', '\u2029']) {
  test(`another subject's following rate is not transferred ${JSON.stringify(separator)}`,
    () => check({ text: `王甲工资4000元${separator}王乙工资5000元按月计。`, expected: '4000.00', mismatch: false }));
  test(`punctuation before an unattached rate is a boundary ${JSON.stringify(separator)}`,
    () => check({ text: `王甲工资4000元${separator}另一人按月计。`, expected: '4000.00', mismatch: false }));
}
for (const tail of ['按\n月计', '按\u2028小时计', '按\u2029件计酬', '\n按月计', '按\u200b月计', '按 小 時 計']) {
  test(`explicit by-unit continuation survives layout/Cf ${JSON.stringify(tail)}`,
    () => check({ text: `😀王甲工资4000元${tail}。` }));
}
for (const texts of [
  ['😀王甲工资4000元按', '月计。'], ['😀王甲工资4000元', '按小时计。'], ['😀王甲工资4000元按件', '计酬。'],
]) test(`explicit continuation across source blocks ${JSON.stringify(texts)}`, () => check({ texts, samePage: true }));
for (const texts of [
  ['😀王甲工资4000元。', '按月计。'], ['😀王甲工资4000元', '王乙工资5000元按月计。'],
  ['😀王甲工资4000元', '每月15日发放。'],
]) test(`layout cannot borrow an independent rate ${JSON.stringify(texts)}`,
  () => check({ texts, expected: '4000.00', mismatch: false }));
for (const subject of ['王甲工资', '王甲工资4000元按月']) {
  test(`model subject cannot exempt source suffix: ${subject}`, () => check({ text: '王甲工资4000元按月计。', subject }));
}
for (const [tail, rateUnit] of [['按月计', 'month'], ['按小时计', 'hour']]) {
  test(`HTTP fixture same-event rate ${tail}`, () => check({ text: `测试王甲工资4000元${tail}`, subject: '测试王甲', full: true,
    meaning: 'rate', rateUnit, expected: '4000.00', relation: true, direct: true }));
}
for (const texts of [
  ['😀王甲工资4000元按月计\n未知。'], ['😀王甲工资4000元按月计', '未知。'],
  ['😀王甲工资4000元按件计酬\n（待核实）。'], ['😀王甲工资4000元按件计酬', '（待核实）。'],
]) test(`a rate cannot discard its attached unknown layout tail ${JSON.stringify(texts)}`, () => check({ texts, samePage: true,
  meaning: 'rate', rateUnit: texts[0].includes('按月') ? 'month' : 'piece', status: 'uncertain', mismatch: false }));

// Integration cases need the co-developed normalizer's finite 整/正+按 branch.
// The core fixed-ec8 dependency run above remains independently reproducible.
if (process.env.MATERIAL_FACT_RATE_COMBINED === '1') {
  for (const ending of ['整', '正']) for (const full of [false, true]) {
    for (const value of ['4000元', `4000元${ending}`]) {
      test(`combined normalizer retains a genuine whole rate ${ending}, full=${full}, value=${value}`,
        () => check({ text: `😀王甲工资4000元${ending}按月计。`, value, full,
          meaning: 'rate', rateUnit: 'month', expected: '4000.00', relation: true, direct: true }));
    }
  }
  for (const texts of [['😀王甲工资4000元按月计', '金额未知。'], ['😀王甲工资4000元按小时计\n（数额待核实）。']])
    test(`combined unknown-label detection stays unavailable ${JSON.stringify(texts)}`, () => check({ texts, samePage: true,
      meaning: 'rate', rateUnit: texts[0].includes('按月') ? 'month' : 'hour', status: 'uncertain', mismatch: false }));
}
