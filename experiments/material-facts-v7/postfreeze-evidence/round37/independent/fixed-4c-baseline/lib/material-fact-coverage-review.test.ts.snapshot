import { describe, expect, it } from 'vitest';
import type { FactMaterial, FactSource } from './material-fact-types';
import type { ExtractionCoverage, FactMaterialV3, RawCandidateV3 } from './material-fact-types-v3';
import { getReviewedExtractionCoverage, reviewMaterialCoverage } from './material-fact-coverage-review';
import { emptyFactState, getExtractionCoverage, ingestCandidates as ingestV3 } from './material-facts-v3';
import { ingestCandidates as ingestV2, validateCandidateOutput as validateV2 } from './material-facts-v2';

const ACTOR = 'synthetic-coverage-review', AT = '2026-10-18T01:00:00.000Z';
const source = (text = '王甲2024年7月工资8000元。约定每月15日支付工资。'): FactSource => ({ id: 'coverage-source', name: '合成旧版覆盖诊断', sha256: 'c'.repeat(64), analysisRevision: 1, ready: true, blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] });
const money = (): RawCandidateV3 => ({ kind: 'money', value: '8000元', quote: '王甲2024年7月工资8000元', blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'due_total', completeness: 'complete', period: '2024年7月', rateUnit: null, assertion: 'narrated' });
const date = (): RawCandidateV3 => ({ ...money(), kind: 'date', value: '2024年7月', meaning: 'wage_period', completeness: 'not_applicable', period: null });
type RuntimeMaterial = FactMaterial & { sourceCoverage?: ExtractionCoverage };
function legacy(material: FactSource, entries: unknown[] = [money()]): FactMaterial {
  const raw = JSON.stringify({ schemaVersion: 2, candidates: entries });
  return ingestV2(emptyFactState(1), material, validateV2(raw, material), 'synthetic-v2', ACTOR, AT).materials[0];
}
function current(material: FactSource, entries: RawCandidateV3[] = [money()]): FactMaterialV3 {
  const raw = `\`\`\`json\n${JSON.stringify({ schemaVersion: 3, candidates: entries })}\n\`\`\``;
  return ingestV3(emptyFactState(1), material, { raw }, 'synthetic-v3', ACTOR, AT).materials[0] as FactMaterialV3;
}

