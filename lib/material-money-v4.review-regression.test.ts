import { describe, expect, it } from 'vitest';
import type { FactSource } from './material-fact-types';
import type { FactMaterialV3, RawCandidateV3 } from './material-fact-types-v3';
import { canonicalMonetaryExpression, classifyMonetaryExpression, normalizeMoneyValueV4 } from './material-money-v4';
import { ingestRuntimeCandidates, validateRuntimeCandidateOutput } from './material-fact-runtime-ingest';
import { reviewFactsAgainstSources } from './material-fact-source-review';
import { emptyFactState } from './material-facts-v3';

// Independent synthetic regression for PR45 review comments. No real material,
// model, Worker, external request or stored user data is involved.
const { assessCase } = await import(new URL('../experiments/material-facts-v7/assess.mjs', import.meta.url).href);
const modes = ['raw_basic', 'raw_relational', 'raw_strict', 'accepted_basic', 'accepted_relational', 'accepted_strict'];
const at = '2026-10-18T08:00:00.000Z';
const cp = (text: string) => Array.from(text).length;
const sourceFor = (text: string): FactSource => ({
  id: 'independent-pr45-review-source', name: 'synthetic-review.txt', sha256: 'c'.repeat(64), analysisRevision: 7,
  ready: true, blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }],
});
const entry = (value: string, quote: string, overrides: Partial<RawCandidateV3> = {}): RawCandidateV3 => ({
  kind: 'money', value, quote, blockId: 'b1', subject: null, scope: 'unknown', meaning: 'due_total',
  completeness: 'unknown', period: null, rateUnit: null, assertion: 'narrated', ...overrides,
});
const output = (entries: RawCandidateV3[]) => JSON.stringify({ schemaVersion: 3, candidates: entries });
function stored(source: FactSource, entries: RawCandidateV3[]) {
  const state = ingestRuntimeCandidates(emptyFactState(7), source, { raw: output(entries) }, 'independent-review', 'synthetic-owner', at, null);
  return reviewFactsAgainstSources(state, [source]).materials[0] as FactMaterialV3;
}
function score(source: FactSource, expected: RawCandidateV3[], entries: RawCandidateV3[], anchors: string[] = expected.map(row => row.value)) {
  const input = { id: 'independent-pr45-review-case', source };
  const events = anchors.map((value, index) => {
    // Every synthetic event has a unique literal in these tests. Full/cropped
    // values may share one event only through span containment.
    const start = source.blocks[0].text.indexOf(value);
    expect(start).toBeGreaterThanOrEqual(0);
    return { id: `event-${index}`, anchors: [{ blockId: 'b1', start: cp(source.blocks[0].text.slice(0, start)), end: cp(source.blocks[0].text.slice(0, start + value.length)) }] };
  });
  const label = { id: input.id, schemaVersion: 3, label_status: 'provisional_non_expert', expected, events,
    expected_event_ids: expected.map((_, index) => `event-${index}`), acceptable_alternatives: [] };
  const result = { id: input.id, finish_reason: 'stop', raw_output: output(entries) };
  const before = structuredClone({ input, label, result });
  const row = assessCase(input, label, result);
  expect({ input, label, result }).toEqual(before);
  return row;
}
function allCounts(row: Record<string, { tp: number; fp: number; fn: number }>, expected: number[]) {
  for (const mode of modes) expect([row[mode].tp, row[mode].fp, row[mode].fn], mode).toEqual(expected);
}

