import { describe, expect, it } from 'vitest';
import { validateRuntimeCandidateOutput } from './material-fact-runtime-ingest';
import type { FactSource } from './material-fact-types';
import type { RawCandidateV3 } from './material-fact-types-v3';

describe('calendar wage period is not a rate cue', () => {
  it.each(['2026年1月', '2026年一月', '2026年10月', '2026年1月1日'])('retains a payment amount after %s without declaring its relationship verified', period => {
    const quote = `2026年2月1日单位向王甲支付${period}工资1000元。`;
    const source: FactSource = { id: 'calendar', name: 'synthetic', sha256: 'a'.repeat(64), ready: true, analysisRevision: 1, blocks: [{ id: 'b', page: 1, text: quote, bbox: null, confidence: null }] };
    const entry: RawCandidateV3 = { kind: 'money', value: '1000元', quote, blockId: 'b', subject: '王甲', scope: 'individual', meaning: 'payment', completeness: 'partial', period, rateUnit: null, assertion: 'narrated' };
    const candidate = validateRuntimeCandidateOutput(JSON.stringify({ schemaVersion: 3, candidates: [entry] }), source).candidates[0];
    expect(candidate.amount).toBe('1000.00');
    expect(candidate.reviewIssues.map(issue => issue.code)).not.toContain('rate_unit_mismatch');
    expect(candidate.reviewIssues.map(issue => issue.code)).toContain('source_relation_unresolved');
  });
});
