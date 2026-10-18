// Fixed synthetic ROUND29 author tests. No model, HTTP, build or frozen-data reads.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('../', import.meta.url));
const BASE = resolve(process.env.MATERIAL_FACT_TEST_ROOT || HERE);
const PATCH = resolve(process.env.MATERIAL_FACT_PATCH_ROOT || HERE);
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-traditional-arithmetic-bounds-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(BASE, 'lib'), resolve(temporary, 'lib'), { recursive: true });
await cp(resolve(BASE, 'experiments/material-facts-v7/assess.mjs'), resolve(temporary, 'experiments/material-facts-v7/assess.mjs'), { recursive: true });
if (process.env.MATERIAL_FACT_MONEY_FILE) await cp(process.env.MATERIAL_FACT_MONEY_FILE, resolve(temporary, 'lib/material-money-v4.ts'));
const owned = ['material-fact-arithmetic-review.ts', 'material-fact-range-review.ts', 'material-fact-source-review.ts'];
for (const name of owned) await cp(resolve(PATCH, 'lib', name), resolve(temporary, 'lib', name));
console.log(JSON.stringify({ implementation_sha256: Object.fromEntries(await Promise.all(owned.map(async name => [name,
  createHash('sha256').update(await readFile(resolve(temporary, 'lib', name))).digest('hex')])))}));
