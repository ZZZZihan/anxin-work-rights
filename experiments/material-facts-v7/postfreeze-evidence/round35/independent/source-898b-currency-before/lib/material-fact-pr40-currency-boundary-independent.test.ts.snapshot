import { describe, expect, it } from 'vitest';
import type { FactSource } from './material-fact-types';
import type { FactCandidateV3, RawCandidateV3 } from './material-fact-types-v3';
import { ingestRuntimeCandidates, validateRuntimeCandidateOutput } from './material-fact-runtime-ingest';
import { reviewFactsAgainstSources } from './material-fact-source-review';
import { emptyFactState, validateCandidateOutput } from './material-facts-v3';

// Additional independent boundary probes. The original 69-case files stay fixed.
const AT = '2026-10-18T12:30:00.000Z';
const sourceFor = (texts: string[]): FactSource => ({ id: 'currency-boundary-independent', name: '合成金额边界材料',
  sha256: 'c'.repeat(64), analysisRevision: 1, ready: true,
  blocks: texts.map((text, index) => ({ id: `b${index + 1}`, page: 1, text, bbox: null, confidence: null })),
});
const entry = (overrides: Partial<RawCandidateV3> = {}): RawCandidateV3 => ({ kind: 'money', value: '8000', quote: '8000',
  blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'due_total', completeness: 'complete',
  period: '2024年7月', rateUnit: null, assertion: 'narrated', ...overrides });
const output = (entries: RawCandidateV3[]) => JSON.stringify({ schemaVersion: 3, candidates: entries });
function review(source: FactSource, entries: RawCandidateV3[]) {
  const raw = output(entries), original = ingestRuntimeCandidates(emptyFactState(1), source, { raw }, 'synthetic-independent', 'synthetic-owner', AT);
  const snapshot = structuredClone(original), reviewed = reviewFactsAgainstSources(original, [source]);
  expect(original).toEqual(snapshot);
  expect(reviewed.materials[0].raw).toBe(raw);
  return reviewed.materials[0].candidates as FactCandidateV3[];
}

describe('PR40 independent: currency guard composes with token formats and runtime dedup', () => {
  it.each(['0.00', '8000.00', '0.8万', '8,000'])('unmarked %s retains frozen parsing but is unavailable at runtime', value => {
    const source = sourceFor([`王甲2024年7月完整应付工资合计${value}。`]), raw = entry({ value, quote: value });
    expect(validateCandidateOutput(output([raw]), source).candidates[0].normalization.status).toBe('exact');
    const [candidate] = review(source, [raw]);
    expect(candidate.amount).toBeNull();
    expect(candidate.normalization.status).not.toBe('exact');
    expect(candidate.representation).toEqual(raw);
  });

  it.each([false, true].flatMap(reverse => [false, true].map(fullQuote => ({ reverse, fullQuote }))))(
    'unitless/exact observations cannot suppress each other, reverse=$reverse fullQuote=$fullQuote', ({ reverse, fullQuote }) => {
      const texts = ['王甲2024年7月完整应付工资合计8000。', '王甲2024年7月完整应付工资合计8000元。'];
      const source = sourceFor(texts), entries = [entry({ quote: fullQuote ? texts[0] : '8000' }),
        entry({ blockId: 'b2', value: '8000元', quote: fullQuote ? texts[1] : '8000元' })];
      if (reverse) entries.reverse();
      const batch = validateRuntimeCandidateOutput(output(entries), source);
      expect(batch.candidates).toHaveLength(2);
      expect(batch.rejected).toEqual([]);
      expect(batch.candidates.map(candidate => candidate.id)).toEqual(['currency-boundary-independent:1:0', 'currency-boundary-independent:1:1']);
      const candidates = review(source, entries);
      expect(candidates.find(candidate => candidate.blockId === 'b1')!.amount).toBeNull();
      expect(candidates.find(candidate => candidate.blockId === 'b2')!.amount).toBe('8000.00');
      expect(candidates.map(candidate => candidate.representation)).toEqual(entries);
    });

  it.each(['8000', '¥8000'])('cropping JP from a yen marker cannot become RMB, value=%s', value => {
    const source = sourceFor(['王甲2024年7月完整应付工资合计JP¥8000。']), raw = entry({ value, quote: value });
    const [candidate] = review(source, [raw]);
    expect(candidate.amount).toBeNull();
    expect(candidate.normalization.status).toBe('unsupported');
    expect(candidate.representation).toEqual(raw);
  });
});
