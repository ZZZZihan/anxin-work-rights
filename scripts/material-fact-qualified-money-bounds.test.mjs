import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const IMPLEMENTATION = fileURLToPath(new URL('../', import.meta.url));
const BASE = resolve(process.env.V7_BASELINE_ROOT || IMPLEMENTATION);
const temp = await mkdtemp(resolve(tmpdir(), 'anxin-qualified-money-bounds-'));
after(() => rm(temp, { recursive: true, force: true }));
await cp(resolve(BASE, 'lib'), resolve(temp, 'lib'), { recursive: true });
for (const [name, override] of [['material-money-v4.ts', process.env.V7_MONEY_TEST_FILE], ['material-fact-range-review.ts', process.env.V7_RANGE_TEST_FILE]]) {
  const file = resolve(override || resolve(IMPLEMENTATION, 'lib', name));
  await cp(file, resolve(temp, 'lib', name));
  console.log(JSON.stringify({ file: name, sha256: createHash('sha256').update(await readFile(file)).digest('hex') }));
}
const load = name => import(pathToFileURL(resolve(temp, 'lib', name)).href);
const { normalizeMoneyValueV4: money, normalizeCandidateValueV4: normalize, canonicalMonetaryExpression: canonical } = await load('material-money-v4.ts');
const qualifierHelpers = await load('material-fact-range-review.ts');
const { ingestRuntimeCandidates: fresh } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates: legacy } = await load('material-facts-v3.ts');
const { reviewFactsAgainstSources: review } = await load('material-fact-source-review.ts');
const cpLength = value => Array.from(value).length;
function fixture(expression, value = expression) {
  const prefix = '😀𠮷王甲工资';
  const source = { id: 'round15-qualified-money', name: 'synthetic-qualified-money', sha256: 'c'.repeat(64), ready: true, analysisRevision: 15,
    blocks: [{ id: 'b1', page: 1, text: prefix + expression + '。', bbox: null, confidence: null }] };
  const candidate = { kind: 'money', value, quote: value, blockId: 'b1', subject: '王甲', scope: 'individual',
    meaning: 'arrears', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: [candidate] });
  return { source, candidate, raw, prefix, expression };
}
function ingest(f, old = false) {
  const before = structuredClone(f.source);
  const state = (old ? legacy : fresh)(emptyFactState(15), f.source, { raw: f.raw }, 'round15-author', 'synthetic', '2026-10-18T00:00:00Z');
  assert.deepEqual(f.source, before);
  assert.equal(state.materials[0].raw, f.raw);
  assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
  assert.equal(state.materials[0].candidates.length, 1);
  const fact = state.materials[0].candidates[0], quoteAt = f.source.blocks[0].text.indexOf(f.candidate.quote);
  assert.deepEqual(fact.representation, f.candidate);
  assert.equal(fact.start, cpLength(f.source.blocks[0].text.slice(0, quoteAt)));
  assert.equal(fact.end, cpLength(f.source.blocks[0].text.slice(0, quoteAt + f.candidate.quote.length)));
  return state;
}
function unavailable(expression, value, status) {
  const f = fixture(expression, value), normalized = normalize({ ...f.candidate, quote: f.source.blocks[0].text });
  assert.equal(normalized.amount, null);
  assert.equal(normalized.normalization.rawValue, value);
  if (status) assert.equal(normalized.normalization.status, status);
  assert.equal(ingest(f).materials[0].candidates[0].amount, null);
  const old = ingest(f, true), fact = old.materials[0].candidates[0];
  Object.assign(fact, { amount: money(value).amount || '40000.00', normalization: money(value) });
  const before = structuredClone(old), reviewed = review(old, [f.source]);
  assert.equal(reviewed.materials[0].candidates[0].amount, null);
  assert.equal(reviewed.materials[0].raw, f.raw); assert.deepEqual(old, before);
}

const prefixes = ['不满', '未满', '低于', '高于', '多达', '少于', '多于', '大于', '小于', '未达',
  '不滿', '未滿', '低於', '高於', '多達', '少於', '多於', '未達', '不低於', '不高於',
  '不足', '不低于', '不高于', '不超过', '不少于', '约', '約'];
