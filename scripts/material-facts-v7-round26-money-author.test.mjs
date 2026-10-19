// Author synthetic regression only: no HTTP, models, training or frozen writes.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OWN = fileURLToPath(new URL('../', import.meta.url));
const SOURCE = resolve(process.env.MATERIAL_FACT_TEST_ROOT || OWN);
const PATCH = resolve(process.env.MATERIAL_FACT_PATCH_ROOT || OWN);
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-round26-author-'));
after(() => rm(temporary, { recursive: true, force: true }));
if (process.env.MATERIAL_FACT_TEST_REVISION) {
  const archive = execFileSync('git', ['archive', '--format=tar', process.env.MATERIAL_FACT_TEST_REVISION, 'lib'], { cwd: SOURCE, maxBuffer: 30 * 1024 * 1024 });
  execFileSync('tar', ['-xf', '-', '-C', temporary], { input: archive });
} else await cp(resolve(SOURCE, 'lib'), resolve(temporary, 'lib'), { recursive: true });
for (const file of ['material-money-v4.ts', 'material-fact-range-review.ts']) await cp(resolve(PATCH, 'lib', file), resolve(temporary, 'lib', file));
for (const [key, file] of [['MATERIAL_FACT_SOURCE_FILE', 'material-fact-source-review.ts'], ['MATERIAL_FACT_EVENT_FILE', 'material-fact-event-review.ts']])
  if (process.env[key]) await cp(process.env[key], resolve(temporary, 'lib', file));
const load = file => import(pathToFileURL(resolve(temporary, 'lib', file)).href);
const { normalizeMoneyValueV4: parse, normalizeCandidateValueV4: normalize, classifyMonetaryExpression: classify,
  hasPostposedMoneyUncertainty: postUnknown } = await load('material-money-v4.ts');
const { attachedMoneyQualifierStatus: qualifier } = await load('material-fact-range-review.ts');
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates } = await load('material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('material-fact-source-review.ts');
const AT = '2026-10-18T00:00:00.000Z';
const cpLength = value => Array.from(value).length;

function fixture(expression, { value = '4000元', fullQuote = false, meaning = 'arrears', rateUnit = null, nextBlock = null } = {}) {
  const source = { id: 'round26-author', name: '合成边界与标签回归', sha256: 'a'.repeat(64), analysisRevision: 1, ready: true,
    blocks: [{ id: 'b1', page: 1, text: '😀𠮷王甲工资' + expression + (nextBlock === null ? '。' : ''), bbox: null, confidence: null }] };
  if (nextBlock !== null) source.blocks.push({ id: 'b2', page: 1, text: nextBlock + '。', bbox: null, confidence: null });
  const candidate = { kind: 'money', value, quote: fullQuote ? source.blocks[0].text : value, blockId: 'b1', subject: '王甲', scope: 'individual',
    meaning, completeness: ['due_total', 'paid_total'].includes(meaning) ? 'unknown' : 'not_applicable', period: null, rateUnit, assertion: 'narrated' };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [candidate] });
  return { source, candidate, raw };
}

function pipeline(f, expected) {
  const before = structuredClone(f);
  const fresh = ingestRuntimeCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'round26-author', AT);
  const assertEvidence = fact => {
    assert.deepEqual(fact.representation, f.candidate); assert.equal(fact.value, f.candidate.value); assert.equal(fact.quote, f.candidate.quote);
    const text = f.source.blocks[0].text, start = cpLength(text.slice(0, text.indexOf(f.candidate.quote)));
    assert.equal(fact.start, start); assert.equal(fact.end, start + cpLength(f.candidate.quote));
    assert.equal(Array.from(text).slice(fact.start, fact.end).join(''), f.candidate.quote);
  };
  assert.equal(fresh.materials[0].raw, f.raw); assert.equal(fresh.materials[0].candidates.length, 1);
  assert.equal(fresh.materials[0].candidates[0].amount, expected, 'fresh source defense'); assertEvidence(fresh.materials[0].candidates[0]);
  assert.deepEqual(fresh.confirmations, { due: null, paid: null }); assert.equal(fresh.calculation, null);
  const history = ingestCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'round26-author', AT);
  const fact = history.materials[0].candidates[0]; assert(fact);
  fact.amount = '4000.00'; fact.normalization = { rawValue: fact.value, amount: '4000.00', status: 'exact', matchedText: fact.value,
    span: { start: 0, end: cpLength(fact.value) }, reason: 'Synthetic forced historical exact.' };
  const original = structuredClone(history), reviewed = reviewFactsAgainstSources(history, [f.source]);
  assert.equal(reviewed.materials[0].candidates[0].amount, expected, 'historical exact source defense'); assertEvidence(reviewed.materials[0].candidates[0]);
  assert.deepEqual(history, original); assert.deepEqual(reviewed.history, history.history); assert.equal(reviewed.materials[0].raw, f.raw);
  fact.amount = null; fact.normalization = { rawValue: fact.value, amount: null, status: 'unsupported', matchedText: null, span: null, reason: 'Synthetic historical unavailable.' };
  const unavailable = structuredClone(history);
  assert.equal(reviewFactsAgainstSources(history, [f.source]).materials[0].candidates[0].amount, null, 'no historical upgrade');
  assert.deepEqual(history, unavailable); assert.deepEqual(f, before);
}

