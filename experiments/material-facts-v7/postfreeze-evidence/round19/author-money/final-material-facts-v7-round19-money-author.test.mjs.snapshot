import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Pure synthetic parser/source/history checks. No HTTP, model or experiment data.
const OWN = fileURLToPath(new URL('../', import.meta.url));
const BASE = resolve(process.env.V7_ROUND19_BASE_ROOT || OWN);
const PATCH = resolve(process.env.V7_ROUND19_PATCH_ROOT || OWN);
const temp = await mkdtemp(resolve(tmpdir(), 'anxin-round19-money-author-'));
after(() => rm(temp, { recursive: true, force: true }));
await cp(resolve(BASE, 'lib'), resolve(temp, 'lib'), { recursive: true });
for (const name of ['material-money-v4.ts', 'material-fact-arithmetic-review.ts']) {
  await cp(resolve(PATCH, 'lib', name), resolve(temp, 'lib', name));
  console.log(JSON.stringify({ file: name, sha256: createHash('sha256').update(await readFile(resolve(temp, 'lib', name))).digest('hex') }));
}
const load = name => import(pathToFileURL(resolve(temp, 'lib', name)).href);
const { normalizeMoneyValueV4: money, normalizeCandidateValueV4: normalize, classifyMonetaryExpression: classify } = await load('material-money-v4.ts');
const { hasAttachedMoneyArithmetic: arithmetic } = await load('material-fact-arithmetic-review.ts');
const { ingestRuntimeCandidates: fresh } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy, buildFactView } = await load('material-facts-v3.ts');
const { reviewFactsAgainstSources: review } = await load('material-fact-source-review.ts');
const cpLength = text => Array.from(text).length;
const PREFIX = '😀𠮷王甲工资为';
const entry = (value, quote = value) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'arrears', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' });
function fixture(value, expression = value, fullQuote = false) {
  const text = PREFIX + expression + '。', candidate = entry(value, fullQuote ? text : value);
  return { candidate, raw: JSON.stringify({ schemaVersion: 3, candidates: [candidate] }),
    source: { id: 'round19-author', name: '合成横线时间与比例', sha256: 'e'.repeat(64), analysisRevision: 19, ready: true,
      blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] } };
}
function ingest(f, historical = false, accepted = true) {
  const snapshot = structuredClone(f.source);
  const state = (historical ? legacy : fresh)(emptyFactState(19), f.source, { raw: f.raw }, 'round19-author', 'synthetic', '2026-10-18T00:00:00Z');
  assert.deepEqual(f.source, snapshot);
  assert.equal(state.materials[0].raw, f.raw);
  assert.deepEqual(JSON.parse(state.materials[0].raw).candidates, [f.candidate]);
  assert.deepEqual(state.confirmations, { due: null, paid: null });
  assert.equal(state.calculation, null); assert.equal(buildFactView(state, [f.source]).canCalculate, false);
  if (accepted) {
    assert.equal(state.materials[0].candidates.length, 1);
    const fact = state.materials[0].candidates[0];
    assert.deepEqual(fact.representation, f.candidate);
    assert.equal(Array.from(f.source.blocks[0].text).slice(fact.start, fact.end).join(''), f.candidate.quote);
    assert.equal(fact.start, cpLength(f.source.blocks[0].text.slice(0, f.source.blocks[0].text.indexOf(f.candidate.quote))));
  } else assert.equal(state.materials[0].candidates.length, 0);
  return state;
}
function historical(f, storedAmount, expected) {
  const state = ingest(f, true), candidate = state.materials[0].candidates[0];
  Object.assign(candidate, { amount: storedAmount, normalization: { rawValue: f.candidate.value, status: storedAmount === null ? 'unsupported' : 'exact', amount: storedAmount,
    matchedText: storedAmount === null ? null : f.candidate.value, span: storedAmount === null ? null : { start: 0, end: cpLength(f.candidate.value) }, reason: 'Synthetic pre-fix history.' } });
  const snapshot = structuredClone(state), checked = review(state, [f.source]);
  assert.equal(checked.materials[0].candidates[0].amount, expected);
  assert.deepEqual(checked.materials[0].candidates[0].representation, f.candidate);
  assert.equal(checked.materials[0].raw, f.raw); assert.deepEqual(state, snapshot);
}
function exactTemporal(tail) {
  const whole = '4000元' + tail, parsed = money(whole);
  assert.equal(parsed.amount, '4000.00'); assert.equal(parsed.status, 'exact'); assert.equal(parsed.rawValue, whole);
  assert.equal(parsed.matchedText, '4000元'); assert.deepEqual(parsed.span, { start: 0, end: 5 });
  const embedded = money(PREFIX + whole);
  assert.deepEqual(embedded.span, { start: cpLength(PREFIX), end: cpLength(PREFIX) + 5 });
  for (const fullQuote of [false, true]) {
    const f = fixture('4000元', whole, fullQuote);
    assert.equal(normalize({ ...f.candidate, quote: f.source.blocks[0].text }).amount, '4000.00');
    assert.equal(ingest(f).materials[0].candidates[0].amount, '4000.00');
    historical(f, '4000.00', '4000.00'); historical(f, null, null);
  }
}

