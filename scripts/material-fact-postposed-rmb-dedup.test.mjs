import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Actual runtime/store checks with synthetic text; no model or HTTP service.
// Dependencies and the sole runtime patch can come from different checkouts.
const HERE = fileURLToPath(new URL('../', import.meta.url));
const ROOT = resolve(process.env.MATERIAL_FACT_TEST_ROOT || HERE);
const MODULE = resolve(process.env.MATERIAL_FACT_RUNTIME_MODULE || resolve(HERE, 'lib/material-fact-runtime-ingest.ts'));
const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-postposed-rmb-dedup-'));
after(() => rm(temporary, { recursive: true, force: true }));
await cp(resolve(ROOT, 'lib'), resolve(temporary, 'lib'), { recursive: true });
await cp(MODULE, resolve(temporary, 'lib/material-fact-runtime-ingest.ts'));
const { validateRuntimeCandidateOutput, ingestRuntimeCandidates } = await import(pathToFileURL(resolve(temporary, 'lib/material-fact-runtime-ingest.ts')).href);
const { emptyFactState } = await import(pathToFileURL(resolve(temporary, 'lib/material-facts-v3.ts')).href);

const entry = (value, quote, extra = {}) => ({ kind: 'money', value, quote, blockId: 'b1', subject: '王甲', scope: 'individual',
  meaning: 'payment', completeness: 'unknown', period: null, rateUnit: null, assertion: 'narrated', ...extra });

function check(texts, entries, count, rejected = [], expectedAmount = undefined) {
  const source = { id: 'synthetic-postposed-rmb-dedup', name: '合成后置人民币包装去重', sha256: 'e'.repeat(64), analysisRevision: 1, ready: true,
    blocks: texts.map((text, index) => ({ id: `b${index + 1}`, page: index + 1, text, bbox: null, confidence: null })) };
  const raw = JSON.stringify({ schemaVersion: 3, candidates: entries });
  const original = structuredClone({ source, entries });
  const checked = validateRuntimeCandidateOutput(raw, source), initial = emptyFactState(1);
  const state = ingestRuntimeCandidates(initial, source, { raw }, 'synthetic', 'owner', '2026-10-18T00:00:00.000Z');
  const material = state.materials[0];
  if (expectedAmount !== undefined) for (const candidate of [...checked.candidates, ...material.candidates]) {
    assert.equal(candidate.amount, expectedAmount, 'The fixture must reach the expected source-reviewed amount before comparing counts');
    if (expectedAmount !== null) assert.equal(candidate.normalization.status, 'exact');
  }
  assert.equal(checked.candidates.length, count, 'Runtime keeps only proven repeats of one occurrence');
  assert.equal(material.candidates.length, count, 'The expected observations must enter the real store');
  assert.deepEqual(checked.rejected.map(item => item.index), rejected);
  assert.deepEqual(material.rejected, checked.rejected);
  assert.equal(checked.raw, raw); assert.equal(material.raw, raw);
  assert.deepEqual(JSON.parse(material.raw).candidates, entries, 'Every original duplicate remains in raw, in original order');
  assert.deepEqual(material.candidates.map(item => item.representation), entries.filter((_, index) => !rejected.includes(index)));
  assert.deepEqual({ source, entries }, original, 'Do not rewrite source, quote, value or model attributes');
  assert.deepEqual(initial, emptyFactState(1));
  assert.deepEqual(state.confirmations, { due: null, paid: null }); assert.equal(state.calculation, null);
  assert.equal(material.coverage.rawCount, entries.length); assert.equal(material.coverage.acceptedCount, count);
  for (const candidate of material.candidates) {
    const text = source.blocks.find(block => block.id === candidate.blockId).text;
    assert.equal(candidate.start, Array.from(text.slice(0, text.indexOf(candidate.quote))).length);
    assert.equal(candidate.end, candidate.start + Array.from(candidate.quote).length, 'Original Unicode codepoint positions survive');
    if (expectedAmount !== undefined) assert.equal(candidate.amount, expectedAmount);
  }
  return material.candidates;
}

for (const reverse of [false, true]) {
  for (const [minimal, wrapped] of [
    ['4000元', '4000元人民币'], ['4000元', '4000元人民幣'],
    ['4000元', '4000元RMB'], ['4000元', '4000元CNY'], ['4000元', '4000元rMb'],
    ['4000元整', '4000元整人民币'], ['4000元', '4000元 人民币'],
    ['4000元', '4000元人民币工资'], ['四千圓', '四千圓人民幣工資'],
  ]) {
    test(`one unique occurrence permits finite postfix ${wrapped}, reverse=${reverse}`, () => {
      const text = `😀𠮷。王甲收到${wrapped}。`, entries = [entry(minimal, text), entry(wrapped, text)];
      if (reverse) entries.reverse();
      check([text], entries, 1, [1], '4000.00');
    });
  }
  test(`same amount in separate payment events remains separate, reverse=${reverse}`, () => {
    const first = '😀王甲第一次收到4000元人民币。', second = '王甲第二次收到4000元人民币。';
    const entries = [entry('4000元', first), entry('4000元人民币', second)];
    if (reverse) entries.reverse();
    const kept = check([first + second], entries, 2, [], '4000.00');
    assert.equal(new Set(kept.map(item => item.start)).size, 2);
  });
  test(`the same literal in different blocks remains separate, reverse=${reverse}`, () => {
    const text = '😀王甲收到4000元人民币。';
    const entries = [entry('4000元', text), entry('4000元人民币', text, { blockId: 'b2' })];
    if (reverse) entries.reverse(); check([text, text], entries, 2, [], '4000.00');
  });
  test(`non-unique short quotes do not prove a duplicate, reverse=${reverse}`, () => {
    const text = '王甲收到4000元人民币。王甲又收到4000元人民币。';
    const entries = [entry('4000元', '4000元'), entry('4000元人民币', '4000元人民币')];
    if (reverse) entries.reverse(); check([text], entries, 2);
  });
  test(`a unique long quote with repeated values does not prove a duplicate, reverse=${reverse}`, () => {
    const text = '王甲收到4000元人民币。王甲又收到4000元人民币。';
    const entries = [entry('4000元', text), entry('4000元人民币', text)];
    if (reverse) entries.reverse(); check([text], entries, 2);
  });
  test(`different assertions remain separate at the same occurrence, reverse=${reverse}`, () => {
    const text = '王甲收到4000元人民币。';
    const entries = [entry('4000元', text, { assertion: 'claimed' }), entry('4000元人民币', text)];
    if (reverse) entries.reverse(); check([text], entries, 2, [], '4000.00');
  });
  test(`arbitrary narrative before a postfix literal is not a wrapper, reverse=${reverse}`, () => {
    const text = '😀王甲声称公司应当支付4000元人民币。';
    const entries = [entry('4000元', text), entry('公司应当支付4000元人民币', text)];
    if (reverse) entries.reverse();
    assert.ok(check([text], entries, 2).some(item => item.value === '4000元'));
  });
  test(`arbitrary narrative after a postfix literal is not a wrapper, reverse=${reverse}`, () => {
    const text = '王甲收到4000元人民币并保留其他请求。';
    const entries = [entry('4000元', text), entry('4000元人民币并保留其他请求', text)];
    if (reverse) entries.reverse(); check([text], entries, 2);
  });
  test(`a conflicting currency does not become a duplicate wrapper, reverse=${reverse}`, () => {
    const text = '王甲收到4000元人民币港币。';
    const entries = [entry('4000元', text), entry('4000元人民币港币', text)];
    if (reverse) entries.reverse(); check([text], entries, 2, [], null);
  });
}
