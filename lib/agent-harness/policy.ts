import {
  ActionProposalSchema, HarnessStateSchema, TOOL_POLICIES, ToolCallInputSchema, ToolResultSchema,
  TrustedFactsSnapshotSchema, TrustedScopeSchema, UserCalculationRequestSchema,
  type ActionProposal, type ErrorCode, type HarnessState, type ToolEffect,
  type ToolCallInput, type ToolResultRef, type TrustedFactsSnapshot, type TrustedScope, type UserCalculationRequest,
} from './contracts';

export class HarnessPolicyError extends Error {
  constructor(public readonly code: ErrorCode) {
    // Codes are deliberately safe to persist. Never copy model/backend text here.
    super(code);
    this.name = 'HarnessPolicyError';
  }
}

export type PolicyContext = {
  scope: TrustedScope;
  currentFacts: TrustedFactsSnapshot | null;
  userRequest: UserCalculationRequest | null;
  allowStartExtraction: boolean;
  /** IDs resolved by the authenticated server for this case, never by the model. */
  permittedEvidenceIds?: readonly string[];
  permittedJobIds?: readonly string[];
  now: number;
};

function sameIdentity(left: Pick<TrustedScope, 'ownerId' | 'caseId' | 'runId'>,
  right: Pick<TrustedScope, 'ownerId' | 'caseId' | 'runId'>): boolean {
  return left.ownerId === right.ownerId && left.caseId === right.caseId && left.runId === right.runId;
}

function sameSnapshot(left: { revision: number; generation: number },
  right: { revision: number; generation: number }): boolean {
  return left.revision === right.revision && left.generation === right.generation;
}

function assertScope(actual: TrustedScope, expected: TrustedScope): void {
  if (!sameIdentity(actual, expected)) throw new HarnessPolicyError('forbidden');
  if (!sameSnapshot(actual, expected)) throw new HarnessPolicyError('stale_snapshot');
}

function parseState(value: HarnessState): HarnessState {
  const parsed = HarnessStateSchema.safeParse(value);
  if (!parsed.success) throw new HarnessPolicyError('invalid_input');
  return parsed.data;
}

export function consumeBudget(state: HarnessState, input: { toolCall: boolean; now: number }): HarnessState {
  const parsed = parseState(state);
  if (!Number.isSafeInteger(input.now) || input.now < 0) throw new HarnessPolicyError('invalid_input');
  if (parsed.status !== 'running') throw new HarnessPolicyError('conflict');
  if (input.now >= parsed.budget.deadlineAt || parsed.budget.remainingSteps === 0 ||
    (input.toolCall && parsed.budget.remainingToolCalls === 0)) throw new HarnessPolicyError('budget_exhausted');
  return { ...parsed, budget: {
    ...parsed.budget, remainingSteps: parsed.budget.remainingSteps - 1,
    remainingToolCalls: parsed.budget.remainingToolCalls - (input.toolCall ? 1 : 0),
  } };
}

export type AuthorizedProposal = {
  proposal: ActionProposal;
  /** Caller must atomically persist/claim this budget before executing. */
  nextState: HarnessState;
  effect: ToolEffect | 'control';
  timeoutMs: number;
  idempotencyKey: string | null;
};

function writeKey(scope: TrustedScope, proposal: ActionProposal, userRequest: UserCalculationRequest | null): string {
  const resource = proposal.action === 'start_extraction' ? proposal.evidenceId : userRequest!.requestId;
  // Length prefixes preserve uniqueness even when an ID itself contains ':'.
  return ['h1', scope.ownerId, scope.caseId, scope.runId, String(scope.revision),
    String(scope.generation), proposal.action, resource].map(part => `${part.length}:${part}`).join(':');
}

/** Validate a model suggestion against fresh authenticated server context.
 * This authorizes an attempt; adapters must still enforce ownership and CAS at
 * the actual read/write, because facts can change after this function returns.
 */
