import test from 'node:test';
import assert from 'node:assert/strict';

// Independent synthetic contract. This file was drafted before the v7 assessor
// implementation or new model answers were read. It never changes frozen v6
// code, labels, answers, or reports. Set MATERIAL_FACTS_ASSESSOR=../experiments/
// material-facts-v6/assess.mjs to reproduce the old assessor's red behavior.
const assessorUrl = new URL(process.env.MATERIAL_FACTS_ASSESSOR ?? '../experiments/material-facts-v7/assess.mjs', import.meta.url);
const { assessCase } = await import(assessorUrl.href);

const MODES = ['raw_basic', 'raw_relational', 'raw_strict', 'accepted_basic', 'accepted_relational', 'accepted_strict'];
const counts = row => [row.tp, row.fp, row.fn];
const codePoints = text => Array.from(text).length;
function occurrences(text, value) {
  const found = [];
  for (let start = text.indexOf(value); start >= 0; start = text.indexOf(value, start + 1)) {
    found.push({ start: codePoints(text.slice(0, start)), end: codePoints(text.slice(0, start + value.length)) });
  }
  return found;
}
function anchor(block, value, occurrence = 0) {
  const positions = occurrences(block.text, value);
  assert.ok(positions[occurrence], `missing fixture occurrence ${occurrence} for ${value}`);
  return { blockId: block.id, ...positions[occurrence] };
}
const event = (id, ...anchors) => ({ id, anchors });
const block = (id, text) => ({ id, page: 1, text });
const money = (quote, overrides = {}) => ({
  kind: 'money', value: '105.7万元', quote, blockId: 'b1', subject: null, scope: 'unknown',
  meaning: 'payment', completeness: 'partial', period: null, rateUnit: null, assertion: 'narrated', ...overrides,
});
function fixture(blocks, expected, events, expected_event_ids) {
  const input = { id: 'independent-v7-synthetic', source: {
    id: 'independent-v7-source', name: 'synthetic.txt', sha256: 'a'.repeat(64),
    analysisRevision: 1, ready: true, blocks,
  } };
  return { input, label: { id: input.id, schemaVersion: 3, label_status: 'provisional_non_expert', expected, events, expected_event_ids, acceptable_alternatives: [] } };
}
function run(fx, candidates, { finish_reason = 'stop', top = {} } = {}) {
  const result = { id: fx.input.id, finish_reason, raw_output: JSON.stringify({ schemaVersion: 3, candidates, ...top }) };
  const before = structuredClone({ ...fx, result });
  const row = assessCase(fx.input, fx.label, result);
  assert.deepEqual({ ...fx, result }, before, 'assessment must preserve source, labels, and first raw output');
  return row;
}
function expectAll(row, expected) {
  for (const mode of MODES) assert.deepEqual(counts(row[mode]), expected, mode);
}
function expectRawRejected(row, count = 1, expected = 1) {
  for (const mode of MODES.filter(mode => mode.startsWith('raw_'))) assert.deepEqual(counts(row[mode]), [0, count, expected], mode);
  for (const mode of MODES.filter(mode => mode.startsWith('accepted_'))) assert.deepEqual(counts(row[mode]), [0, 0, expected], mode);
  assert.equal(row.raw_count, count);
  assert.equal(row.accepted_count, 0);
  assert.equal(row.exact_document, false);
}

const sale = '甲厂变卖资产105.7万元。';
const wage = '随后向工人发放工资105.7万元。';
const both = block('b1', sale + wage);
const wageExpected = money(wage);
const base = fixture([both], [wageExpected], [event('sale', anchor(both, '105.7万元', 0)), event('wage', anchor(both, '105.7万元', 1))], ['wage']);

test('all six layers require the same source event, including basic', () => {
  const row = run(base, [money(sale)]);
  expectAll(row, [0, 1, 1]);
  assert.equal(row.raw_count, 1);
  assert.equal(row.accepted_count, 1, 'valid protocol and wrong source event are distinct');
  assert.equal(row.exact_document, false);
});

test('the correct second occurrence matches; first-index location is forbidden', () => {
  expectAll(run(base, [wageExpected]), [1, 0, 0]);
});

test('a whole paragraph containing two equal amounts from different events is ambiguous', () => {
  expectAll(run(base, [money(both.text)]), [0, 1, 1]);
});

test('a bare amount quote repeated at two source locations cannot borrow the first location', () => {
  expectAll(run(base, [money('105.7万元')]), [0, 1, 1]);
});

test('unannotated repeated locations remain unresolved rather than disappearing', () => {
  const fx = fixture([both], [wageExpected], [event('wage', anchor(both, '105.7万元', 1))], ['wage']);
  expectAll(run(fx, [money('105.7万元')]), [0, 1, 1]);
});