test('minimal calendar hyphen is not subtraction', () => exactTemporal('-2024年5月仍未支付'));
test('minimal standalone percentage is definite non-money', () => {
  assert.equal(classify('50%').kind, 'not_monetary');
  ingest(fixture('50%'), false, false);
});
const temporal = ['2024年5月仍未支付', '2024年5月31日仍未支付', '2024年仍未支付', '2024-05-31仍未支付', '2024/05/31仍未支付',
  '2024.5.31仍未支付', '4个月内付清', '四个月内付清', '4月内付清', '4天内付清', '4日内付清', '4小时内付清', '4分钟后支付', '4秒后支付', '4年内付清'];
for (const tail of temporal) for (const dash of ['-', '－']) test('dash before complete calendar or duration: ' + dash + tail, () => {
  assert.equal(arithmetic('', dash + tail), false);
  exactTemporal(dash + tail);
});
for (const tail of ['- 2024 年 5 月仍未支付', '-\n2024年5月仍未支付', '-\r\n4个月内付清', '－２０２４年５月仍未支付', '-２０２４年５月仍未支付', '-20\u200d24年5月仍未支付'])
  test('calendar detection folds only detection copies: ' + JSON.stringify(tail), () => {
    assert.equal(arithmetic('', tail), false);
    // New compatibility glyphs may still fail the stricter full-value parser;
    // the source-bound exact operand must retain its raw CP anchor.
    const f = fixture('4000元', '4000元' + tail, true);
    assert.equal(normalize(f.candidate).amount, '4000.00');
    assert.equal(ingest(f).materials[0].candidates[0].amount, '4000.00');
    historical(f, '4000.00', '4000.00');
  });
const subtraction = ['-200元', '－200元', '-2000', '-50%', '-百分之五十', '-2000.50', '-2000.05', '-2024-05', '-2024.50.31', '−2024年', '减去2024年', '减2000',
  '工资-2000', '基本工资－200元', '-实际出勤系数', '-K', '-2024元', '-2024年5元', '-2024年5', '-4个月元'];
for (const tail of subtraction) test('true or incomplete arithmetic is never exempted: ' + tail, () => {
  assert.equal(arithmetic('', tail), true);
  const whole = '4000元' + tail;
  assert.equal(money(whole).amount, null);
  for (const fullQuote of [false, true]) {
    const f = fixture('4000元', whole, fullQuote);
    assert.equal(normalize({ ...f.candidate, quote: f.source.blocks[0].text }).amount, null);
    assert.equal(ingest(f).materials[0].candidates[0].amount, null); historical(f, '4000.00', null);
  }
});
for (const [before, after] of [['', '/月'], ['', '。2024年5月另行支付'], ['', '，王乙工资减200元'], ['王乙工资减200元。王甲工资', '']])
  test('finite supported rates and separate events keep their arithmetic boundary: ' + before + '|' + after, () => assert.equal(arithmetic(before, after), false));
const ratios = ['50%', '百分之五十', '出勤率50%', '出勤率为50%', '出勤率：50%', '５０％', '百\u200d分之五十',
  '出 勤 率 ５ ０ ％', '50.5%', '0%', '1000%', '-50%', '+50%', '百分之50', '支付比例50%', '计发比例为百分之五十', '折算比例50%', '比例50%', '百分比50%'];
for (const value of ratios) test('complete amount-free ratio is rejected without discarding raw: ' + JSON.stringify(value), () => {
  const classified = classify(value);
  assert.equal(classified.kind, 'not_monetary'); assert.equal(classified.normalization.status, 'not_money');
  assert.equal(classified.normalization.rawValue, value); assert.equal(classified.normalization.amount, null);
  ingest(fixture(value), false, false);
  historical(fixture(value), '50.00', null);
});
for (const value of ['四万元的50%', '四万元的百分之五十', '4000元-50%', '人民币50%', '50美元的50%', '金额不详，支付比例50%'])
  test('real or explicit monetary evidence plus a ratio remains reviewable: ' + value, () => {
    assert.equal(classify(value).kind, 'monetary'); assert.equal(money(value).amount, null);
    const f = fixture(value);
    assert.equal(ingest(f).materials[0].candidates[0].amount, null); historical(f, '40000.00', null);
  });
for (const value of ['出勤率不详', '出勤率x%', '支付比例待核实', '工资若干', '50%对应工资待定', '50%工资'])
  test('unrecognized financial or masked ratio prose is not a definite rejection: ' + value, () => assert.notEqual(classify(value).kind, 'not_monetary'));
for (const value of ['4000元', '四万元', '4000元5角', '工资金额不详', '工资4万元至5万元', '约四万元'])
  test('ordinary monetary forms remain reviewable: ' + value, () => assert.equal(classify(value).kind, 'monetary'));