const foreign = [
  ['四万元港幣', '四万元'], ['新台币1000元', '1000元'], ['加拿大元1000元', '1000元'],
  ['ＣＡＤ1000元', '1000元'], ['1000元新臺幣', '1000元'],
];
describe('independent PR45 currency boundaries across parsing, source review and scoring', () => {
  it.each(foreign)('never gives %s the same comparison key or exact amount as RMB %s', (literal, cropped) => {
    expect(normalizeMoneyValueV4(literal).amount).toBeNull();
    expect(canonicalMonetaryExpression(literal)).not.toBe(canonicalMonetaryExpression(cropped));
  });
  it.each(foreign)('a cropped quote cannot hide the source currency in %s', (literal, cropped) => {
    const source = sourceFor(`王甲2024年7月工资为${literal}。`), entries = [entry(cropped, cropped)];
    const material = stored(source, entries);
    expect(material.raw).toBe(output(entries));
    expect(material.candidates).toHaveLength(1);
    expect(material.candidates[0].amount).toBeNull();
    expect(material.candidates[0].representation).toEqual(entries[0]);
  });
  it.each(foreign)('same-event scoring does not call a clipped RMB-looking value equal to %s', (literal, cropped) => {
    const text = `王甲2024年7月工资为${literal}。`, source = sourceFor(text);
    const row = score(source, [entry(literal, text)], [entry(cropped, text)]);
    allCounts(row, [0, 1, 1]);
    expect(row.production_defense).toEqual([expect.objectContaining({ amount: null, calculation_authorized: false })]);
  });
  it('still credits literal foreign-currency extraction without providing an RMB amount', () => {
    const text = '王甲2024年7月工资为四万元港幣。', source = sourceFor(text), entries = [entry('四万元港幣', text)];
    const row = score(source, entries, entries);
    allCounts(row, [1, 0, 0]);
    expect(row.production_defense).toEqual([expect.objectContaining({ amount: null, calculation_authorized: false })]);
  });
});

const indefiniteOrSigned = [
  ['数十万元', '十万元'], ['几十万元', '十万元'], ['负数四万元', '四万元'], ['负值四万元', '四万元'],
  ['负数：四万元', '四万元'], ['负的四万元', '四万元'],
  ['负\u200d四万元', '四万元'], ['数\u200d十万元', '十万元'],
];
describe('independent PR45 indefinite and signed amounts cannot become exact positive tails', () => {
  it.each(indefiniteOrSigned)('does not parse %s as a positive exact %s', (literal, cropped) => {
    expect(normalizeMoneyValueV4(literal).amount).toBeNull();
    expect(canonicalMonetaryExpression(literal)).not.toBe(canonicalMonetaryExpression(cropped));
  });
  it.each(indefiniteOrSigned)('full source prevents a cropped %s quote from losing its modifier', (literal, cropped) => {
    const source = sourceFor(`王甲2024年7月工资为${literal}。`), entries = [entry(cropped, cropped)];
    const material = stored(source, entries);
    expect(material.raw).toBe(output(entries));
    expect(material.candidates).toHaveLength(1);
    expect(material.candidates[0].amount).toBeNull();
    expect(material.candidates[0].representation).toEqual(entries[0]);
  });
  it.each(indefiniteOrSigned)('all six scorer layers distinguish %s from its cropped positive tail', (literal, cropped) => {
    const text = `王甲2024年7月工资为${literal}。`, source = sourceFor(text);
    const row = score(source, [entry(literal, text)], [entry(cropped, text)]);
    allCounts(row, [0, 1, 1]);
    expect(row.production_defense).toEqual([expect.objectContaining({ amount: null, calculation_authorized: false })]);
  });
});

describe('independent PR45 ordinary words containing 元 or 圆 remain raw false positives', () => {
  it.each(['元月', '元旦', '圆满'])('positively identifies %s as a non-money word', value => {
    expect(classifyMonetaryExpression(value).kind).toBe('not_monetary');
  });
  it.each(['元月', '元旦', '圆满'])('rejects %s from accepted candidates while retaining the original response', value => {
    const text = `王甲材料中的原词为${value}。`, source = sourceFor(text), entries = [entry(value, text)];
    const material = stored(source, entries);
    expect(material.raw).toBe(output(entries));
    expect(material.candidates).toEqual([]);
    expect(validateRuntimeCandidateOutput(output(entries), source).coverage).toMatchObject({ rawCount: 1, acceptedCount: 0, rejectedCount: 1 });
  });
  it.each(['元月', '元旦', '圆满'])('retains the %s raw FP against an empty gold label instead of hiding it', value => {
    const text = `王甲材料中的原词为${value}。`, source = sourceFor(text), row = score(source, [], [entry(value, text)]);
    for (const mode of modes) expect([row[mode].tp, row[mode].fp, row[mode].fn]).toEqual(mode.startsWith('raw_') ? [0, 1, 0] : [0, 0, 0]);
    expect(row.raw_count).toBe(1); expect(row.accepted_count).toBe(0); expect(row.production_defense).toEqual([]);
  });
});

