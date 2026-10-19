import type { FactSource, FactState } from './material-fact-types';
import type { CandidateBatchV3, FactMaterialV3 } from './material-fact-types-v3';
import { diagnoseExtractionCoverage, ingestCandidates as ingestFrozenCandidates, isV3Candidate, parseCandidateOutput, validateCandidateOutput } from './material-facts-v3.ts';
import { reviewCandidateAgainstSource } from './material-fact-source-review.ts';
import { classifyMonetaryExpression, normalizeMoneyValueV4 } from './material-money-v4.ts';

/** Production-only acceptance adapter. Frozen evaluators keep their original
 * validator, outputs and scores; existing stored extractions are not reparsed.
 */
export function validateRuntimeCandidateOutput(raw: string, source: FactSource): CandidateBatchV3 {
  // Validate the original envelope and its 40-entry/source limits before splitting.
  const original = validateCandidateOutput(raw, source);
  const parsed = parseCandidateOutput(raw).parsed as { schemaVersion: 3; candidates: unknown[] };
  const candidates: CandidateBatchV3['candidates'] = [], rejected: CandidateBatchV3['rejected'] = [];
  type Occurrence = { blockId: string; start: number; end: number };
  const seen = new Map<string, Array<{ occurrence: Occurrence | null; fallback: string }>>();
  parsed.candidates.forEach((entry, index) => {
    const single = validateCandidateOutput(JSON.stringify({ schemaVersion: 3, candidates: [entry] }), source);
    const accepted = single.candidates[0];
    if (!accepted) {
      rejected.push(...single.rejected.map(item => ({ ...item, index })));
      return;
    }
    const value = accepted.representation;
    if (value.kind === 'money' && classifyMonetaryExpression(value.value).kind === 'not_monetary') {
      rejected.push({ index, reason: 'money 候选原文没有金额表达，仅为日期、计数或工资描述；原始输出仍保留，未补金额或置零' });
      return;
    }
    // Parse the raw literal, then constrain it against the actual source below.
    // A cropped quote may omit a valid RMB marker as well as an unsafe modifier;
    // quote-only failure must not bypass that full-source review on a fresh run.
    const normalized = value.kind === 'money' ? normalizeMoneyValueV4(value.value) : accepted.normalization;
    const candidate = { ...accepted, amount: normalized.amount, normalization: normalized,
      id: `${source.id}:${source.analysisRevision}:${index}`, outputFormat: original.format };
    const reviewed = reviewCandidateAgainstSource(candidate, source);
    const normalization = isV3Candidate(reviewed) ? reviewed.normalization : candidate.normalization;
    // Source identity is required even for exact values: two payments with the
    // same amount and attributes are not proven to be one event. Only a uniquely
    // anchored repeat at the same position may collapse. No first-occurrence guess.
    const block = source.blocks.find(item => item.id === candidate.blockId);
    const quoteAt = block?.text.indexOf(candidate.quote) ?? -1, valueAt = candidate.quote.indexOf(value.value);
    const uniqueAnchor = block && quoteAt >= 0 && block.text.indexOf(candidate.quote, quoteAt + 1) < 0
      && valueAt >= 0 && candidate.quote.indexOf(value.value, valueAt + 1) < 0;
    const anchorStart = uniqueAnchor ? Array.from(block.text.slice(0, quoteAt + valueAt)).length : null;
    const occurrence = anchorStart !== null ? { blockId: candidate.blockId, start: anchorStart,
      end: anchorStart + Array.from(value.value).length } : null;
    const fallback = JSON.stringify([candidate.blockId, candidate.start, candidate.end, candidate.quote]);
    const key = JSON.stringify([value.kind, value.meaning, normalization.status,
      normalization.amount ?? normalization.rawValue, value.subject, value.scope, value.period,
      value.completeness, value.assertion, value.rateUnit,
      // A source-normalization downgrade reached via a cropped quote is not a
      // new observation when the final status/value and anchor already match.
      isV3Candidate(reviewed) ? reviewed.reviewIssues.map(issue => String(issue.code))
        .filter(code => code !== 'source_amount_context_mismatch').sort() : []]);
    const observations = seen.get(key) ?? [];
    const duplicate = observations.some(previous => occurrence && previous.occurrence
      ? occurrence.blockId === previous.occurrence.blockId
        && ((occurrence.start <= previous.occurrence.start && occurrence.end >= previous.occurrence.end)
          || (previous.occurrence.start <= occurrence.start && previous.occurrence.end >= occurrence.end))
      : !occurrence && !previous.occurrence && fallback === previous.fallback);
    // Equivalent nested literals (人民币四万元 / 四万元) refer to the same
    // uniquely located amount. Non-overlapping occurrences remain separate.
    if (duplicate) {
      rejected.push({ index, reason: '同一源文位置、同一事实属性及规范化状态的候选重复；不同发生位置及待核金额分别保留' });
      return;
    }
    observations.push({ occurrence, fallback });
    seen.set(key, observations);
    candidates.push(isV3Candidate(reviewed) ? reviewed : candidate);
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
