import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FactSource, FactState } from './material-fact-types';
import type { FactCandidateV3, RawCandidateV3 } from './material-fact-types-v3';
import { reviewFactsAgainstSources } from './material-fact-source-review';
import { applyFactAction, buildFactView, emptyFactState, ingestCandidates as ingestFrozen, validateCandidateOutput as validateFrozen } from './material-facts-v3';

// Independent b6419b2 acceptance. On the baseline the runtime module does not yet
// exist, so the adapter exercises the existing production parser/ingest functions.
// The same assertions exercise the new runtime entry points after implementation;
// the frozen parser remains separately observable and is never expected to change.
type RuntimeModule = { validateRuntimeCandidateOutput: typeof validateFrozen; ingestRuntimeCandidates: typeof ingestFrozen };
let runtime: RuntimeModule;
beforeAll(async () => {
  const path = fileURLToPath(new URL('./material-fact-runtime-ingest.ts', import.meta.url));
  runtime = existsSync(path) ? await import(/* @vite-ignore */ path) as RuntimeModule
    : { validateRuntimeCandidateOutput: validateFrozen, ingestRuntimeCandidates: ingestFrozen };
});

const AT = '2026-10-18T10:00:00.000Z';
const sourceFor = (texts: string[]): FactSource => ({
  id: 'final-review-source', name: '去重边界独立合成材料', sha256: 'd'.repeat(64), analysisRevision: 3, ready: true,
  blocks: texts.map((text, index) => ({ id: `b${index + 1}`, page: index + 1, text, bbox: null, confidence: null })),
});
const entry = (quote: string, blockId = 'b1', overrides: Partial<RawCandidateV3> = {}): RawCandidateV3 => ({
  kind: 'money', value: '8000元', quote, blockId, subject: '王甲', scope: 'individual',
  meaning: 'due_total', completeness: 'complete', period: '2024年7月', rateUnit: null, assertion: 'narrated', ...overrides,
});
const output = (entries: unknown[], fenced = false) => {
  const json = JSON.stringify({ schemaVersion: 3, candidates: entries });
  return fenced ? `\`\`\`json\n${json}\n\`\`\`` : json;
};
const explicit = '王甲2024年7月完整应付工资8000元。';
const nonexact = [
  { name: 'approximate prefix', text: '王甲2024年7月完整应付工资约8000元。', status: 'approximate' },
  { name: 'lower bound', text: '王甲2024年7月完整应付工资至少8000元。', status: 'approximate' },
  { name: 'approximate suffix', text: '王甲2024年7月完整应付工资8000元左右。', status: 'approximate' },
  { name: 'range endpoint', text: '王甲2024年7月完整应付工资8000元至9000元。', status: 'range' },
  { name: 'uncertain prefix', text: '王甲2024年7月完整应付工资可能8000元。', status: 'uncertain' },
  { name: 'alternative amount', text: '王甲2024年7月完整应付工资8000元或9000元。', status: 'uncertain' },
] as const;
const pairCases = nonexact.flatMap(fixture => (['nonexact_first', 'exact_first'] as const).flatMap(order =>
  (['full_quote', 'cropped_quote'] as const).map(quote => ({ ...fixture, order, quote, name: `${fixture.name} / ${order} / ${quote}` }))));
const represented = (state: FactState) => state.materials[0].candidates as FactCandidateV3[];

