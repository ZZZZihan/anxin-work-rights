// Synthetic author checks only: named rates are operands, never FX or wage math.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OWN = fileURLToPath(new URL('../', import.meta.url));
const SOURCE = resolve(process.env.MATERIAL_FACT_TEST_ROOT || OWN);
const PATCH = resolve(process.env.MATERIAL_FACT_ARITHMETIC_ROOT || OWN);
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-named-rate-operands-'));
after(() => rm(temporary, { recursive: true, force: true }));
if (process.env.MATERIAL_FACT_TEST_REVISION) {
  const archive = execFileSync('git', ['archive', '--format=tar', process.env.MATERIAL_FACT_TEST_REVISION, 'lib'], { cwd: SOURCE, maxBuffer: 30 * 1024 * 1024 });
  execFileSync('tar', ['-xf', '-', '-C', temporary], { input: archive });
} else await cp(resolve(SOURCE, 'lib'), resolve(temporary, 'lib'), { recursive: true });
await cp(resolve(PATCH, 'lib/material-fact-arithmetic-review.ts'), resolve(temporary, 'lib/material-fact-arithmetic-review.ts'));
const load = file => import(pathToFileURL(resolve(temporary, 'lib', file)).href);
const { hasAttachedMoneyArithmetic: arithmetic } = await load('material-fact-arithmetic-review.ts');
const { normalizeMoneyValueV4: money, normalizeCandidateValueV4: normalize } = await load('material-money-v4.ts');
const { ingestRuntimeCandidates } = await load('material-fact-runtime-ingest.ts');
const { emptyFactState, ingestCandidates } = await load('material-facts-v3.ts');
const { reviewFactsAgainstSources } = await load('material-fact-source-review.ts');
const cpLength = value => Array.from(value).length;
const PREFIX = '😀𠮷王甲工资为';
const AT = '2026-10-18T00:00:00.000Z';

function fixture(expression, fullQuote = false, changes = {}) {
  const text = PREFIX + expression + '。';
  const candidate = { kind: 'money', value: '四万元', quote: fullQuote ? text : '四万元', blockId: 'b1', subject: '王甲', scope: 'individual',
    meaning: 'due_total', completeness: 'complete', period: null, rateUnit: null, assertion: 'narrated', ...changes };
  return { candidate, raw: JSON.stringify({ schemaVersion: 3, candidates: [candidate] }),
    source: { id: 'named-rate-author', name: '合成命名率操作数', sha256: 'e'.repeat(64), analysisRevision: 1, ready: true,
      blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] } };
}

function check(f, expected) {
  const snapshot = structuredClone(f);
  const ingest = fn => fn(emptyFactState(1), f.source, { raw: f.raw }, 'synthetic', 'named-rate-author', AT);
  const fresh = ingest(ingestRuntimeCandidates);
  assert.equal(fresh.materials[0].raw, f.raw); assert.equal(fresh.materials[0].candidates.length, 1);
  const current = fresh.materials[0].candidates[0];
  const immutable = candidate => {
    assert.deepEqual(candidate.representation, f.candidate); assert.equal(candidate.value, f.candidate.value);
    assert.equal(candidate.quote, f.candidate.quote); assert.equal(candidate.sourceSha256, f.source.sha256);
    const block = f.source.blocks.find(block => block.id === f.candidate.blockId);
    assert.equal(candidate.start, cpLength(block.text.slice(0, block.text.indexOf(f.candidate.quote))));
    assert.equal(candidate.end, candidate.start + cpLength(f.candidate.quote));
    assert.equal(Array.from(block.text).slice(candidate.start, candidate.end).join(''), f.candidate.quote);
  };
  assert.equal(current.amount, expected, 'fresh source guard'); immutable(current);
  assert.deepEqual(fresh.confirmations, emptyFactState(1).confirmations); assert.equal(fresh.calculation, null);

  const stored = ingest(ingestCandidates), old = stored.materials[0].candidates[0]; assert(old);
  old.amount = '40000.00'; old.normalization = { rawValue: old.value, amount: old.amount, status: 'exact', matchedText: old.value,
    span: { start: 0, end: cpLength(old.value) }, reason: 'Synthetic old precise operand, not a computed result.' };
  const before = structuredClone(stored), view = reviewFactsAgainstSources(stored, [f.source]);
  assert.equal(view.materials[0].candidates[0].amount, expected, 'forced old exact read'); immutable(view.materials[0].candidates[0]);
  assert.equal(view.materials[0].raw, f.raw); assert.deepEqual(view.history, stored.history); assert.deepEqual(stored, before);
  old.amount = null; old.normalization = { rawValue: old.value, amount: null, status: 'unsupported', matchedText: null, span: null, reason: 'Synthetic unavailable history.' };
  const unavailable = structuredClone(stored), unchanged = reviewFactsAgainstSources(stored, [f.source]);
  assert.equal(unchanged.materials[0].candidates[0].amount, null, 'unavailable history cannot auto-upgrade');
  assert.deepEqual(stored, unavailable); assert.deepEqual(f, snapshot);
}