test('a whole paragraph with a unique matching value is usable evidence', () => {
  const one = block('b1', '甲厂处置旧物。向工人发放工资105.7万元。手续完毕。');
  const fx = fixture([one], [money('向工人发放工资105.7万元。')], [event('wage', anchor(one, '105.7万元'))], ['wage']);
  expectAll(run(fx, [money(one.text)]), [1, 0, 0]);
});

test('identical words in another block cannot match the expected block event', () => {
  const a = block('b1', '第一笔：发放105.7万元。');
  const b = block('b2', '第二笔：发放105.7万元。');
  const expected = money('发放105.7万元。', { blockId: 'b2' });
  const fx = fixture([a, b], [expected], [event('first', anchor(a, '105.7万元')), event('second', anchor(b, '105.7万元'))], ['second']);
  expectAll(run(fx, [money('发放105.7万元。')]), [0, 1, 1]);
  expectAll(run(fx, [expected]), [1, 0, 0]);
});

test('a quote assembled across blocks is invalid and remains a raw false positive', () => {
  const a = block('b1', '甲厂准备工资');
  const b = block('b2', '105.7万元。');
  const expected = money(b.text, { blockId: 'b2' });
  const fx = fixture([a, b], [expected], [event('wage', anchor(b, '105.7万元'))], ['wage']);
  expectRawRejected(run(fx, [money(a.text + b.text)]));
});

test('multiple identical source occurrences may match only when all belong to the same registered event', () => {
  const repeated = block('b1', '工资发放105.7万元。材料重复记载：工资发放105.7万元。');
  const expected = money('工资发放105.7万元。');
  const fx = fixture([repeated], [expected], [event('one-payment', anchor(repeated, '105.7万元', 0), anchor(repeated, '105.7万元', 1))], ['one-payment']);
  expectAll(run(fx, [expected]), [1, 0, 0]);
  expectAll(run(fx, [money(repeated.text)]), [1, 0, 0]);
});

test('source anchor offsets are Unicode code points even after astral and combining characters', () => {
  const unicode = block('b1', `😀𠮷e\u0301${sale}${wage}`);
  const fx = fixture([unicode], [wageExpected], [event('sale', anchor(unicode, '105.7万元', 0)), event('wage', anchor(unicode, '105.7万元', 1))], ['wage']);
  assert.equal(fx.label.events[0].anchors[0].start, codePoints('😀𠮷e\u0301甲厂变卖资产'));
  expectAll(run(fx, [wageExpected]), [1, 0, 0]);
  expectAll(run(fx, [money(sale)]), [0, 1, 1]);
});

test('registered containment supports a literal currency prefix within the same event', () => {
  const prefixed = block('b1', '向工人发放人民币1000元。');
  const expected = money(prefixed.text, { value: '1000元' });
  const fx = fixture([prefixed], [expected], [event('wage', anchor(prefixed, '1000元'))], ['wage']);
  expectAll(run(fx, [money(prefixed.text, { value: '人民币1000元' })]), [1, 0, 0]);
});

test('event identity does not use a self-reported subject to resolve a two-event quote', () => {
  const people = block('b1', '张三收到工资105.7万元。李四收到工资105.7万元。');
  const expected = money('张三收到工资105.7万元。', { subject: '张三', scope: 'individual' });
  const fx = fixture([people], [expected], [event('zhang', anchor(people, '105.7万元', 0)), event('li', anchor(people, '105.7万元', 1))], ['zhang']);
  expectAll(run(fx, [money(people.text, { subject: '张三', scope: 'individual' })]), [0, 1, 1]);
});

test('a party admission cannot impersonate a later same-value court order by self-reporting decided', () => {
  const admission = '甲公司承认应付张三1000元。';
  const judgment = '法院判令支付张三1000元。';
  const b = block('b1', admission + judgment);
  const expected = money(judgment, { value: '1000元', subject: '张三', scope: 'individual', meaning: 'award', completeness: 'not_applicable', assertion: 'decided' });
  const fx = fixture([b], [expected], [event('admission', anchor(b, '1000元', 0)), event('court-order', anchor(b, '1000元', 1))], ['court-order']);
  expectAll(run(fx, [{ ...expected, quote: admission }]), [0, 1, 1]);
  expectAll(run(fx, [expected]), [1, 0, 0]);
});