const symbols = ['≤', '≥', '<', '>', '≦', '≧', '<=', '>=', '＜', '＞', '＜＝', '＞＝'];
for (const symbol of symbols) test('minimal symbolic bound full and cropped: ' + symbol, () => {
  assert.equal(parse(symbol + '4000元').amount, null, 'full bound cannot be precise');
  assert.equal(normalize(fixture(symbol + '4000元', { fullQuote: true }).candidate).amount, null, 'cropped quote bound');
  assert.equal(qualifier(symbol, ''), 'approximate');
});
for (const symbol of symbols) for (const fullQuote of [false, true])
  test('symbolic source bound retains raw and CP: ' + JSON.stringify({ symbol, fullQuote }), () => pipeline(fixture(symbol + '4000元', { fullQuote }), null));
for (const symbol of ['≤', '≥', '<', '>', '≦', '≧']) for (const layout of ['newline', 'block'])
  test('symbolic bound survives explicit layout: ' + JSON.stringify({ symbol, layout }), () => {
    const f = layout === 'block' ? fixture(symbol, { value: '4000元', nextBlock: '4000元' }) : fixture(symbol + '\n4000元', { fullQuote: true });
    if (layout === 'block') { f.candidate.blockId = 'b2'; f.candidate.quote = '4000元'; f.raw = JSON.stringify({ schemaVersion: 3, candidates: [f.candidate] }); }
    // The block fixture's quote/CP belong to b2, unlike the ordinary helper.
    if (layout === 'block') {
      const fresh = ingestRuntimeCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'round26-author', AT);
      assert.equal(fresh.materials[0].candidates[0].amount, null); assert.equal(fresh.materials[0].raw, f.raw);
      assert.equal(fresh.materials[0].candidates[0].start, 0); assert.equal(fresh.materials[0].candidates[0].quote, '4000元');
    } else pipeline(f, null);
  });
for (const expression of ['≤人民币4000元', '人民币≥4000元', '≥\u200d4000元', '＜\n人民幣四千圓', '4000元≤5000元'])
  test('comparison wrapper and adjacent amount operands stay non-exact: ' + expression, () => assert.equal(parse(expression).amount, null));
for (const tail of ['≤5000元', '≥\n人民币3000元', '<', '>'])
  test('comparison after a cropped endpoint stays non-exact: ' + tail, () => pipeline(fixture('4000元' + tail, { fullQuote: true }), null));
for (const prefix of ['约定为', '最近收到', '不满三个月工资共', '王乙工资≤5000元。王甲工资'])
  test('independent bounded prose cannot attach to this amount: ' + prefix, () => assert.equal(normalize(fixture(prefix + '4000元', { fullQuote: true }).candidate).amount, '4000.00'));

const uncertainTails = ['（金额待核实）', '金额待定', '（数额未知）', '(金額待核实)', '數額不明', '金额：未知', '（金额为待确认）', '金额\n待定'];
for (const tail of uncertainTails) for (const fullQuote of [false, true])
  test('finite amount-label uncertainty bridge: ' + JSON.stringify({ tail, fullQuote }), () => {
    assert.equal(postUnknown(tail), true); pipeline(fixture('4000元' + tail, { fullQuote }), null);
  });
