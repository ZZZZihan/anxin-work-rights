import type { FactCandidate, FactMaterial, FactSource } from './material-fact-types';
import type { CoverageSignal, ExtractionCoverage, RawCandidateV3 } from './material-fact-types-v3';
import { getCandidateRepresentation, getExtractionCoverage } from './material-facts-v3.ts';

type SourceReviewedMaterial = FactMaterial & { sourceCoverage?: ExtractionCoverage };
type AnchoredValue = { raw: RawCandidateV3; blockId: string; start: number; end: number };

/** Resolve only the candidate's exact value occurrence, never every equal literal. */
function anchorValue(candidate: FactCandidate, source: FactSource): AnchoredValue | null {
  const raw = getCandidateRepresentation(candidate);
  if (!raw || candidate.evidenceId !== source.id || candidate.sourceSha256 !== source.sha256
    || raw.value !== candidate.value || raw.quote !== candidate.quote || raw.blockId !== candidate.blockId) return null;
  const block = source.blocks.find(item => item.id === candidate.blockId);
  if (!block || !Number.isInteger(candidate.start) || !Number.isInteger(candidate.end) || candidate.start < 0 || candidate.end <= candidate.start) return null;
  const quoteStart = block.text.indexOf(candidate.quote);
  if (quoteStart < 0 || block.text.indexOf(candidate.quote, quoteStart + 1) >= 0) return null;
  const start = Array.from(block.text.slice(0, quoteStart)).length;
  if (candidate.start !== start || candidate.end !== start + Array.from(candidate.quote).length) return null;
  const valueStart = candidate.quote.indexOf(candidate.value);
  if (valueStart < 0 || candidate.quote.indexOf(candidate.value, valueStart + 1) >= 0) return null;
  const valueOffset = start + Array.from(candidate.quote.slice(0, valueStart)).length;
  return { raw, blockId: block.id, start: valueOffset, end: valueOffset + Array.from(candidate.value).length };
}

function coversSignal(anchor: AnchoredValue, signal: CoverageSignal, material: FactMaterial): boolean {
  if (anchor.blockId !== signal.blockId || anchor.start > signal.start || anchor.end < signal.end) return false;
  if (signal.kind !== 'wage_period') return anchor.raw.kind === signal.kind;
  // Keep the frozen requirement for an independent wage-period date with the
  // money candidate's subject, and additionally bind it to this source position.
  return anchor.raw.kind === 'date' && anchor.raw.meaning === 'wage_period' && anchor.raw.value === signal.text
    && material.candidates.some(candidate => {
      const raw = getCandidateRepresentation(candidate);
      return raw?.kind === 'money' && raw.period === signal.text && raw.subject === anchor.raw.subject;
    });
}

function reviewCoverageSpans(material: FactMaterial, source: FactSource, coverage: ExtractionCoverage): ExtractionCoverage {
  const anchors = material.candidates.map(candidate => anchorValue(candidate, source)).filter((anchor): anchor is AnchoredValue => anchor !== null);
  const signals = coverage.signals.map(signal => ({ ...signal,
    // Runtime review can only reduce coverage reported by the frozen heuristic.
    covered: signal.covered && anchors.some(anchor => coversSignal(anchor, signal, material)),
  }));
  if (coverage.status === 'no_signal' && signals.some(signal => !signal.covered)) return {
    ...coverage, signals, status: 'possible_missing',
    message: '原文仍有可能未覆盖的金额或日期线索；相同文字在另一处出现，不代表当前原文位置已经提取。此为启发式提示，请人工核对。',
  };
  return { ...coverage, signals };
}

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
    if (coverage) reviewed.sourceCoverage = reviewCoverageSpans(material, source, coverage);
  }
  return reviewed;
}

/** Prefer current source-derived diagnostics; retain frozen v3 display compatibility. */
export function getReviewedExtractionCoverage(material: FactMaterial): ExtractionCoverage | null {
  if (material.status !== 'extracted') return null;
  return (material as SourceReviewedMaterial).sourceCoverage ?? getExtractionCoverage(material);
}
