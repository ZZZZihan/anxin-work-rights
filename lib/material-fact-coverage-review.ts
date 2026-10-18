import type { FactMaterial, FactSource } from './material-fact-types';
import type { ExtractionCoverage } from './material-fact-types-v3';
import { getExtractionCoverage } from './material-facts-v3.ts';

type SourceReviewedMaterial = FactMaterial & { sourceCoverage?: ExtractionCoverage };

/**
 * Derive a display diagnostic from the currently bound source, including legacy
 * v2 records. The caller verifies source identity/revision before passing it in.
 * This does not migrate a stored schema, rewrite extraction output or add facts.
 */
export function reviewMaterialCoverage(material: FactMaterial, source?: FactSource): FactMaterial {
  const reviewed: SourceReviewedMaterial = { ...material };
  // A prior runtime response is not evidence that the source is still available.
  delete reviewed.sourceCoverage;
  if (source) {
    const coverage = getExtractionCoverage(material, source);
    if (coverage) reviewed.sourceCoverage = coverage;
  }
  return reviewed;
}

/** Prefer current source-derived diagnostics; retain frozen v3 display compatibility. */
export function getReviewedExtractionCoverage(material: FactMaterial): ExtractionCoverage | null {
  if (material.status !== 'extracted') return null;
  return (material as SourceReviewedMaterial).sourceCoverage ?? getExtractionCoverage(material);
}
