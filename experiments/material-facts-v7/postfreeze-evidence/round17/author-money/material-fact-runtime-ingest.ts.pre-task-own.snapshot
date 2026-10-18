import type { FactSource, FactState } from './material-fact-types';
import type { CandidateBatchV3, FactMaterialV3 } from './material-fact-types-v3';
import { diagnoseExtractionCoverage, ingestCandidates as ingestFrozenCandidates, isV3Candidate, parseCandidateOutput, validateCandidateOutput } from './material-facts-v3.ts';
import { reviewCandidateAgainstSource } from './material-fact-source-review.ts';

/** Production-only acceptance adapter. Frozen evaluators keep their original
 * validator, outputs and scores; existing stored extractions are not reparsed.
 */
export function validateRuntimeCandidateOutput(raw: string, source: FactSource): CandidateBatchV3 {
  // Validate the original envelope and its 40-entry/source limits before splitting.
  const original = validateCandidateOutput(raw, source);
  const parsed = parseCandidateOutput(raw).parsed as { schemaVersion: 3; candidates: unknown[] };
  const candidates: CandidateBatchV3['candidates'] = [], rejected: CandidateBatchV3['rejected'] = [];
  const seen = new Set<string>();
  parsed.candidates.forEach((entry, index) => {
    const single = validateCandidateOutput(JSON.stringify({ schemaVersion: 3, candidates: [entry] }), source);
    const accepted = single.candidates[0];
    if (!accepted) {
      rejected.push(...single.rejected.map(item => ({ ...item, index })));
      return;
    }
    const candidate = { ...accepted, id: `${source.id}:${source.analysisRevision}:${index}`, outputFormat: original.format };
    const reviewed = reviewCandidateAgainstSource(candidate, source);
    const normalization = isV3Candidate(reviewed) ? reviewed.normalization : candidate.normalization;
    const value = candidate.representation;
    // Cropped quotes must not hide a modifier from identity either. Distinct
    // unresolved observations retain their locations; exact semantic duplicates
    // still collapse, while a blocked observation cannot suppress a usable one.
    const block = source.blocks.find(item => item.id === candidate.blockId);
    const quoteAt = block?.text.indexOf(candidate.quote) ?? -1, valueAt = candidate.quote.indexOf(value.value);
    const uniqueAnchor = block && quoteAt >= 0 && block.text.indexOf(candidate.quote, quoteAt + 1) < 0
      && valueAt >= 0 && candidate.quote.indexOf(value.value, valueAt + 1) < 0;
    const anchorStart = uniqueAnchor ? Array.from(block.text.slice(0, quoteAt + valueAt)).length : null;
    const unresolvedLocation = ['exact', 'not_money'].includes(normalization.status) ? null
      : anchorStart !== null ? [candidate.blockId, anchorStart, anchorStart + Array.from(value.value).length]
        : [candidate.blockId, candidate.start, candidate.end, candidate.quote];
    const key = JSON.stringify([value.kind, value.meaning, normalization.status,
      normalization.amount ?? normalization.rawValue, value.subject, value.scope, value.period,
      value.completeness, value.assertion, value.rateUnit,
      // A source-normalization downgrade reached via a cropped quote is not a
      // new observation when the final status/value and anchor already match.
      isV3Candidate(reviewed) ? reviewed.reviewIssues.map(issue => String(issue.code))
        .filter(code => code !== 'source_amount_context_mismatch').sort() : [], unresolvedLocation]);
    if (seen.has(key)) {
      rejected.push({ index, reason: '同一事实、同一陈述属性及同一源文规范化状态的候选重复；精确金额与有修饰或待核金额分别保留' });
      return;
    }
    seen.add(key);
    candidates.push(candidate);
  });
  const batch = { ...original, candidates, rejected };
  return { ...batch, coverage: diagnoseExtractionCoverage(source, batch) };
}

export function ingestRuntimeCandidates(state: FactState, source: FactSource, batch: { raw: string }, backend: string, actor: string, at: string, model: string | null = null): FactState {
  const checked = validateRuntimeCandidateOutput(batch.raw, source);
  // Reuse the existing state transition, history and confirmation invalidation.
  const next = ingestFrozenCandidates(state, source, batch, backend, actor, at, model);
  const material = next.materials.find(item => item.evidenceId === source.id) as FactMaterialV3;
  material.candidates = checked.candidates;
  material.rejected = checked.rejected;
  material.coverage = checked.coverage;
  return next;
}