for (const prefix of prefixes) {
  test('whole bound stays non-exact: ' + prefix, () => {
    const value = prefix + '四万元', normalized = money(value);
    assert.equal(normalized.amount, null); assert.equal(normalized.status, 'approximate');
    assert.equal(normalized.rawValue, value); assert.notEqual(canonical(value), 'exact:40000.00');
  });
  test('cropped bound stays non-exact in quote, source and history: ' + prefix, () => unavailable(prefix + '四万元', '四万元', 'approximate'));
}
for (const suffix of ['以内', '以內', '以外', '封顶', '封頂', '以上', '以下', '左右', '上下', '有餘', '出頭', '許']) {
  test('whole and cropped suffix bound stay non-exact: ' + suffix, () => {
    assert.equal(money('四万元' + suffix).amount, null);
    unavailable('四万元' + suffix, '四万元', 'approximate');
  });
}
for (const [expression, value] of [
  ['3万余元至4万元', '4万元'], ['3万元左右至4万元', '4万元'], ['3万元至约4万元', '3万元'],
  ['3万餘元至4万元', '4万元'], ['3萬元左右至4万元', '4万元'], ['3万元至約4万元', '3万元'],
  ['人民币3万元左右至人民币4万元', '人民币4万元'], ['3万元至人民币约4万元', '3万元'],
  ['3万元至约人民币4万元', '3万元'], ['3万元以上至4万元以下', '4万元'], ['不满3万元至不超过4万元', '3万元'],
  ['三万余元至四万元', '四万元'], ['三万元左右至四万元', '四万元'], ['三万元至约四万元', '三万元'],
  ['3万元左\u200d右至4万元', '4万元'], ['3万元至约４万元', '3万元'], ['３万元左右至4万元', '4万元'],
  ['3万元 左右 至 约 4万元', '3万元'], ['3万元左右和约4万元之间', '4万元'], ['介于3万余元与约4万元之间', '4万元'],
  ['3万元至约4万余', '3万元'], ['3万元至约4万左右', '3万元'], ['3万元至不满4万餘', '3万元'],
  ['30000人民币至40000人民币', '30000'], ['30000CNY至40000RMB', '40000'],
  ['30000人民币左右至约40000人民币', '30000'], ['3万元至RMB40000', '3万元'], ['3万元至RMB40000', '40000'],
  ['30000元人民币至40000元人民币', '30000元'], ['30000元人民币至40000元人民币', '40000元'],
  ['30000元人民币左右至约40000元人民币', '30000元'], ['30000元人民币左右至约40000元人民币', '40000元'],
]) test('a qualified monetary range cannot lend either endpoint as a precise value: ' + expression + ' -> ' + value, () => {
  assert.equal(money(expression).amount, null); assert.equal(money(expression).status, 'range');
  unavailable(expression, value, 'range');
});
for (const [expression, value] of [['3万元至约4', '3万元'], ['3万元至不满4', '3万元']])
  test('an unfinished qualified numeric endpoint remains unavailable, without pretending it has a money unit: ' + expression, () => unavailable(expression, value, 'uncertain'));
for (const [expression, value, status] of [
  ['不满\n四万元', '四万元', 'approximate'], ['未滿 \n四万元', '四万元', 'approximate'],
  ['低於\u200d\n人民币四万元', '人民币四万元', 'approximate'], ['多\u200d达 四万元', '四万元', 'approximate'],
  ['四万元\n以内', '四万元', 'approximate'], ['3万余元至\n4万元', '4万元', 'range'],
  ['3万元左右\n至约4万元', '4万元', 'range'], ['3万元\n至\n約4万元', '3万元', 'range'],
  ['3万元至\n约4万余', '3万元', 'range'], ['3万元至\n约4', '3万元', 'uncertain'],
]) test('an explicit continuation in a unique full quote survives layout without changing raw offsets: ' + JSON.stringify(expression), () => {
  // The caller that reconstructs full source/adjacent-block edges is covered
  // separately by source-review's owner; this is the V4 full-quote contract.
  const f = fixture(expression, value), before = structuredClone(f.candidate);
  const normalized = normalize({ ...f.candidate, quote: f.source.blocks[0].text });
  assert.equal(normalized.amount, null); assert.equal(normalized.normalization.status, status);
  assert.equal(normalized.normalization.rawValue, value); assert.deepEqual(f.candidate, before);
});
for (const expression of ['最近四万元', '约定四万元', '四万元至2024年7月', '四万元至4个月',
  '四万元至约4个月', '四万元至不满4天', '三万元左右，另付四万元', '三万元左右。王甲另付四万元',
  '三万元左右至2024年工资四万元', '三万元左右至王甲另付四万元'])
  test('date, duration, normal wording and independent payments do not taint the current event: ' + expression, () => {
    const f = fixture(expression, '四万元'), full = normalize({ ...f.candidate, quote: f.source.blocks[0].text });
    assert.equal(full.amount, '40000.00'); assert.equal(ingest(f).materials[0].candidates[0].amount, '40000.00');
  });