function unavailable(expression) {
  const parsed = money(expression); assert.equal(parsed.amount, null);
  assert.equal(parsed.status, expression.includes('%') ? 'percentage' : 'unsupported'); assert.equal(parsed.rawValue, expression);
  for (const fullQuote of [false, true]) {
    const f = fixture(expression, fullQuote), candidate = { ...f.candidate, quote: f.source.blocks[0].text };
    const before = structuredClone(candidate); assert.equal(normalize(candidate).amount, null, 'candidate full quote'); assert.deepEqual(candidate, before);
    check(f, null);
  }
}

for (const name of ['提成率', '出勤率', '税率']) test('minimal explicit named rate remains an unavailable operand: ' + name, () => unavailable('四万元乘以' + name));

const names = ['提成率', '出勤率', '税率', '个人所得税率', '社保缴费率', '住房公积金缴存率', '实际出勤率', '稅率', '社保繳費率', '甲乙丙丁戊己庚辛壬癸子丑寅卯辰率'];
for (const name of names) for (const operator of ['乘以', '除以', '×', '÷', '加上', '减去'])
  test('bounded rate name after an explicit operator: ' + operator + name, () => {
    assert.equal(arithmetic('', operator + name), true); unavailable('四万元' + operator + name);
  });

for (const [before, after] of [['提成率乘以', ''], ['税率×', ''], ['出勤率除以', ''], ['', '基本工资乘以提成率'], ['', '的出勤率倍'], ['', '的税率%']])
  test('existing explicit prefix/noun/fraction route: ' + before + '|' + after, () => {
    assert.equal(arithmetic(before, after), true); unavailable(before + '四万元' + after);
  });

for (const tail of ['乘\n以提成率', '乘以出\n勤率', '乘以社保\r\n缴费率', '×稅\u200d率', ' 乘 以 出 勤 率', '乘以\n税率'])
  test('explicit layout/Cf detection preserves the raw evidence: ' + JSON.stringify(tail), () => unavailable('四万元' + tail));

for (const [left, right] of [['四万元乘以', '提成率'], ['四万元乘', '以出勤率'], ['四万元×社保缴费', '率'], ['四万元乘以税', '率']])
  test('explicit operator/rate can finish in an adjacent OCR block: ' + left + '|' + right, () => {
    const f = fixture(left); f.source.blocks[0].text = PREFIX + left;
    f.source.blocks.push({ id: 'b2', page: 1, text: right + '。', bbox: null, confidence: null }); check(f, null);
  });

for (const [before, after] of [['', '加班费按提成率发放'], ['', '加薪后核算税率'], ['', '除外另行按出勤率支付'], ['', '。王乙提成率为50%'], ['', '，王乙按税率扣缴'], ['', '\n王乙出勤率另议'], ['', '乘以，王乙税率另议'], ['按出勤率核算工资', ''], ['', '/月'], ['', '/日'], ['', '/小时'], ['', '/件']])
  test('ordinary rates/nouns and separate events are not arithmetic: ' + before + '|' + after, () => assert.equal(arithmetic(before, after), false));

for (const [expression, changes] of [
  ['四万元，王乙提成率另议', {}], ['四万元。王乙税率另议', {}], ['四万元\n王乙出勤率另议', {}],
  ['四万元', {}], ['四万元/月', { meaning: 'rate', rateUnit: 'month', completeness: 'not_applicable' }],
  ['四万元/日', { meaning: 'rate', rateUnit: 'day', completeness: 'not_applicable' }],
  ['四万元/小时', { meaning: 'rate', rateUnit: 'hour', completeness: 'not_applicable' }],
  ['四万元/件', { meaning: 'rate', rateUnit: 'piece', completeness: 'not_applicable' }],
]) for (const fullQuote of [false, true]) test('supported amount/event stays exact: ' + JSON.stringify({ expression, fullQuote }), () => check(fixture(expression, fullQuote, changes), '40000.00'));

for (const prefix of ['按出勤率核算的', '提成率已经核定，王甲', '税率另议。王甲']) test('rate name elsewhere is not an attached operand: ' + prefix, () => {
  assert.equal(money(prefix + '四万元').amount, '40000.00');
});
