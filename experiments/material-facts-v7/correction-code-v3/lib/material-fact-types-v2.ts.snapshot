import type { Assertion, CandidateBatch, FactCandidate, FactMaterial } from './material-fact-types';

// Persisted state and user confirmations retain their existing lifecycle.
export * from './material-fact-types';

export type CandidateOutputFormat = 'json' | 'outer_fence';
export type CandidateScope = 'individual' | 'group' | 'organization' | 'unknown';
export type CandidateCompleteness = 'complete' | 'partial' | 'unknown' | 'not_applicable';
export type MoneyMeaning = 'due_total' | 'paid_total' | 'payment' | 'arrears' | 'award' | 'rate' | 'other_money';
export type DateMeaning = 'employment_period' | 'wage_period' | 'contract_signing' | 'contract_performance' | 'payment_date' | 'other_date';
export type RateUnit = 'month' | 'day' | 'hour' | 'piece' | 'unknown';

/** All strings are source literals; derived numbers never replace this representation. */
export type RawCandidateV2 = {
  kind: 'money' | 'date';
  value: string;
  quote: string;
  blockId: string;
  subject: string | null;
  scope: CandidateScope;
  meaning: MoneyMeaning | DateMeaning;
  completeness: CandidateCompleteness;
  period: string | null;
  rateUnit: RateUnit | null;
  assertion: Assertion;
};

export type FactReviewIssueCode =
  | 'scope_text_mismatch'
  | 'partial_due_total'
  | 'partial_paid_total'
  | 'contract_signing_as_employment'
  | 'rate_unit_mismatch'
  | 'rate_unit_unresolved';
export type FactReviewIssue = { code: FactReviewIssueCode; message: string };

/** Legacy kind/qualifier are display compatibility only; representation is authoritative. */
export type FactCandidateV2 = FactCandidate & {
  schemaVersion: 2;
  representation: RawCandidateV2;
  reviewIssues: FactReviewIssue[];
  outputFormat: CandidateOutputFormat;
};
export type CandidateBatchV2 = Omit<CandidateBatch, 'candidates'> & {
  candidates: FactCandidateV2[];
  format: CandidateOutputFormat;
};
export type FactMaterialV2 = Omit<FactMaterial, 'candidates'> & {
  candidates: FactCandidateV2[];
  schemaVersion: 2;
  outputFormat: CandidateOutputFormat;
};
export type ParsedCandidateOutput = { raw: string; format: CandidateOutputFormat; parsed: unknown };
export type NormalizedCandidateValue = { value: string; amount: string | null; rateUnit: RateUnit | null };