for (const expression of ['约定\n四万元', '最近\n四万元', '不满\n王甲工资四万元',
  '低于。王甲工资四万元', '3万元左右。王甲工资四万元', '3万元至\n约4个月，另付四万元'])
  test('ordinary wording or a new subject/clause cannot become an explicit layout continuation: ' + JSON.stringify(expression), () => {
    const f = fixture(expression, '四万元');
    assert.equal(normalize({ ...f.candidate, quote: f.source.blocks[0].text }).amount, '40000.00');
  });
for (const prefix of ['不满', '未满', '低于', '高于', '多达'])
  test('a bound on employment duration cannot qualify a later exact wage: ' + prefix, () => {
    const expression = prefix + '三个月的工资合计四万元', normalization = money(expression);
    assert.equal(normalization.amount, '40000.00'); assert.equal(normalization.rawValue, expression);
    assert.equal(normalization.matchedText, '四万元');
    assert.deepEqual(normalization.span, { start: cpLength(expression.slice(0, expression.indexOf('四万元'))), end: cpLength(expression) });
    const f = fixture(expression, '四万元');
    assert.equal(normalize({ ...f.candidate, quote: f.source.blocks[0].text }).amount, '40000.00');
    assert.equal(ingest(f).materials[0].candidates[0].amount, '40000.00');
  });
for (const marker of ['人民币', '人民幣', 'RMB', 'CNY', 'rmb', 'cny', '¥', '￥', 'ＲＭＢ', 'ＣＮＹ']) {
  for (const expression of ['不满' + marker + '四万元', marker + '不满四万元', '四万元' + marker + '以内'])
    test('a finite RMB wrapper cannot hide the attached bound: ' + expression, () => {
      assert.equal(money(expression).amount, null);
      unavailable(expression, '四万元', expression.startsWith('四万元') && /[¥￥]/u.test(marker) ? 'unsupported' : 'approximate');
    });
  test('a suffix RMB marker and bound cannot be clipped from a bare numeric value: ' + marker, () => unavailable('40000' + marker + '以内', '40000', /[¥￥]/u.test(marker) ? 'unsupported' : 'approximate'));
  for (const expression of [marker + '3万元左右至约' + marker + '4万元', '30000元' + marker + '左右至约40000元' + marker]) {
    const values = expression.startsWith('30000') ? ['30000元', '40000元'] : ['3万元', '4万元'];
    for (const value of values)
      test('both range endpoints retain the finite RMB wrapper and bound: ' + expression + ' -> ' + value, () => unavailable(expression, value, expression.startsWith('30000') && /[¥￥]/u.test(marker) ? 'unsupported' : 'range'));
  }
}
for (const marker of ['元', '圆', '圓', '元人民币', '元人民幣', '元RMB', '圓CNY', '圆¥'])
  test('a unit with at most two RMB wrappers and bound cannot be clipped from a bare numeric value: ' + marker, () => unavailable('40000' + marker + '以内', '40000', /[¥￥]/u.test(marker) ? 'unsupported' : 'approximate'));
for (const expression of ['低於工資四万元', '高於稅後四万元', '多達應付四万元', '不滿薪資四万元', '低於金額四万元', '未滿款項四万元'])
  test('traditional forms of the existing finite wage bridge cannot conceal a bound: ' + expression, () => {
    assert.equal(money(expression).amount, null); unavailable(expression, '四万元', 'approximate');
  });
