import type { MaterialBlock } from './material-types';

export type CandidateKind = 'worker' | 'employer' | 'period' | 'monthly_rate' | 'due_total' | 'paid_total' | 'arrears' | 'award' | 'payment' | 'other_amount';
export type Assertion = 'claimed' | 'admitted' | 'decided' | 'narrated' | 'unknown';
export type Qualifier = 'wage_period' | 'employment_period' | 'contract_period' | 'other_period' | 'gross' | 'net' | 'partial' | 'unknown';
export type RawCandidate = { kind: CandidateKind; value: string; quote: string; blockId: string; subject: string | null; period: string | null; qualifier: Qualifier; assertion: Assertion };
export type FactSource = { id: string; name: string; sha256: string; analysisRevision: number; ready: boolean; blocks: MaterialBlock[] };
export type FactCandidate = RawCandidate & { id: string; evidenceId: string; sourceSha256: string; page: number; start: number; end: number; amount: string | null };
export type CandidateBatch = { candidates: FactCandidate[]; rejected: { index: number; reason: string }[]; rawCount: number; raw: string };
export type FactScope = { worker: string; employer: string; start: string; end: string };
export type AmountField = 'due' | 'paid';
export type FactConfirmation = { amount: string; cents: number; note: string; reviewedCandidateIds: string[]; actor: string; at: string; mode: 'user_attested' };
export type FactAudit = { id: number; type: string; actor: string; at: string; field?: string; evidenceId?: string; generation: number };
export type FactMaterial = { evidenceId: string; signature: string; status: 'extracted' | 'excluded'; candidates: FactCandidate[]; rejected: CandidateBatch['rejected']; backend: string | null; raw: string | null; model: string | null; exclusionReason: string | null };
export type FactJob = { id: string; evidenceId: string; generation: number; status: 'running' | 'failed'; error: string | null; startedAt?: string; submissionPending?: boolean; pollFailureSince?: string; raw?: string; backend?: string; model?: string | null };
export type FactCalculation = { due: string; paid: string; gap: string; at: string; actor: string; generation: number; receiptId: string };
export type FactState = { version: 1; generation: number; scope: FactScope | null; scopeReview: { note: string; actor: string; at: string } | null; confirmations: { due: FactConfirmation | null; paid: FactConfirmation | null }; materials: FactMaterial[]; history: FactAudit[]; job: FactJob | null; calculation: FactCalculation | null };
export type FactAction =
  | { action: 'confirm_scope'; scope: FactScope; note: string; verified: true }
  | { action: 'confirm_amount'; field: AmountField; amount: string; note: string; reviewedCandidateIds: string[]; complete: true; verified: true }
  | { action: 'revoke'; field: AmountField | 'scope' }
  | { action: 'exclude_source'; evidenceId: string; reason: string }
  | { action: 'extract'; evidenceId: string }
  | { action: 'calculate' };
export type CalculationPlan = { dueCents: number; paidCents: number; generation: number };
export type FactFieldView = { status: 'unknown' | 'candidate' | 'conflict' | 'confirmed'; values: string[]; confirmation: FactConfirmation | null };
export type MaterialFactsResponse = { revision: number; generation: number; stale: boolean; state: FactState; candidates: FactCandidate[]; fields: { due: FactFieldView; paid: FactFieldView }; unresolved: string[]; canCalculate: boolean; sources: Omit<FactSource, 'blocks'>[]; backend: string; configured: boolean };