describe('runtime source coverage for stored extraction versions', () => {
  it.each([
    ['money', money(), 'date', '每月15日'],
    ['date', date(), 'money', '8000元'],
  ] as const)('shows omitted source signals for nonempty v2 %s output without migrating it', (_kind, candidate, missingKind, missingText) => {
    const originalSource = source(), material = legacy(originalSource, [candidate]), snapshot = JSON.stringify(material);
    // This is the old panel call: v2 has accepted candidates but no persisted coverage.
    expect(material.candidates).toHaveLength(1);
    expect(getExtractionCoverage(material)).toBeNull();
    expect(getReviewedExtractionCoverage(material)).toBeNull();
    const reviewed = reviewMaterialCoverage(material, originalSource), coverage = getReviewedExtractionCoverage(reviewed);
    expect(coverage).toMatchObject({ heuristic: true, status: 'possible_missing', rawCount: 1, acceptedCount: 1, rejectedCount: 0 });
    expect(coverage?.signals).toContainEqual(expect.objectContaining({ kind: missingKind, text: missingText, covered: false }));
    expect(coverage?.message).toContain('人工核对');
    expect(reviewed.candidates).toEqual(material.candidates);
    expect(reviewed.raw).toBe(material.raw);
    expect((reviewed as { schemaVersion?: number }).schemaVersion).toBe(2);
    expect(Object.hasOwn(reviewed, 'coverage')).toBe(false);
    expect(JSON.stringify(material)).toBe(snapshot);
    expect(reviewMaterialCoverage(reviewed, originalSource)).toEqual(reviewed);
    const displayed = JSON.parse(JSON.stringify(reviewed)) as FactMaterial;
    expect(getReviewedExtractionCoverage(displayed)).toEqual(coverage);
  });

  it('retains rejected output and derives counts without adding an accepted candidate', () => {
    const originalSource = source(), material = legacy(originalSource, [money(), { ...money(), value: '9999元' }]);
    const snapshot = JSON.stringify(material), reviewed = reviewMaterialCoverage(material, originalSource);
    expect(getReviewedExtractionCoverage(reviewed)).toMatchObject({ status: 'possible_missing', rawCount: 2, acceptedCount: 1, rejectedCount: 1 });
    expect(reviewed.raw).toBe(material.raw);
    expect(reviewed.rejected).toEqual(material.rejected);
    expect(reviewed.candidates).toEqual(material.candidates);
    expect(JSON.stringify(material)).toBe(snapshot);
  });

  it('removes stale derived coverage when the currently bound source is unavailable', () => {
    const originalSource = source(), material = reviewMaterialCoverage(legacy(originalSource), originalSource);
    const snapshot = JSON.stringify(material), reviewed = reviewMaterialCoverage(material);
    expect(Object.hasOwn(material, 'sourceCoverage')).toBe(true);
    expect(Object.hasOwn(reviewed, 'sourceCoverage')).toBe(false);
    expect(getReviewedExtractionCoverage(reviewed)).toBeNull();
    expect(reviewed.raw).toBe(material.raw);
    expect(reviewed.candidates).toEqual(material.candidates);
    expect(JSON.stringify(material)).toBe(snapshot);
  });

  it('does not invent coverage or migrate a legacy record when no source is available', () => {
    const material = legacy(source()), snapshot = JSON.stringify(material);
    const reviewed = reviewMaterialCoverage(material);
    expect(reviewed).toEqual(material);
    expect(Object.hasOwn(reviewed, 'sourceCoverage')).toBe(false);
    expect(getReviewedExtractionCoverage(reviewed)).toBeNull();
    expect(JSON.stringify(material)).toBe(snapshot);
  });

  it('prefers fresh source coverage while preserving the v3 stored coverage and fenced raw response', () => {
    const originalSource = source(), material = current(originalSource);
    // A stored display diagnostic remains historical, even when it differs from
    // the current source review. Only the runtime sourceCoverage is refreshed.
    material.coverage = { ...material.coverage, status: 'no_signal', signals: [] };
    const snapshot = JSON.stringify(material), reviewed = reviewMaterialCoverage(material, originalSource);
    expect(getExtractionCoverage(material)?.status).toBe('no_signal');
    expect(getReviewedExtractionCoverage(reviewed)?.status).toBe('possible_missing');
    expect((reviewed as FactMaterialV3).coverage).toEqual(material.coverage);
    expect((reviewed as FactMaterialV3).schemaVersion).toBe(3);
    expect((reviewed as FactMaterialV3).outputFormat).toBe('outer_fence');
    expect(reviewed.raw).toBe(material.raw);
    expect(reviewed.candidates).toEqual(material.candidates);
    expect(JSON.stringify(material)).toBe(snapshot);
  });

  it('keeps frozen v3 display compatibility without current source-derived coverage', () => {
    const material = current(source());
    expect(getReviewedExtractionCoverage(material)).toBe(material.coverage);
    const derived = reviewMaterialCoverage(material, source()), reviewed = reviewMaterialCoverage(derived);
    expect(Object.hasOwn(reviewed, 'sourceCoverage')).toBe(false);
    expect(getReviewedExtractionCoverage(reviewed)).toEqual(material.coverage);
    expect((reviewed as FactMaterialV3).coverage).toEqual(material.coverage);
    expect(reviewed.raw).toBe(material.raw);
  });

  it('does not show source coverage for an excluded material', () => {
    const originalSource = source(), material: RuntimeMaterial = { ...reviewMaterialCoverage(legacy(originalSource), originalSource), status: 'excluded' };
    const snapshot = JSON.stringify(material), reviewed = reviewMaterialCoverage(material, originalSource);
    expect(Object.hasOwn(reviewed, 'sourceCoverage')).toBe(false);
    expect(getReviewedExtractionCoverage(material)).toBeNull();
    expect(getReviewedExtractionCoverage(reviewed)).toBeNull();
    expect(reviewed.raw).toBe(material.raw);
    expect(JSON.stringify(material)).toBe(snapshot);
  });

  it('keeps malformed historical raw output intact while using existing counts for display', () => {
    const originalSource = source(), material = { ...legacy(originalSource), raw: '旧版损坏回答，保持原样' };
    const reviewed = reviewMaterialCoverage(material, originalSource);
    expect(getReviewedExtractionCoverage(reviewed)).toMatchObject({ rawCount: 1, acceptedCount: 1, rejectedCount: 0 });
    expect(reviewed.raw).toBe('旧版损坏回答，保持原样');
  });
});

const repeatedText = (worker: string) => `${worker}2024年7月完整应付工资8000元`;
const repeatedEntries = (worker: string, blockId = 'b1'): RawCandidateV3[] => {
  const amount: RawCandidateV3 = { ...money(), quote: repeatedText(worker), subject: worker, blockId };
  return [amount, { ...amount, kind: 'date', value: '2024年7月', meaning: 'wage_period', completeness: 'not_applicable', period: null }];
};
const forVersion = (version: 2 | 3, original: FactSource, entries: RawCandidateV3[]) => version === 2 ? legacy(original, entries) : current(original, entries);
const covered = (coverage: ExtractionCoverage | null, kind: 'money' | 'date') => coverage!.signals.filter(signal => signal.kind === kind).map(signal => signal.covered);

