import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Synthetic actual runtime/store regression. This only overlays runtime-ingest,
// without changing model output, historical results or any production services.
const HERE = fileURLToPath(new URL('../', import.meta.url));
const ROOT = resolve(process.env.MATERIAL_FACT_TEST_ROOT || HERE);
const MODULE = resolve(process.env.MATERIAL_FACT_RUNTIME_MODULE || resolve(HERE, 'lib/material-fact-runtime-ingest.ts'));
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-traditional-dedup-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(ROOT, 'lib'), resolve(temporary, 'lib'), { recursive: true });
await cp(MODULE, resolve(temporary, 'lib/material-fact-runtime-ingest.ts'));
const { validateRuntimeCandidateOutput, ingestRuntimeCandidates } = await import(pathToFileURL(resolve(temporary, 'lib/material-fact-runtime-ingest.ts')).href);
const { emptyFactState } = await import(pathToFileURL(resolve(temporary, 'lib/material-facts-v3.ts')).href);
const entry = (value, quote, extra = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual',
  meaning: 'payment', completeness: 'unknown', period: null, rateUnit: null, assertion: 'narrated', ...extra });

function check(texts, entries, expected, rejected = []) {
  const source = { id: 'synthetic-traditional-dedup', name: '合成传统工资包装去重', sha256: 'd'.repeat(64), analysisRevision: 1, ready: true,
    blocks: texts.map((text, index) => ({ id: `b${index + 1}`, page: index + 1, text, bbox: null, confidence: null })) };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: entries });
  const original = structuredClone({ source, entries });
  const checked = validateRuntimeCandidateOutput(raw, source), initial = emptyFactState(1);
  const state = ingestRuntimeCandidates(initial, source, { raw }, 'synthetic', 'owner', '2026-10-18T00:00:00.000Z');
  const material = state.materials[0];
  assert.equal(checked.candidates.length, expected);
  assert.equal(material.candidates.length, expected, 'Expected observations must enter actual storage');
  assert.deepEqual(checked.rejected.map(item => item.index), rejected);
  assert.deepEqual(material.rejected, checked.rejected);
  assert.equal(checked.raw, raw); assert.equal(material.raw, raw);
  assert.deepEqual(JSON.parse(material.raw).candidates, entries, 'Raw keeps both original candidates in original order');
  assert.deepEqual(material.candidates.map(item => item.representation), entries.filter((_, i) => !rejected.includes(i)));
  assert.deepEqual({ source, entries }, original);
  assert.deepEqual(initial, emptyFactState(1));
  assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
  assert.equal(material.coverage.rawCount, entries.length); assert.equal(material.coverage.acceptedCount, expected);
  for (const candidate of material.candidates) {
    const text = source.blocks.find(block => block.id === candidate.blockId).text;
    assert.equal(candidate.start, Array.from(text.slice(0, text.indexOf(candidate.quote))).length);
    assert.equal(candidate.end, candidate.start + Array.from(candidate.quote).length);
  }
  return material.candidates;
}

for (const reverse of [false, true]) {
  for (const noun of ['工资', '工資', '劳务费', '勞務費', '劳动报酬', '勞動報酬']) {
    test(`same unique occurrence finite ${noun} wrapper collapses, reverse=${reverse}`, () => {
      const value = noun === '工资' ? '四万元' : '四萬圓', wrapped = value + noun;
      const text = `😀王甲收到${wrapped}。`, entries = [entry(value, text), entry(wrapped, text)];
      if (reverse) entries.reverse();
      const candidates = check([text], entries, 1, [1]);
      assert.equal(candidates[0].amount, '40000.00');
    });
  }
  test(`same occurrence traditional currency and wage wrapper collapses, reverse=${reverse}`, () => {
    const text = '😀王甲收到人民幣四萬圓工資。';
    const entries = [entry('四萬圓', text), entry('人民幣四萬圓工資', text)];
    if (reverse) entries.reverse(); check([text], entries, 1, [1]);
  });
  test(`same amount in separate traditional wage payment events stays separate, reverse=${reverse}`, () => {
    const first = '😀王甲第一次收到四萬圓工資。', second = '王甲第二次收到四萬圓工資。';
    const entries = [entry('四萬圓', first), entry('四萬圓工資', second)];
    if (reverse) entries.reverse();
    const candidates = check([first + second], entries, 2);
    assert.equal(new Set(candidates.map(item => item.start)).size, 2);
  });
  test(`non-unique cropped quotes do not prove one traditional occurrence, reverse=${reverse}`, () => {
    const text = '王甲收到四萬圓工資。王甲又收到四萬圓工資。';
    const entries = [entry('四萬圓', '四萬圓'), entry('四萬圓工資', '四萬圓工資')];
    if (reverse) entries.reverse(); check([text], entries, 2);
  });
  test(`an arbitrary narrative cannot displace the minimal traditional amount, reverse=${reverse}`, () => {
    const text = '😀王甲声称公司长期拖欠其工资，现要求支付四萬圓并追究责任。';
    const entries = [entry(text, text), entry('四萬圓', text)];
    if (reverse) entries.reverse();
    const candidates = check([text], entries, 2);
    assert.ok(candidates.some(item => item.value === '四萬圓'));
  });
  test(`unregistered traditional prose after amount remains two observations, reverse=${reverse}`, () => {
    const text = '王甲收到四萬圓工資但尚欠其他款項。';
    const entries = [entry('四萬圓', text), entry('四萬圓工資但尚欠其他款項', text)];
    if (reverse) entries.reverse(); check([text], entries, 2);
  });
}
test('same traditional wage amount in different blocks stays separate', () => {
  const text = '王甲收到四萬圓工資。';
  check([text, text], [entry('四萬圓', text), entry('四萬圓工資', text, { blockId: 'b2' })], 2);
});
test('same unique traditional value with different assertions stays separate', () => {
  const text = '王甲收到四萬圓工資。';
  check([text], [entry('四萬圓', text, { assertion: 'claimed' }), entry('四萬圓工資', text)], 2);
});