for (const expression of ['最近CNY四万元', '约定RMB四万元', '四万元人民币，另付车费', '不满工資。王甲工资四万元'])
  test('an RMB wrapper does not turn ordinary wording or an independent clause into a bound: ' + expression, () => {
    const f = fixture(expression, '四万元');
    assert.equal(normalize({ ...f.candidate, quote: f.source.blocks[0].text }).amount, '40000.00');
  });
for (const [prefix, value, status] of [
  ['负', '四万元', 'unsupported'], ['負數', '四万元', 'unsupported'], ['负值', '四万元', 'unsupported'],
  ['正数', '四万元', 'unsupported'], ['正值', '四万元', 'unsupported'], ['+', '四万元', 'unsupported'], ['－', '四万元', 'unsupported'],
  ['数', '十万元', 'approximate'], ['數', '十万元', 'approximate'], ['几', '十万元', 'approximate'], ['幾', '十万元', 'approximate'],
]) {
  const expression = prefix + '\n' + value;
  test('existing sign or indefinite prefix survives explicit layout in a whole value: ' + JSON.stringify(expression), () => {
    assert.equal(money(expression).amount, null); assert.equal(money(expression).status, status);
    assert.equal(money(expression).rawValue, expression);
  });
  test('existing sign or indefinite prefix survives explicit layout in a unique full quote: ' + JSON.stringify(expression), () => {
    const f = fixture(expression, value), before = structuredClone(f.candidate);
    const normalized = normalize({ ...f.candidate, quote: f.source.blocks[0].text });
    assert.equal(normalized.amount, null); assert.equal(normalized.normalization.status, status);
    assert.equal(normalized.normalization.rawValue, value); assert.deepEqual(f.candidate, before);
  });
}
for (const expression of ['负\n人民币四万元', '負數：\nＲＭＢ四万元', '数\nCNY十万元', '幾\u200d\n￥十万元'])
  test('an existing modifier, finite currency and layout cannot expose an unsigned tail: ' + JSON.stringify(expression), () => {
    const value = expression.includes('十万元') ? '十万元' : '四万元', f = fixture(expression, value);
    assert.equal(money(expression).amount, null);
    assert.equal(normalize({ ...f.candidate, quote: f.source.blocks[0].text }).amount, null);
  });
for (const expression of ['负。王甲工资四万元', '负\n王甲工资四万元', '数\n王甲工资四万元', '负三个月\n工资四万元', '几个月\n工资四万元'])
  test('sign or indefinite prefixes cannot cross a subject, numeral or independent sentence: ' + JSON.stringify(expression), () => {
    const f = fixture(expression, '四万元');
    assert.equal(normalize({ ...f.candidate, quote: f.source.blocks[0].text }).amount, '40000.00');
  });
test('the exported qualifier status preserves signed versus approximate and boolean compatibility', () => {
  for (const [before, after, expected] of [
    ['工资负\n', '', 'unsupported'], ['工资負數：\nＲＭＢ', '', 'unsupported'], ['工资数\n', '', 'approximate'],
    ['工资不满RMB', '', 'approximate'], ['', '元人民币以内', 'approximate'], ['负。王甲工资', '', null], ['数\n王甲工资', '', null],
  ]) {
    assert.equal(qualifierHelpers.attachedMoneyQualifierStatus(before, after), expected);
    assert.equal(qualifierHelpers.hasAttachedMoneyQualifier(before, after), expected !== null);
  }
});
test('new detection never upgrades already unavailable historical money', () => {
  const f = fixture('四万元'), state = ingest(f, true), fact = state.materials[0].candidates[0];
  Object.assign(fact, { amount: null, normalization: { rawValue: '四万元', status: 'unsupported', amount: null, matchedText: null, span: null, reason: 'Synthetic unavailable history.' } });
  const before = structuredClone(state), reviewed = review(state, [f.source]);
  assert.equal(reviewed.materials[0].candidates[0].amount, null); assert.deepEqual(state, before);
});