const load = name => import(pathToFileURL(resolve(temporary, name)).href);
const { hasAttachedMoneyArithmetic: arithmetic } = await load('lib/material-fact-arithmetic-review.ts');
const { moneyQualifierDetectionView: detection, attachedMoneyQualifierStatus: qualifier, hasMoneyRange } = await load('lib/material-fact-range-review.ts');
const { normalizeMoneyValueV4: normalize, canonicalMonetaryExpression: canonical } = await load('lib/material-money-v4.ts');
const { ingestRuntimeCandidates } = await load('lib/material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates, buildFactView } = await load('lib/material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('lib/material-fact-source-review.ts');
const { assessCase } = await load('experiments/material-facts-v7/assess.mjs');
const cpLength = text => Array.from(text).length;
const AT = '2026-10-18T00:00:00.000Z';
const modes = ['raw_basic', 'accepted_basic', 'raw_relational', 'accepted_relational', 'raw_strict', 'accepted_strict'];
function sourceFor(texts, samePage = false) {
  return { id: 'round29-author', name: '合成传统字形边界.txt', sha256: '9'.repeat(64), analysisRevision: 29, ready: true,
    blocks: texts.map((text, i) => ({ id: `b${i + 1}`, text, page: samePage ? 1 : i + 1, bbox: null, confidence: null })) };
}
function itemFor(value, quote = value, blockId = 'b1') {
  return { kind: 'money', value, quote, blockId, subject: '王甲', scope: 'individual', meaning: 'other_money', completeness: 'not_applicable',
    period: null, rateUnit: null, assertion: 'narrated' };
}
function pipeline({ texts, value = '4000元', quote = value, block = 0, amount = null, storedAmount = '4000.00', meaning = 'other_money', rateUnit = null, status = null, samePage = false }) {
  const source = sourceFor(texts, samePage), item = { ...itemFor(value, quote, `b${block + 1}`), meaning, rateUnit }, raw = JSON.stringify({ schemaVersion: 3, candidates: [item] });
  const fresh = ingestRuntimeCandidates(emptyFactState(29), source, { raw }, 'synthetic', 'author', AT);
  const history = ingestCandidates(emptyFactState(29), source, { raw }, 'synthetic', 'author', AT);
  assert.equal(history.materials[0].candidates.length, 1, 'Historical fixture really enters candidate storage');
  const old = history.materials[0].candidates[0];
  Object.assign(old, { amount: storedAmount, normalization: { rawValue: value, status: 'exact', amount: storedAmount,
    matchedText: value, span: { start: 0, end: cpLength(value) }, reason: 'Synthetic historical exact, never confirmed.' } });
  const before = structuredClone({ history, source });
  const reviewed = reviewFactsAgainstSources(history, [source]);
  assert.deepEqual({ history, source }, before, 'Historical review must not write storage/raw/history/source');
  for (const [name, state] of [['fresh', fresh], ['historical', reviewed]]) {
    const material = state.materials[0]; assert.equal(material.raw, raw); assert.equal(material.candidates.length, 1);
    const fact = material.candidates[0]; assert.equal(fact.amount, amount, `${name}: ${JSON.stringify({ texts, value, quote })}`);
    if (amount === null) assert.notEqual(fact.normalization.status, 'exact');
    if (status) assert.equal(fact.normalization.status, status, `${name}: formula/mask classification`);
    assert.equal(fact.normalization.rawValue, value); assert.deepEqual(fact.representation, item);
    assert.equal(fact.value, value); assert.equal(fact.quote, quote); assert.equal(fact.sourceSha256, source.sha256);
    const at = texts[block].indexOf(quote); assert(at >= 0); assert.equal(texts[block].indexOf(quote, at + 1), -1);
    assert.equal(fact.start, cpLength(texts[block].slice(0, at))); assert.equal(fact.end, fact.start + cpLength(quote));
    assert.equal(Array.from(texts[block]).slice(fact.start, fact.end).join(''), quote);
    assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
    assert.equal(buildFactView(state, [source]).canCalculate, false);
  }
  old.amount = null; old.normalization = { ...old.normalization, status: 'unsupported', amount: null };
  const unavailable = structuredClone(history);
  assert.equal(reviewFactsAgainstSources(history, [source]).materials[0].candidates[0].amount, null, 'Old unavailable value is never upgraded');
  assert.deepEqual(history, unavailable);
}

for (const operand of ['出勤係數', '崗位係數', '核算績效係數', '實際出勤係數', '出勤系數']) {
  test(`attached traditional coefficient detection ${operand}`, () => {
    assert.equal(arithmetic('', `乘以${operand}`), true);
    assert.equal(arithmetic(`${operand}乘以`, ''), true);
    assert.equal(normalize(`四万元乘以${operand}`).amount, null);
    assert.equal(normalize(`${operand}乘以四万元`).amount, null);
  });
  for (const fullValue of [false, true]) for (const fullQuote of [false, true]) test(`coefficient actual pipeline ${operand} valueFull=${fullValue} quoteFull=${fullQuote}`, () => {
    const expression = `4000元乘以${operand}`, text = `😀𠮷。王甲工资${expression}。`, value = fullValue ? expression : '4000元';
    pipeline({ texts: [text], value, quote: fullQuote ? text : value });
  });
}
for (const [left, right] of [['', '乘以出勤係\n數'], ['', '乘以出勤係\u200b數'], ['出勤係\n數乘以', ''], ['崗位係數\u200d乘以', '']])
  test(`coefficient detection-only Unicode/layout ${JSON.stringify([left, right])}`, () => assert.equal(arithmetic(left, right), true));
for (const layout of ['same-line', 'newline', 'next-block']) for (const prefix of [false, true]) for (const fullQuote of [false, true])
  test(`traditional coefficient source edges ${layout} prefix=${prefix} fullQuote=${fullQuote}`, () => {
    let texts, block = 0;
    if (prefix) {
      if (layout === 'next-block') { texts = ['😀王甲工资出勤係數乘以', '4000元。']; block = 1; }
      else texts = [`😀王甲工资出勤係數乘以${layout === 'newline' ? '\n' : ''}4000元。`];
    } else texts = layout === 'next-block' ? ['😀王甲工资4000元', '乘以出勤係數。'] : [`😀王甲工资4000元${layout === 'newline' ? '\n' : ''}乘以出勤係數。`];
    pipeline({ texts, samePage: layout === 'next-block', block, quote: fullQuote ? texts[block] : '4000元' });
  });

// Every existing prefix/suffix whose customary traditional spelling differs.
// Different bounds are not collapsed together: only detection glyphs fold.
const prefixPairs = [['不得少于', '不得少於'], ['不得低于', '不得低於'], ['不得超过', '不得超過'], ['不得高于', '不得高於'],
  ['不超过', '不超過'], ['不少于', '不少於'], ['不低于', '不低於'], ['不高于', '不高於'], ['不多于', '不多於'],
  ['不大于', '不大於'], ['不小于', '不小於'], ['不满', '不滿'], ['未满', '未滿'], ['低于', '低於'], ['高于', '高於'],
  ['多达', '多達'], ['少于', '少於'], ['多于', '多於'], ['大于', '大於'], ['小于', '小於'], ['未达', '未達'],
  ['大约', '大約'], ['约', '約'], ['将近', '將近'], ['超过', '超過']];
const suffixPairs = [['不满', '不滿'], ['未满', '未滿'], ['未达', '未達'], ['开外', '開外'], ['以内', '以內'], ['之内', '之內'],
  ['内', '內'], ['封顶', '封頂'], ['出头', '出頭'], ['有余', '有餘'], ['余', '餘'], ['许', '許']];
for (const [simple, traditional] of prefixPairs) test(`existing bound prefix simplified/traditional ${simple}/${traditional}`, () => {
  assert.equal(detection(traditional), simple); assert.equal(qualifier(traditional, ''), 'approximate');
  assert.equal(qualifier(traditional, ''), qualifier(simple, ''));
  assert.equal(normalize(`${traditional}4000元`).amount, null); assert.equal(normalize(`${simple}4000元`).amount, null);
  pipeline({ texts: [`😀王甲工资${traditional}4000元。`] });
});
for (const [simple, traditional] of suffixPairs) test(`existing bound suffix simplified/traditional ${simple}/${traditional}`, () => {
  assert.equal(detection(traditional), simple); assert.equal(qualifier('', traditional), 'approximate');
  assert.equal(qualifier('', traditional), qualifier('', simple));
  assert.equal(normalize(`4000元${traditional}`).amount, null); pipeline({ texts: [`😀王甲工资4000元${traditional}。`] });
});
for (const bound of ['超過', '不超過', '不得超過', '將近']) for (const fullValue of [false, true]) for (const fullQuote of [false, true])
  test(`bound actual whole/cropped value and quote ${bound} valueFull=${fullValue} quoteFull=${fullQuote}`, () => {
    const expression = `${bound}4000元`, text = `😀𠮷。王甲工资${expression}。`, value = fullValue ? expression : '4000元';
    pipeline({ texts: [text], value, quote: fullQuote ? text : value });
  });
for (const bound of ['超過', '不超過', '不得超過', '將近']) for (const layout of ['newline', 'next-block', 'format'])
  test(`bound stays attached through permitted layout ${bound} ${layout}`, () => {
    const texts = layout === 'next-block' ? [`😀王甲工资${bound}`, '4000元。'] : [`😀王甲工资${bound}${layout === 'newline' ? '\n' : '\u200b'}4000元。`];
    pipeline({ texts, samePage: layout === 'next-block', block: layout === 'next-block' ? 1 : 0 });
  });
for (const [simple, traditional] of [['不超过', '不超過'], ['超过', '超過'], ['将近', '將近']])
  test(`bound-spelled range endpoints remain ranges ${traditional}`, () => {
    const expression = `${traditional}4000元至5000元`;
    assert.equal(hasMoneyRange(expression), true); assert.equal(normalize(expression).status, 'range');
    assert.equal(hasMoneyRange(expression), hasMoneyRange(`${simple}4000元至5000元`));
    pipeline({ texts: [`😀王甲工资${traditional}4000元至5000元。`], value: '5000元', storedAmount: '5000.00' });
  });

for (const expression of ['4000元，王乙出勤係數为二', '4000元。出勤係數乘以二', '4000元，王乙工资超過5000元',
  '4000元。王乙工资將近5000元', '4000元。超過三天后王乙任职', '4000元以下列方式支付', '4000元以上海银行卡支付',
  '4000元以內部转账支付', '4000元/年', '4000元/件']) test(`independent prose or true rate does not become attached math/bound ${expression}`, () => {
  // The literal /年 denominator is intentionally unsupported; it must not be
  // mistaken for arithmetic. /件 remains a rate only with its declared enum.
  assert.equal(arithmetic('', expression.slice('4000元'.length)), false);
  if (expression.endsWith('/年') || expression.endsWith('/件')) return;
  pipeline({ texts: [`😀王甲工资${expression}。`], amount: '4000.00' });
});
for (const [before, after] of [['', '出勤係數'], ['', '，乘以出勤係數'], ['出勤係數，乘以', ''], ['王乙超過三天，', ''], ['', '，不超過五天后支付']])
  test(`finite attachment does not cross prose ${JSON.stringify([before, after])}`, () => {
    assert.equal(arithmetic(before, after), false); assert.equal(qualifier(before, after), null);
  });

for (const [expression, second] of [['4000元乘以出勤係數', '王甲收到4000元。'], ['超過4000元', '王甲收到4000元。']])
  test(`an equal value in another event cannot earn any six-layer true positive: ${expression}`, () => {
    const source = sourceFor([`😀王甲工资${expression}。`, second]);
    const candidate = itemFor('4000元', source.blocks[0].text), expected = itemFor('4000元', second, 'b2');
    const start = cpLength(second.slice(0, second.indexOf('4000元')));
    const label = { id: 'round29-separate-events', expected: [expected], expected_event_ids: ['payment'], events: [
      { id: 'first', anchors: [{ blockId: 'b1', start: cpLength(source.blocks[0].text.slice(0, source.blocks[0].text.indexOf('4000元'))), end: cpLength(source.blocks[0].text.slice(0, source.blocks[0].text.indexOf('4000元'))) + 5 }] },
      { id: 'payment', anchors: [{ blockId: 'b2', start, end: start + 5 }] }] };
    const report = assessCase({ id: label.id, source }, label, { finish_reason: 'stop', raw_output: JSON.stringify({ schemaVersion: 3, candidates: [candidate] }) });
    assert(report.protocol); for (const mode of modes) assert.deepEqual([report[mode].tp, report[mode].fp, report[mode].fn], [0, 1, 1], mode);
    assert.equal(report.production_defense[0].amount, null); assert.equal(report.production_defense[0].calculation_authorized, false);
  });

for (const [simple, traditional] of [['超过', '超過'], ['不超过', '不超過'], ['不得超过', '不得超過']])
  test(`comparison preserves the same qualifier and numeric equivalence ${traditional}`, () => {
    assert.notEqual(canonical(`${traditional}四万元`), null);
    assert.equal(canonical(`${traditional}四万元`), canonical(`${simple}40000元`));
    assert.notEqual(canonical(`${traditional}四万元`), canonical('40000元'));
    assert.notEqual(canonical('不超過四万元'), canonical('超過四万元'));
  });
for (const suffix of ['每月15日支付', '每月第十五日发放', '每月31号给付', '每月1日付清', '每月十五日發薪', '每月第３１號發放'])
  for (const fullQuote of [false, true]) test(`a finite recurring payment date is not a monthly amount rate ${suffix} fullQuote=${fullQuote}`, () => {
    const text = `😀王甲工资4000元${suffix}。`;
    pipeline({ texts: [text], quote: fullQuote ? text : '4000元', amount: '4000.00' });
  });
for (const texts of [['😀王甲工资4000元', '每月15日支付。'], ['😀王甲工资4000元每月', '15日支付。'],
  ['😀王甲工资4000元每月\n15日支付。'], ['😀王甲工资4000元每\n月15日支付。']])
  test(`payment schedule source-layout boundary ${JSON.stringify(texts)}`, () => pipeline({ texts, samePage: true, amount: '4000.00' }));
for (const suffix of ['每月计', '每月32日支付', '每月0日支付', '每月15日', '每月15日王乙支付', '/月15日支付'])
  test(`a true rate or unproved date cannot use the schedule exception ${suffix}`, () => pipeline({ texts: [`😀王甲工资4000元${suffix}。`] }));
for (const [text, rateUnit] of [['😀王甲月工资4000元每月15日支付。', null], ['😀王甲工资4000元/月。', 'month'],
  ['😀王甲工资4000元/件。', 'piece']]) test(`actual wage standards and declared rates remain intact ${text}`, () =>
    pipeline({ texts: [text], meaning: rateUnit ? 'rate' : 'other_money', rateUnit, amount: rateUnit ? '4000.00' : null }));

for (const texts of [['😀王甲工资4000元每月15日支付5000元。'], ['😀王甲工资4000元每月', '15日支付5000元。'],
  ['😀王甲工资4000元每月', '15日王乙支付。'], ['😀王甲工资4000元每月', '未知日支付。'],
  ['😀王甲工资4000元每月', '15日发票。'], ['😀王甲工资4000元每月', '15日支付?。'],
  ['😀王甲工资4000元每月', '15日支付待確認。'], ['😀王甲工资4000元每月', '15日支付（金额待核实）。'],
  ['😀王甲月工资4000元每月', '15日支付。'], ['😀王甲工资4000元/月', '15日支付。']])
  test(`schedule closure cannot hide another amount, owner, uncertainty or real rate ${JSON.stringify(texts)}`, () => pipeline({ texts, samePage: true }));

// ROUND29 classification closure: a local clause ending at × must not erase
// the operand on the next line/block. A bare mask stays uncertain, not a formula.
for (const texts of [['😀王甲工资4000元×\n2。'], ['😀王甲工资4000元×', '2。'],
  ['😀王甲工资4000元x\n2。'], ['😀王甲工资4000元＊', '２。']])
  for (const quote of ['4000元', '4000元' + texts[0].split('4000元')[1]])
    test(`proven source-layout arithmetic keeps unsupported classification ${JSON.stringify(texts)} quote=${JSON.stringify(quote)}`, () =>
      pipeline({ texts, samePage: true, quote, status: 'unsupported' }));
for (const texts of [['😀王甲工资4000元×。'], ['😀王甲工资4000元×', '王乙2日收到工资。'],
  ['😀王甲工资4000元不詳。'], ['😀王甲工资4000元暫', '定。']])
  test(`a bare mask or actual unknown is not exempted as arithmetic ${JSON.stringify(texts)}`, () =>
    pipeline({ texts, samePage: true, status: 'uncertain' }));

// Keep the pre-existing HTTP range/incomplete-endpoint contract. These are not
// the multiplication-mask truncation that permits the source classification fix.
for (const [tail, status] of [['-2000', 'uncertain'], ['-200元', 'range']])
  test(`original HTTP arithmetic-range classification ${tail}`, () =>
    pipeline({ texts: [`测试王甲工资4000元${tail}。`], status }));