for (const tail of ['（金额待核实）', '數額未知'])
  test('label uncertainty can continue in the next OCR block: ' + tail, () => pipeline(fixture('4000元', { nextBlock: tail }), null));
for (const tail of ['。王乙工资金额待定', '，王乙工资金额未知', '（王乙金额未知）', '金额已确认', '（金额已核实）'])
  test('label bridge is not arbitrary prose: ' + tail, () => assert.equal(postUnknown(tail), false));
for (const terminal of ['', '整', '正']) for (const tail of ['（金额待核实）', '（數額未知）'])
  test('ending cannot hide a labeled uncertainty: ' + JSON.stringify({ terminal, tail }), () => pipeline(fixture('4000元' + terminal + tail, { fullQuote: true }), null));

const units = [['小时', 'hour'], ['月', 'month'], ['日', 'day'], ['天', 'day'], ['时', 'hour'], ['件', 'piece']];
for (const [unit, rateUnit] of units) for (const terminal of ['', '整', '正']) for (const fullQuote of [false, true])
  test('按-unit rate rejects total and preserves a correct rate: ' + JSON.stringify({ unit, terminal, fullQuote }), () => {
    const expression = '4000元' + terminal + '按' + unit + '计';
    const total = fixture(expression, { fullQuote, meaning: 'due_total' });
    assert.equal(normalize({ ...total.candidate, quote: total.source.blocks[0].text }).amount, null, 'total label'); pipeline(total, null);
    const rate = fixture(expression, { fullQuote: true, meaning: 'rate', rateUnit });
    assert.equal(normalize(rate.candidate).amount, '4000.00', 'correct supported rate');
    assert.equal(normalize({ ...rate.candidate, rateUnit: 'unknown' }).amount, '4000.00', 'rate with unresolved supported enum');
    assert.equal(normalize({ ...rate.candidate, rateUnit: rateUnit === 'day' ? 'month' : 'day' }).amount, null, 'wrong enum');
  });
for (const [unit, rateUnit] of units) for (const ending of ['计', '计算', '计酬', '计价', '计薪'])
  test('finite explicit rate ending: ' + unit + ending, () => {
    const c = fixture('4000元按' + unit + ending, { fullQuote: true, meaning: 'rate', rateUnit }).candidate;
    assert.equal(normalize(c).amount, '4000.00'); assert.equal(normalize({ ...c, meaning: 'arrears', rateUnit: null }).amount, null);
  });
for (const [unit, rateUnit] of units.filter(([unit]) => unit !== '时'))
  test('bare supported 按-unit at a clear boundary: ' + unit, () => {
    const c = fixture('4000元按' + unit, { fullQuote: true, meaning: 'rate', rateUnit }).candidate;
    assert.equal(normalize(c).amount, '4000.00'); assert.equal(normalize({ ...c, meaning: 'arrears', rateUnit: null }).amount, null);
  });
for (const tail of ['按时支付', '按时', '按时间顺序', '按月15日发放', '按月计划', '按件计数', '按照约定支付', '。王乙按月计工资', '，王乙按日计'])
  test('ordinary 按 prose does not create a denominator: ' + tail, () => assert.equal(normalize(fixture('4000元' + tail, { fullQuote: true }).candidate).amount, '4000.00'));
for (const [unit, rateUnit] of [['月', 'month'], ['日', 'day'], ['小时', 'hour'], ['件', 'piece']])
  test('established slash and 每 rate remain exact only as rate: ' + unit, () => {
    for (const marker of ['/', '每']) {
      const c = fixture('4000元' + marker + unit, { fullQuote: true, meaning: 'rate', rateUnit }).candidate;
      assert.equal(normalize(c).amount, '4000.00'); assert.equal(normalize({ ...c, meaning: 'arrears', rateUnit: null }).amount, null);
    }
  });

