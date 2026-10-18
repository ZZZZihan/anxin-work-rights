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
function current(material: FactSource): FactMaterialV3 {
  const raw = `\`\`\`json\n${JSON.stringify({ schemaVersion: 3, candidates: [money()] })}\n\`\`\``;
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