describe('runtime coverage is limited to each candidate value occurrence', () => {
  it.each([2, 3] as const)('v%s warns about unextracted equal amounts and dates in the same block', version => {
    const original = source(`${repeatedText('王甲')}。${repeatedText('李乙')}。`);
    const material = forVersion(version, original, repeatedEntries('王甲')), snapshot = structuredClone(material);
    const frozen = getExtractionCoverage(material, original);
    // Baseline reproduction: one worker's candidates cover both workers' literals.
    expect(frozen?.status).toBe('no_signal');
    expect(covered(frozen, 'money')).toEqual([true, true]);
    expect(covered(frozen, 'date')).toEqual([true, true]);
    const reviewed = reviewMaterialCoverage(material, original), coverage = getReviewedExtractionCoverage(reviewed);
    expect(coverage?.status).toBe('possible_missing');
    expect(covered(coverage, 'money')).toEqual([true, false]);
    expect(covered(coverage, 'date')).toEqual([true, false]);
    expect(coverage).toMatchObject({ rawCount: 2, acceptedCount: 2, rejectedCount: 0 });
    expect(coverage?.message).toContain('人工核对');
    expect(coverage?.signals.map(signal => ({ ...signal, covered: false }))).toEqual(frozen?.signals.map(signal => ({ ...signal, covered: false })));
    expect(reviewed.raw).toBe(material.raw);
    expect(reviewed.candidates).toEqual(material.candidates);
    expect((reviewed as { schemaVersion?: number }).schemaVersion).toBe(version);
    expect(material).toEqual(snapshot);
    if (version === 3) expect((reviewed as FactMaterialV3).coverage).toEqual((material as FactMaterialV3).coverage);
    expect(reviewMaterialCoverage(reviewed, original)).toEqual(reviewed);
  });

  it.each([2, 3] as const)('v%s covers both equal occurrences when each has its own accepted candidates', version => {
    const original = source(`${repeatedText('王甲')}。${repeatedText('李乙')}。`);
    const material = forVersion(version, original, [...repeatedEntries('王甲'), ...repeatedEntries('李乙')]);
    expect(material.candidates).toHaveLength(4);
    const coverage = getReviewedExtractionCoverage(reviewMaterialCoverage(material, original));
    expect(coverage?.status).toBe('no_signal');
    expect(covered(coverage, 'money')).toEqual([true, true]);
    expect(covered(coverage, 'date')).toEqual([true, true]);
    expect(coverage?.signals.every(signal => signal.covered)).toBe(true);
  });

  it.each(['first', 'second'])('uses the actual Unicode span for the %s occurrence instead of the first equal literal', position => {
    const first = '𠮷甲', selected = position === 'first' ? first : '李乙';
    const original = source(`😀${repeatedText(first)}。${repeatedText('李乙')}。`);
    const material = current(original, repeatedEntries(selected));
    const coverage = getReviewedExtractionCoverage(reviewMaterialCoverage(material, original));
    const expected = position === 'first' ? [true, false] : [false, true];
    expect(covered(coverage, 'money')).toEqual(expected);
    expect(covered(coverage, 'date')).toEqual(expected);
    for (const signal of coverage!.signals) expect(Array.from(original.blocks[0].text).slice(signal.start, signal.end).join('')).toBe(signal.text);
    for (const candidate of material.candidates) expect(Array.from(original.blocks[0].text).slice(candidate.start, candidate.end).join('')).toBe(candidate.quote);
    expect(material.candidates[0].start).toBe(position === 'first' ? 1 : Array.from(`😀${repeatedText(first)}。`).length);
  });

  it('covers equal amounts from distinct periods and roles using separate candidate anchors', () => {
    const first = repeatedEntries('王甲'), second = repeatedEntries('王甲').map(candidate => ({ ...candidate,
      quote: candidate.quote.replace('2024年7月', '2024年8月').replace('应付', '已付'),
      value: candidate.kind === 'date' ? '2024年8月' : candidate.value,
      period: candidate.kind === 'money' ? '2024年8月' : null,
      meaning: candidate.kind === 'money' ? 'paid_total' as const : candidate.meaning,
    }));
    const original = source(`${first[0].quote}。${second[0].quote}。`), material = current(original, [...first, ...second]);
    expect(material.candidates).toHaveLength(4);
    const coverage = getReviewedExtractionCoverage(reviewMaterialCoverage(material, original));
    expect(coverage?.status).toBe('no_signal');
    expect(covered(coverage, 'money')).toEqual([true, true]);
    expect(covered(coverage, 'date')).toEqual([true, true]);
  });

  it.each(['每月15日', '2024年7月', '2024-07-15'])('does not cover an omitted second date occurrence: %s', value => {
    const quote = `王甲${value}支付工资`, original = source(`${quote}。李乙${value}支付工资。`);
    const material = current(original, [{ ...date(), value, quote, meaning: 'payment_date' }]);
    expect(getExtractionCoverage(material, original)?.status).toBe('no_signal');
    const coverage = getReviewedExtractionCoverage(reviewMaterialCoverage(material, original));
    expect(coverage?.status).toBe('possible_missing');
    expect(covered(coverage, 'date')).toEqual([true, false]);
  });

  it('covers an exact amount signal inside a larger rate value only at that value position', () => {
    const quote = '王甲月薪8000元/月', original = source(`${quote}。李乙月薪8000元/月。`);
    const material = current(original, [{ ...money(), value: '8000元/月', quote, meaning: 'rate', rateUnit: 'month', completeness: 'not_applicable', period: null }]);
    const coverage = getReviewedExtractionCoverage(reviewMaterialCoverage(material, original));
    expect(covered(coverage, 'money')).toEqual([true, false]);
    expect(coverage?.status).toBe('possible_missing');
  });

  it.each([false, true])('keeps equal literals in different blocks independent (both extracted: %s)', all => {
    const original = source();
    original.blocks = ['王甲', '李乙'].map((worker, index) => ({ ...original.blocks[0], id: `b${index + 1}`, text: `${repeatedText(worker)}。` }));
    const entries = [...repeatedEntries('王甲'), ...(all ? repeatedEntries('李乙', 'b2') : [])];
    const material = current(original, entries), coverage = getReviewedExtractionCoverage(reviewMaterialCoverage(material, original));
    expect(covered(coverage, 'money')).toEqual([true, all]);
    expect(covered(coverage, 'date')).toEqual([true, all]);
    expect(coverage?.status).toBe(all ? 'no_signal' : 'possible_missing');
  });

  it.each(['start', 'end', 'sha', 'evidence', 'representation'] as const)('does not claim coverage from a candidate with invalid %s anchoring', invalid => {
    const original = source(`${repeatedText('王甲')}。`), material = current(original, repeatedEntries('王甲'));
    for (const candidate of material.candidates) {
      if (invalid === 'start') candidate.start++;
      if (invalid === 'end') candidate.end++;
      if (invalid === 'sha') candidate.sourceSha256 = 'd'.repeat(64);
      if (invalid === 'evidence') candidate.evidenceId = 'another-source';
      if (invalid === 'representation') candidate.representation.quote = '8000元';
    }
    expect(getExtractionCoverage(material, original)?.status).toBe('no_signal');
    const snapshot = structuredClone(material), coverage = getReviewedExtractionCoverage(reviewMaterialCoverage(material, original));
    expect(coverage?.status).toBe('possible_missing');
    expect(coverage?.signals.every(signal => !signal.covered)).toBe(true);
    expect(material).toEqual(snapshot);
  });

  it('does not select one occurrence when the same quote repeats inside its block', () => {
    const quote = repeatedText('王甲'), original = source(`${quote}。${quote}。`);
    const material = current(original, repeatedEntries('王甲'));
    const coverage = getReviewedExtractionCoverage(reviewMaterialCoverage(material, original));
    expect(covered(coverage, 'money')).toEqual([false, false]);
    expect(covered(coverage, 'date')).toEqual([false, false]);
    expect(coverage?.status).toBe('possible_missing');
  });

  it('does not select one value occurrence from an otherwise unique quote', () => {
    const quote = '王甲本月工资8000元及补贴8000元', original = source(`${quote}。`);
    const material = current(original, [{ ...money(), quote, period: null }]);
    expect(getExtractionCoverage(material, original)?.status).toBe('no_signal');
    const coverage = getReviewedExtractionCoverage(reviewMaterialCoverage(material, original));
    expect(covered(coverage, 'money')).toEqual([false, false]);
    expect(coverage?.status).toBe('possible_missing');
  });

  it('requires an independent wage-period date with the money subject at the same source span', () => {
    const original = source(`${repeatedText('王甲')}。${repeatedText('李乙')}。`);
    const [amount] = repeatedEntries('王甲'), [, secondDate] = repeatedEntries('李乙');
    const material = current(original, [amount, { ...secondDate, subject: '王甲' }]);
    const coverage = getReviewedExtractionCoverage(reviewMaterialCoverage(material, original));
    expect(coverage?.signals.find(signal => signal.kind === 'wage_period')?.covered).toBe(false);
    expect(covered(coverage, 'date')).toEqual([false, true]);
    expect(coverage?.status).toBe('possible_missing');
  });
});
