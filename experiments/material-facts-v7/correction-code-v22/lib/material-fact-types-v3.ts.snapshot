import type { CandidateBatch, FactCandidate, FactMaterial } from './material-fact-types';
import type { CandidateOutputFormat, RateUnit, RawCandidateV2 } from './material-fact-types-v2';

export * from './material-fact-types';
export type { CandidateOutputFormat, CandidateScope, CandidateCompleteness, MoneyMeaning, DateMeaning, RateUnit, ParsedCandidateOutput } from './material-fact-types-v2';

/** Version changes the contract, not the eleven fields requested from the model. */
export type RawCandidateV3 = RawCandidateV2;
export type MoneyNormalizationStatus = 'exact' | 'multiple_amounts' | 'range' | 'approximate' | 'masked' | 'uncertain' | 'percentage' | 'unsupported' | 'rate_unit_mismatch' | 'not_money';
export type CandidateNormalization = {
  rawValue: string;
  status: MoneyNormalizationStatus;
  amount: string | null;
  matchedText: string | null;
  /** Half-open Unicode code point positions within rawValue, never within a repaired string. */
  span: { start: number; end: number } | null;
  reason: string;
};
export type NormalizedCandidateValue = { value: string; amount: string | null; rateUnit: RateUnit | null; normalization: CandidateNormalization };
export type FactReviewIssueCode = 'scope_text_mismatch' | 'partial_due_total' | 'partial_paid_total' | 'contract_signing_as_employment' | 'rate_unit_mismatch' | 'rate_unit_unresolved' | 'local_context_ambiguous';
export type FactReviewIssue = { code: FactReviewIssueCode; message: string };
export type CoverageStatus = 'empty' | 'none_accepted' | 'possible_missing' | 'no_signal';
export type CoverageSignal = { kind: 'money' | 'date' | 'wage_period'; blockId: string; text: string; start: number; end: number; covered: boolean };
export type ExtractionCoverage = {
  heuristic: true;
  status: CoverageStatus;
  message: string;
  rawCount: number;
  acceptedCount: number;
  rejectedCount: number;
  signals: CoverageSignal[];
};
export type FactCandidateV3 = FactCandidate & { schemaVersion: 3; representation: RawCandidateV3; normalization: CandidateNormalization; reviewIssues: FactReviewIssue[]; outputFormat: CandidateOutputFormat };
export type CandidateBatchV3 = Omit<CandidateBatch, 'candidates'> & { candidates: FactCandidateV3[]; format: CandidateOutputFormat; coverage: ExtractionCoverage };
export type FactMaterialV3 = Omit<FactMaterial, 'candidates'> & { candidates: FactCandidateV3[]; schemaVersion: 3; outputFormat: CandidateOutputFormat; coverage: ExtractionCoverage };