for (const [name, mutate] of [
  ['missing quote', candidate => { delete candidate.quote; }],
  ['missing blockId', candidate => { delete candidate.blockId; }],
  ['missing required rateUnit', candidate => { delete candidate.rateUnit; }],
  ['extra field', candidate => { candidate.confirmed = true; }],
  ['invalid scope enum', candidate => { candidate.scope = 'workers'; }],
  ['invalid payment completeness', candidate => { candidate.completeness = 'complete'; }],
  ['empty quote', candidate => { candidate.quote = ''; }],
  ['fabricated quote', candidate => { candidate.quote = '不存在的工资105.7万元。'; }],
  ['wrong blockId', candidate => { candidate.blockId = 'missing'; }],
  ['unsupported subject', candidate => { candidate.subject = '不存在的人'; candidate.scope = 'individual'; }],
]) {
  test(`schema or literal evidence violation is a raw FP: ${name}`, () => {
    const candidate = structuredClone(wageExpected);
    mutate(candidate);
    expectRawRejected(run(base, [candidate]));
  });
}

test('malformed raw values are counted and do not abort a valid neighboring candidate', () => {
  const malformed = [null, 1, '105.7万元', true, [], {}];
  const row = run(base, [...malformed, wageExpected]);
  for (const mode of MODES.filter(mode => mode.startsWith('raw_'))) assert.deepEqual(counts(row[mode]), [1, malformed.length, 0], mode);
  for (const mode of MODES.filter(mode => mode.startsWith('accepted_'))) assert.deepEqual(counts(row[mode]), [1, 0, 0], mode);
  assert.equal(row.raw_count, malformed.length + 1);
  assert.equal(row.accepted_count, 1);
});

test('raw duplicate predictions do not inflate recall', () => {
  const row = run(base, [wageExpected, wageExpected]);
  for (const mode of MODES.filter(mode => mode.startsWith('raw_'))) assert.deepEqual(counts(row[mode]), [1, 1, 0], mode);
});

test('two real same-value same-attribute payments preserve two source events in raw and accepted layers', () => {
  const first = '2024年1月1日向工人支付1000元。';
  const second = '2024年1月2日向工人支付1000元。';
  const b = block('b1', first + second);
  const expected = [money(first, { value: '1000元' }), money(second, { value: '1000元' })];
  const fx = fixture([b], expected, [event('payment-1', anchor(b, '1000元', 0)), event('payment-2', anchor(b, '1000元', 1))], ['payment-1', 'payment-2']);
  const row = run(fx, expected);
  expectAll(row, [2, 0, 0]);
  assert.equal(row.raw_count, 2);
  assert.equal(row.accepted_count, 2, 'same amount and attributes do not prove the same payment');
});

test('event matching preserves the separate basic and relational attribute contract', () => {
  const person = block('b1', '张三收到工资105.7万元。');
  const fx = fixture([person], [money(person.text, { subject: '张三', scope: 'individual' })], [event('wage', anchor(person, '105.7万元'))], ['wage']);
  const row = run(fx, [money(person.text)]);
  for (const mode of ['raw_basic', 'accepted_basic']) assert.deepEqual(counts(row[mode]), [1, 0, 0], mode);
  for (const mode of ['raw_relational', 'raw_strict', 'accepted_relational', 'accepted_strict']) assert.deepEqual(counts(row[mode]), [0, 1, 1], mode);
});

test('different semantic facts may inherit a shared registered event without duplicating the amount', () => {
  const b = block('b1', '张三2024年1月在岗，该月工资归属2024年1月。');
  const date = { kind: 'date', value: '2024年1月', quote: b.text, blockId: 'b1', subject: '张三', scope: 'individual', meaning: 'employment_period', completeness: 'not_applicable', period: null, rateUnit: null, assertion: 'narrated' };
  const wageDate = { ...date, meaning: 'wage_period' };
  const fx = fixture([b], [date, wageDate], [event('january', anchor(b, '2024年1月', 0), anchor(b, '2024年1月', 1))], ['january', 'january']);
  expectAll(run(fx, [date, wageDate]), [2, 0, 0]);
});

test('finite alternatives inherit their expected event and cannot authorize another same-value event', () => {
  const fx = structuredClone(base);
  fx.label.acceptable_alternatives = [{ expected_index: 0, candidates: [{ ...wageExpected, subject: '工人', scope: 'group' }], reason: 'synthetic predeclared alias' }];
  const wrong = money(sale, { subject: '工人', scope: 'group' });
  expectAll(run(fx, [wrong]), [0, 1, 1]);
});

test('non-stop output retains raw observation but supplies no accepted facts', () => {
  const row = run(base, [wageExpected], { finish_reason: 'length' });
  for (const mode of MODES.filter(mode => mode.startsWith('raw_'))) assert.deepEqual(counts(row[mode]), [1, 0, 0], mode);
  for (const mode of MODES.filter(mode => mode.startsWith('accepted_'))) assert.deepEqual(counts(row[mode]), [0, 0, 1], mode);
  assert.equal(row.completed, false);
  assert.equal(row.exact_document, false);
});