function rejectLabel(value) {
  assert.equal(classify(value).kind, 'not_monetary');
  const f = fixture(value, { value, fullQuote: true });
  const state = ingestRuntimeCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'round26-author', AT);
  assert.equal(state.materials[0].raw, f.raw); assert.equal(state.materials[0].candidates.length, 0); assert.equal(state.materials[0].rejected.length, 1);
}
for (const value of ['實付工資', '工資合計', '薪酬總額', '應付工資合計', '已付工資總額', '本期實付工資', '實付勞務費總額', '工\u200d資合計'])
  test('complete traditional amount-free wage label: ' + value, () => rejectLabel(value));
for (const value of ['人民币', '人民幣', 'RMB', 'CNY', 'rmb', 'cny', '元', '圆', '圓', '￥', '¥', ' 人民币 '])
  test('standalone bounded currency label is not an amount: ' + value, () => rejectLabel(value));
for (const value of ['人民币未知', '人民幣不详', 'RMB待定', '元不明', '￥****', '實付工資待定', '薪酬總額不詳', '人民币四万元', '人民幣四萬圓', '人民币5角', '约4000元', '4000元至5000元'])
  test('unknown, masked and real money are not rejected as empty labels: ' + value, () => {
    assert.notEqual(classify(value).kind, 'not_monetary');
    const f = fixture(value, { value, fullQuote: true });
    const state = ingestRuntimeCandidates(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'round26-author', AT);
    assert.equal(state.materials[0].raw, f.raw); assert.equal(state.materials[0].candidates.length, 1);
  });

// Adjacent variants in the same five bounded grammars; no new material cases.
for (const symbol of symbols) for (const wrapper of ['人民币', '人民幣', 'RMB ', 'CNY ', '￥'])
  test('finite currency wrapper cannot hide a symbolic bound: ' + JSON.stringify({ symbol, wrapper }), () => {
    const expression = symbol + '\u200d\n' + wrapper + '4000元';
    assert.equal(parse(expression).amount, null);
    assert.equal(normalize(fixture(expression, { fullQuote: true }).candidate).amount, null);
  });
for (const prefix of ['≤三个月的工资共', '≥三个月的工资合计', '王乙工资≤5000元。王甲工资', '王乙工资≥5000元，王甲工资'])
  test('comparison of another period or event is not this amount bound: ' + prefix, () => pipeline(fixture(prefix + '4000元', { fullQuote: true }), '4000.00'));
for (const [tail, unit] of [['按小時計', 'hour'], ['按時計', 'hour'], ['按月計價', 'month'], ['按件計酬', 'piece'], ['按\n月计', 'month'], ['按\u200d日计', 'day'], ['按月\n计', 'month'], ['按月计\n', 'month']])
  for (const terminal of ['', '整', '正']) test('traditional/layout 按 branch keeps supported role: ' + JSON.stringify({ tail, terminal }), () => {
    const f = fixture('4000元' + terminal + tail, { fullQuote: true, meaning: 'rate', rateUnit: unit });
    assert.equal(normalize(f.candidate).amount, '4000.00');
    assert.equal(normalize({ ...f.candidate, meaning: 'due_total', completeness: 'unknown', rateUnit: null }).amount, null);
  });
for (const ending of ['整', '正']) for (const continuation of ['按月计5角', '按月计人民币5角', '按月计？', '按月计金额待定', '按月计至5000元', '按月计×2'])
  test('rate-ending exception cannot erase an additional continuation: ' + JSON.stringify({ ending, continuation }), () => {
    const f = fixture('4000元' + ending + continuation, { fullQuote: true, meaning: 'rate', rateUnit: 'month' });
    assert.equal(normalize(f.candidate).amount, null);
  });
for (const terminal of ['', '整', '正']) for (const marker of ['？', '（金额待核实）', '数额未知'])
  test('an explicit supported rate cannot hide a directly labeled uncertainty: ' + JSON.stringify({ terminal, marker }), () => {
    const f = fixture('4000元' + terminal + '按月计' + marker, { fullQuote: true, meaning: 'rate', rateUnit: 'month' });
    assert.equal(normalize(f.candidate).amount, null);
  });
for (const value of ['RMB未知', 'CNY？？', '人民幣數額未知', '人民币（金额待定）', '實付工資约4000元', '薪酬總額4000元'])
  test('bounded noamount classifier leaves additional amount/unknown evidence reviewable: ' + value, () => assert.notEqual(classify(value).kind, 'not_monetary'));