describe('PR40 final independent review: runtime context survives semantic deduplication', () => {
  it.each(pairCases)('$name keeps both source-supported candidates and their original positions', ({ text, status, order, quote }) => {
    const source = sourceFor([text, explicit]);
    const uncertain = entry(quote === 'full_quote' ? text : '8000元');
    const exact = entry(quote === 'full_quote' ? explicit : '8000元', 'b2');
    const entries = order === 'nonexact_first' ? [uncertain, exact] : [exact, uncertain];
    const raw = output(entries), original = emptyFactState(7), originalSource = structuredClone(source);
    const originalState = structuredClone(original), frozen = validateFrozen(raw, source), frozenSnapshot = structuredClone(frozen);
    // This is the frozen collision being repaired only at the runtime boundary.
    expect(frozen.candidates).toHaveLength(1);
    expect(frozen.rejected).toEqual([expect.objectContaining({ index: 1 })]);
    const batch = runtime.validateRuntimeCandidateOutput(raw, source);
    expect(batch.candidates, JSON.stringify({ entries, frozenRejected: frozen.rejected })).toHaveLength(2);
    expect(batch.rejected).toEqual([]);
    expect(batch.raw).toBe(raw);
    expect(batch.rawCount).toBe(2);
    expect(batch.candidates.map(candidate => candidate.id)).toEqual(['final-review-source:3:0', 'final-review-source:3:1']);
    expect(batch.candidates.map(candidate => candidate.representation)).toEqual(entries);
    const ingested = runtime.ingestRuntimeCandidates(original, source, { raw }, 'independent-runtime', 'synthetic-owner', AT);
    const reviewed = reviewFactsAgainstSources(ingested, [source]), view = buildFactView(reviewed, [source]);
    expect(view.candidates).toHaveLength(2);
    const bad = represented(reviewed).find(candidate => candidate.blockId === 'b1')!;
    const good = represented(reviewed).find(candidate => candidate.blockId === 'b2')!;
    expect(bad.normalization.status).toBe(status);
    expect(bad.amount).toBeNull();
    expect(good.normalization.status).toBe('exact');
    expect(good.amount).toBe('8000.00');
    expect(ingested.materials[0].raw).toBe(raw);
    expect(reviewed.materials[0].raw).toBe(raw);
    expect(reviewed.confirmations).toEqual({ due: null, paid: null });
    expect(original).toEqual(originalState);
    expect(source).toEqual(originalSource);
    expect(frozen).toEqual(frozenSnapshot);
    expect(validateFrozen(raw, source)).toEqual(frozenSnapshot);
  });

  const distinctContexts = [
    ['王甲2024年7月完整应付工资8000元至9000元。', '王甲2024年7月完整应付工资8000元至10000元。', 'range'],
    ['王甲2024年7月完整应付工资8000元以上。', '王甲2024年7月完整应付工资8000元以下。', 'approximate'],
    ['王甲2024年7月完整应付工资可能8000元。', '王甲2024年7月完整应付工资暂计8000元。', 'uncertain'],
  ] as const;

  it.each([false, true].flatMap(reverse => [false, true].map(cropped => ({ reverse, cropped }))))('a blocked exact observation cannot suppress a correctly attributed one, reversed=$reverse cropped=$cropped', ({ reverse, cropped }) => {
    const otherWorker = '李乙2024年7月完整应付工资8000元。', source = sourceFor([otherWorker, explicit]);
    const entries = [entry(cropped ? '8000元' : otherWorker), entry(cropped ? '8000元' : explicit, 'b2')];
    if (reverse) entries.reverse();
    const raw = output(entries), state = runtime.ingestRuntimeCandidates(emptyFactState(1), source, { raw }, 'synthetic', 'owner', AT);
    const scoped = applyFactAction(state, { action: 'confirm_scope',
      scope: { worker: '王甲', employer: '甲公司', start: '2024-07-01', end: '2024-07-31' },
      note: '合成用户已核对本人及工资期间，尚未确认金额', verified: true,
    }, [source], 'owner', AT);
    const reviewed = reviewFactsAgainstSources(scoped, [source]), view = buildFactView(reviewed, [source]);
    expect(view.candidates).toHaveLength(2);
    const blocked = represented(reviewed).find(candidate => candidate.blockId === 'b1')!;
    const usable = represented(reviewed).find(candidate => candidate.blockId === 'b2')!;
    expect(blocked.reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
    expect(usable.reviewIssues).toEqual([]);
    expect(usable.amount).toBe('8000.00');
    expect(view.fields.due.values).toEqual(['8000.00']);
    expect(view.fields.due.status).toBe('candidate');
    expect(view.canCalculate).toBe(false);
    expect(reviewed.materials[0].raw).toBe(raw);
    expect(reviewed.confirmations).toEqual({ due: null, paid: null });
  });

  it.each(distinctContexts.flatMap(([first, second, status]) => [false, true].map(reverse => ({ first, second, status, reverse }))))('$status / reversed=$reverse retains distinct source boundaries', ({ first, second, status, reverse }) => {
    const source = sourceFor([first, second]);
    const entries = [entry(first), entry(second, 'b2')];
    if (reverse) entries.reverse();
    const raw = output(entries), batch = runtime.validateRuntimeCandidateOutput(raw, source);
    expect(batch.candidates).toHaveLength(2);
    expect(batch.candidates.map(candidate => candidate.representation)).toEqual(entries);
    expect(batch.rejected).toEqual([]);
    const reviewed = reviewFactsAgainstSources(runtime.ingestRuntimeCandidates(emptyFactState(1), source, { raw }, 'synthetic', 'owner', AT), [source]);
    expect(represented(reviewed).map(candidate => candidate.normalization.status)).toEqual([status, status]);
    expect(represented(reviewed).every(candidate => candidate.amount === null)).toBe(true);
    expect(reviewed.materials[0].raw).toBe(raw);
  });

  it.each([
    { text: explicit, value: '8000元' },
    { text: '王甲2024年7月完整应付工资人民币8000元。', value: '人民币8000元' },
    { text: '王甲2024年7月完整应付工资8000.00元。', value: '8000.00元' },
  ])('still rejects a repeated exact fact: $value', ({ text, value }) => {
    const source = sourceFor([explicit, text]), entries = [entry(explicit), entry(text, 'b2', { value })];
    const raw = output(entries), batch = runtime.validateRuntimeCandidateOutput(raw, source);
    expect(batch.candidates).toHaveLength(1);
    expect(batch.candidates[0].amount).toBe('8000.00');
    expect(batch.candidates[0].id).toBe('final-review-source:3:0');
    expect(batch.rejected).toEqual([expect.objectContaining({ index: 1, reason: expect.any(String) })]);
    expect(batch.raw).toBe(raw);
    expect(JSON.parse(batch.raw).candidates).toEqual(entries);
  });

  it('merges an exact full quote and cropped quote anchored to the same source amount', () => {
    const source = sourceFor([explicit]), entries = [entry(explicit), entry('8000元')], raw = output(entries);
    const batch = runtime.validateRuntimeCandidateOutput(raw, source);
    expect(batch.candidates).toHaveLength(1);
    expect(batch.rejected).toEqual([expect.objectContaining({ index: 1 })]);
    expect(batch.raw).toBe(raw);
    expect(batch.candidates[0].representation).toEqual(entries[0]);
  });

  it.each([false, true])('merges same-position nonexact quotes without upgrading the surviving amount, reverse=$0', reverse => {
    const text = nonexact[0].text, source = sourceFor([text]);
    const entries = [entry(text), entry('8000元')];
    if (reverse) entries.reverse();
    const raw = output(entries), state = runtime.ingestRuntimeCandidates(emptyFactState(1), source, { raw }, 'synthetic', 'owner', AT);
    const reviewed = reviewFactsAgainstSources(state, [source]);
    // Unique source position establishes one event despite different quote sizes.
    // The cropped quote must not introduce a surviving exact variant.
    expect(represented(reviewed)).toHaveLength(1);
    expect(represented(reviewed).map(candidate => candidate.normalization.status)).toEqual(['approximate']);
    expect(represented(reviewed).every(candidate => candidate.amount === null)).toBe(true);
    expect(represented(reviewed).map(candidate => candidate.representation)).toEqual([entries[0]]);
    expect(reviewed.materials[0].rejected).toEqual([expect.objectContaining({ index: 1 })]);
    expect(reviewed.materials[0].raw).toBe(raw);
  });

  it.each([false, true])('preserves rejected evidence, source indices and raw output, fenced=$0', fenced => {
    const first = nonexact[0].text, source = sourceFor([first, explicit]);
    const entries = [entry(first), entry('不存在的原文8000元'), entry(explicit, 'b2')];
    const raw = output(entries, fenced), originalRejected = validateFrozen(output([entries[1]]), source).rejected[0];
    const batch = runtime.validateRuntimeCandidateOutput(raw, source);
    expect(batch.candidates.map(candidate => candidate.id)).toEqual(['final-review-source:3:0', 'final-review-source:3:2']);
    expect(batch.rejected).toEqual([{ ...originalRejected, index: 1 }]);
    expect(batch.rawCount).toBe(3);
    expect(batch.format).toBe(fenced ? 'outer_fence' : 'json');
    expect(batch.raw).toBe(raw);
    const state = runtime.ingestRuntimeCandidates(emptyFactState(1), source, { raw }, 'synthetic', 'owner', AT, 'synthetic-model');
    expect(state.materials[0]).toMatchObject({ raw, rejected: batch.rejected, schemaVersion: 3, outputFormat: batch.format, model: 'synthetic-model' });
    expect(state.materials[0].candidates.map(candidate => candidate.id)).toEqual(batch.candidates.map(candidate => candidate.id));
  });

  it.each([
    ['oversized batch', JSON.stringify({ schemaVersion: 3, candidates: Array.from({ length: 41 }, () => entry(explicit)) })],
    ['wrong schema version', JSON.stringify({ schemaVersion: 2, candidates: [entry(explicit)] })],
    ['extra top-level key', JSON.stringify({ schemaVersion: 3, candidates: [entry(explicit)], confidence: 1 })],
    ['malformed output', '{schemaVersion:3,candidates:[]}'],
  ])('retains the frozen top-level rejection boundary: %s', (_name, raw) => {
    const source = sourceFor([explicit]);
    expect(() => runtime.validateRuntimeCandidateOutput(raw, source)).toThrow();
    expect(() => runtime.ingestRuntimeCandidates(emptyFactState(1), source, { raw }, 'synthetic', 'owner', AT)).toThrow();
  });

  it('rejects an unready source before any per-entry validation', () => {
    const source = { ...sourceFor([explicit]), ready: false }, raw = output([entry(explicit)]);
    expect(() => runtime.validateRuntimeCandidateOutput(raw, source)).toThrow();
  });

  it('retains distinct assertion labels even for the same exact value and source quote', () => {
    const source = sourceFor([explicit]), entries = [entry(explicit, 'b1', { assertion: 'claimed' }), entry(explicit)];
    const raw = output(entries), batch = runtime.validateRuntimeCandidateOutput(raw, source);
    expect(batch.candidates).toHaveLength(2);
    expect(batch.rejected).toEqual([]);
    expect(batch.candidates.map(candidate => candidate.assertion)).toEqual(['claimed', 'narrated']);
    expect(batch.raw).toBe(raw);
  });

  it('does not pick the first source occurrence when a cropped quote is ambiguous', () => {
    const source = sourceFor([`${explicit}王甲2024年7月完整已付工资8000元。`]), raw = output([entry('8000元')]);
    const state = runtime.ingestRuntimeCandidates(emptyFactState(1), source, { raw }, 'synthetic', 'owner', AT);
    const reviewed = reviewFactsAgainstSources(state, [source]), candidate = represented(reviewed)[0];
    expect(candidate.amount).toBeNull();
    expect(candidate.reviewIssues.map(issue => issue.code)).toContain('local_context_ambiguous');
    expect(reviewed.materials[0].raw).toBe(raw);
  });

  it('leaves a historical frozen extraction and its rejected record unchanged until re-extraction', () => {
    const text = nonexact[0].text, source = sourceFor([text, explicit]), raw = output([entry(text), entry(explicit, 'b2')]);
    const historical = ingestFrozen(emptyFactState(1), source, { raw }, 'historical-frozen', 'owner', AT);
    const snapshot = structuredClone(historical), reviewed = reviewFactsAgainstSources(historical, [source]);
    expect(represented(reviewed)).toHaveLength(1);
    expect(represented(reviewed)[0].representation.quote).toBe(text);
    expect(reviewed.materials[0].rejected).toEqual(snapshot.materials[0].rejected);
    expect(reviewed.materials[0].raw).toBe(raw);
    expect(historical).toEqual(snapshot);
    expect(validateFrozen(raw, source).candidates).toHaveLength(1);
  });
});