describe('independent PR45 equivalent nested values retain one accepted source observation', () => {
  for (const reverse of [false, true]) it(`deduplicates 人民币四万元 and 四万元 inside one unique quote in ${reverse ? 'cropped-first' : 'full-first'} order`, () => {
    const text = '😀王甲2024年7月工资为人民币四万元。', source = sourceFor(text);
    const entries = [entry('人民币四万元', text), entry('四万元', text)];
    if (reverse) entries.reverse();
    const material = stored(source, entries), row = score(source, [entry('人民币四万元', text)], entries);
    expect(material.raw).toBe(output(entries));
    expect(material.candidates).toHaveLength(1); expect(material.rejected).toHaveLength(1);
    expect(material.candidates[0].representation).toEqual(entries[0]);
    expect(material.candidates[0].amount).toBe('40000.00');
    for (const mode of modes) expect([row[mode].tp, row[mode].fp, row[mode].fn]).toEqual(mode.startsWith('raw_') ? [1, 1, 0] : [1, 0, 0]);
    expect(row.raw_count).toBe(2); expect(row.accepted_count).toBe(1);
  });
  it('keeps two non-overlapping equal payments even when one value includes a currency prefix', () => {
    const first = '😀第一次收到人民币四万元工资。', second = '𠮷第二次收到四万元工资。', source = sourceFor(first + second);
    const entries = [entry('人民币四万元', first, { meaning: 'payment', completeness: 'partial' }), entry('四万元', second, { meaning: 'payment', completeness: 'partial' })];
    const material = stored(source, entries);
    expect(material.raw).toBe(output(entries)); expect(material.candidates).toHaveLength(2); expect(material.rejected).toEqual([]);
    expect(material.candidates.map(candidate => candidate.amount)).toEqual(['40000.00', '40000.00']);
    const input = { id: 'distinct-payments', source }, start = cp(first + '𠮷第二次收到');
    const label = { id: input.id, schemaVersion: 3, label_status: 'provisional_non_expert', expected: entries,
      events: [{ id: 'first', anchors: [{ blockId: 'b1', start: cp('😀第一次收到'), end: cp('😀第一次收到人民币四万元') }] },
        { id: 'second', anchors: [{ blockId: 'b1', start, end: start + cp('四万元') }] }], expected_event_ids: ['first', 'second'], acceptable_alternatives: [] };
    const row = assessCase(input, label, { id: input.id, finish_reason: 'stop', raw_output: output(entries) });
    allCounts(row, [2, 0, 0]);
  });
  it('does not hide differing assertion attributes as an equivalent nested duplicate', () => {
    const text = '甲公司承认工资为人民币四万元。', source = sourceFor(text);
    const entries = [entry('人民币四万元', text, { assertion: 'admitted' }), entry('四万元', text, { assertion: 'narrated' })];
    const material = stored(source, entries), row = score(source, [entries[0]], entries);
    expect(material.raw).toBe(output(entries)); expect(material.candidates).toHaveLength(2); expect(material.rejected).toEqual([]);
    expect(material.candidates.map(candidate => candidate.representation!.assertion)).toEqual(['admitted', 'narrated']);
    allCounts(row, [1, 1, 0]);
  });
  it('does not collapse a complete non-exact range with a nested cropped endpoint', () => {
    const text = '王甲2024年7月工资为四万元至五万元。', source = sourceFor(text);
    const entries = [entry('四万元至五万元', text), entry('四万元', text)], material = stored(source, entries);
    expect(material.raw).toBe(output(entries)); expect(material.candidates).toHaveLength(2); expect(material.rejected).toEqual([]);
    expect(material.candidates.map(candidate => candidate.amount)).toEqual([null, null]);
    const row = score(source, [entries[0]], entries);
    allCounts(row, [1, 1, 0]);
  });
  it('keeps different unresolved repeated quotes without guessing a nested source location', () => {
    const text = '工资人民币四万元。另一笔工资人民币四万元。', source = sourceFor(text);
    const entries = [entry('人民币四万元', '人民币四万元'), entry('四万元', '四万元')], material = stored(source, entries);
    expect(material.raw).toBe(output(entries)); expect(material.candidates).toHaveLength(2); expect(material.rejected).toEqual([]);
    expect(material.candidates.map(candidate => candidate.amount)).toEqual([null, null]);
  });
});