export function authorizeProposal(raw: unknown, state: HarnessState, context: PolicyContext): AuthorizedProposal {
  const proposalResult = ActionProposalSchema.safeParse(raw);
  const scopeResult = TrustedScopeSchema.safeParse(context.scope);
  if (!proposalResult.success || !scopeResult.success) throw new HarnessPolicyError('invalid_input');
  const proposal = proposalResult.data;
  const scope = scopeResult.data;
  const parsedState = parseState(state);
  if (!sameIdentity(parsedState, scope)) throw new HarnessPolicyError('forbidden');
  if (!sameSnapshot(parsedState.snapshot, scope) || !sameSnapshot(proposal.expectedSnapshot, scope)) {
    throw new HarnessPolicyError('stale_snapshot');
  }
  const control = proposal.action === 'ask_user' || proposal.action === 'finish';
  const nextState = consumeBudget(parsedState, { toolCall: !control, now: context.now });

  if (proposal.action === 'read_evidence_excerpt' || proposal.action === 'start_extraction') {
    if (!context.permittedEvidenceIds?.includes(proposal.evidenceId)) throw new HarnessPolicyError('forbidden');
  }
  if (proposal.action === 'get_job' && !context.permittedJobIds?.includes(proposal.jobId)) {
    throw new HarnessPolicyError('forbidden');
  }
  if (proposal.action === 'start_extraction' && context.allowStartExtraction !== true) {
    throw new HarnessPolicyError('extraction_disabled');
  }
  if (proposal.action === 'request_calculate') {
    if (!context.userRequest) throw new HarnessPolicyError('user_input_required');
    const userRequest = UserCalculationRequestSchema.safeParse(context.userRequest);
    if (!userRequest.success) throw new HarnessPolicyError('invalid_input');
    assertScope(userRequest.data.scope, scope);
    if (!context.currentFacts) throw new HarnessPolicyError('calculation_not_ready');
    const facts = TrustedFactsSnapshotSchema.safeParse(context.currentFacts);
    if (!facts.success) throw new HarnessPolicyError('calculation_not_ready');
    assertScope(facts.data.scope, scope);
    if (facts.data.stale || !facts.data.canCalculate || facts.data.due.status !== 'confirmed' ||
      facts.data.paid.status !== 'confirmed') throw new HarnessPolicyError('calculation_not_ready');
  }
  if (control) return { proposal, nextState, effect: 'control', timeoutMs: 0, idempotencyKey: null };
  const policy = TOOL_POLICIES[proposal.action];
  return { proposal, nextState, effect: policy.effect, timeoutMs: policy.timeoutMs,
    idempotencyKey: policy.effect === 'write' ? writeKey(scope, proposal, context.userRequest) : null };
}

/** Keep only an opaque result reference in checkpoints and traces. The raw
 * output (especially evidence text) belongs in a separately access-controlled
 * result store. The trusted scope must be refreshed after a reconcile/write.
 */
export function toolResultReference(raw: unknown, expectedCall: ToolCallInput,
  expectedResultScope: TrustedScope = expectedCall.scope): ToolResultRef {
  const parsed = ToolResultSchema.safeParse(raw);
  const call = ToolCallInputSchema.safeParse(expectedCall);
  const scope = TrustedScopeSchema.safeParse(expectedResultScope);
  if (!parsed.success || !call.success || !scope.success) throw new HarnessPolicyError('invalid_input');
  if (!sameIdentity(call.data.scope, scope.data)) throw new HarnessPolicyError('forbidden');
  if (call.data.scope.generation !== scope.data.generation || call.data.scope.revision > scope.data.revision) {
    throw new HarnessPolicyError('stale_snapshot');
  }
  assertScope(parsed.data.scope, scope.data);
  if (parsed.data.callId !== call.data.callId || parsed.data.tool !== call.data.tool) {
    throw new HarnessPolicyError('conflict');
  }
  if (parsed.data.status === 'ok') {
    const result = parsed.data;
    const input = call.data;
    if (result.tool === 'read_evidence_excerpt' && input.tool === 'read_evidence_excerpt' &&
      (result.data.evidenceId !== input.evidenceId || result.data.blockId !== input.blockId ||
        result.data.text.length > input.maxChars)) throw new HarnessPolicyError('conflict');
    if (result.tool === 'get_job' && input.tool === 'get_job' && result.data.jobId !== input.jobId) {
      throw new HarnessPolicyError('conflict');
    }
    if (result.tool === 'start_extraction' && input.tool === 'start_extraction' && result.data.evidenceId !== input.evidenceId) {
      throw new HarnessPolicyError('conflict');
    }
    if (result.tool === 'search_public' && input.tool === 'search_public' && result.data.sources.length > input.limit) {
      throw new HarnessPolicyError('conflict');
    }
  }
  return { callId: parsed.data.callId, tool: parsed.data.tool, resultRef: parsed.data.resultRef,
    status: parsed.data.status,
    snapshot: { revision: parsed.data.scope.revision, generation: parsed.data.scope.generation } };
}
