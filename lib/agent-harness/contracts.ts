import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);
const nonnegativeInt = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positiveInt = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const idempotencyKey = z.string().regex(/^[A-Za-z0-9_.:-]{1,1000}$/);

export const SnapshotSchema = z.strictObject({ revision: nonnegativeInt, generation: positiveInt });
export type Snapshot = z.infer<typeof SnapshotSchema>;

// Only the authenticated server may construct this scope. It is never model input.
export const TrustedScopeSchema = z.strictObject({
  ownerId: id, caseId: id, runId: id, ...SnapshotSchema.shape,
});
export type TrustedScope = z.infer<typeof TrustedScopeSchema>;

export const ToolNameSchema = z.enum([
  'read_facts', 'read_evidence_excerpt', 'search_public', 'get_job',
  'start_extraction', 'request_calculate',
]);
export type ToolName = z.infer<typeof ToolNameSchema>;

export const ErrorCodeSchema = z.enum([
  'invalid_input', 'forbidden', 'stale_snapshot', 'budget_exhausted',
  'user_input_required', 'calculation_not_ready', 'extraction_disabled',
  'not_found', 'conflict', 'unavailable', 'timeout', 'cancelled', 'internal',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const UserInputReasonSchema = z.enum([
  'confirm_scope', 'confirm_amounts', 'resolve_conflict', 'supply_evidence', 'clarify_request',
]);
export const UserInputFieldSchema = z.enum(['scope', 'due', 'paid', 'evidence', 'request']);

const expected = { expectedSnapshot: SnapshotSchema };
export const ActionProposalSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('read_facts'), ...expected }),
  z.strictObject({ action: z.literal('read_evidence_excerpt'), ...expected,
    evidenceId: id, blockId: id, maxChars: z.number().int().min(1).max(4000) }),
  z.strictObject({ action: z.literal('search_public'), ...expected,
    query: z.string().trim().min(1).max(500), limit: z.number().int().min(1).max(10) }),
  z.strictObject({ action: z.literal('get_job'), ...expected, jobId: id }),
  z.strictObject({ action: z.literal('start_extraction'), ...expected, evidenceId: id }),
  z.strictObject({ action: z.literal('request_calculate'), ...expected }),
  z.strictObject({ action: z.literal('ask_user'), ...expected,
    reason: UserInputReasonSchema, fields: z.array(UserInputFieldSchema).min(1).max(5)
      .refine(fields => new Set(fields).size === fields.length, 'Fields must be unique') }),
  z.strictObject({ action: z.literal('finish'), ...expected,
    reason: z.enum(['answered', 'needs_user', 'no_action', 'cannot_proceed']) }),
]);
export type ActionProposal = z.infer<typeof ActionProposalSchema>;

export const BudgetSchema = z.strictObject({
  remainingSteps: z.number().int().min(0).max(100),
  remainingToolCalls: z.number().int().min(0).max(100),
  deadlineAt: nonnegativeInt,
});
export type HarnessBudget = z.infer<typeof BudgetSchema>;

export const PendingUserInputSchema = z.strictObject({
  requestId: id, reason: UserInputReasonSchema,
  fields: z.array(UserInputFieldSchema).min(1).max(5), snapshot: SnapshotSchema,
});

export const ToolResultRefSchema = z.strictObject({
  callId: id, tool: ToolNameSchema, resultRef: id,
  status: z.enum(['ok', 'error']), snapshot: SnapshotSchema,
});
export type ToolResultRef = z.infer<typeof ToolResultRefSchema>;

export const HarnessStateSchema = z.strictObject({
  schemaVersion: z.literal(1), ownerId: id, caseId: id, runId: id,
  snapshot: SnapshotSchema,
  phase: z.enum(['planning', 'tool', 'awaiting_user', 'finished']),
  status: z.enum(['running', 'waiting_user', 'completed', 'failed', 'cancelled']),
  budget: BudgetSchema,
  pendingUserInput: PendingUserInputSchema.nullable(),
  toolResultRefs: z.array(ToolResultRefSchema).max(100),
  lastError: ErrorCodeSchema.nullable(),
}).superRefine((state, ctx) => {
  const waiting = state.status === 'waiting_user';
  const terminal = ['completed', 'failed', 'cancelled'].includes(state.status);
  if (waiting !== (state.phase === 'awaiting_user') || waiting !== (state.pendingUserInput !== null)) {
    ctx.addIssue({ code: 'custom', message: 'Waiting status requires pending user input and awaiting_user phase' });
  }
  if (terminal !== (state.phase === 'finished')) {
    ctx.addIssue({ code: 'custom', message: 'Terminal status requires finished phase' });
  }
  if (state.pendingUserInput && (
    state.pendingUserInput.snapshot.revision !== state.snapshot.revision ||
    state.pendingUserInput.snapshot.generation !== state.snapshot.generation
  )) ctx.addIssue({ code: 'custom', message: 'Pending user input must refer to the current snapshot' });
});
export type HarnessState = z.infer<typeof HarnessStateSchema>;

export function createInitialHarnessState(scope: TrustedScope, budget: HarnessBudget): HarnessState {
  const parsed = TrustedScopeSchema.parse(scope);
  return HarnessStateSchema.parse({
    schemaVersion: 1, ownerId: parsed.ownerId, caseId: parsed.caseId, runId: parsed.runId,
    snapshot: { revision: parsed.revision, generation: parsed.generation },
    phase: 'planning', status: 'running', budget, pendingUserInput: null,
    toolResultRefs: [], lastError: null,
  });
}

export const AmountSummarySchema = z.union([
  z.strictObject({ status: z.literal('confirmed'), cents: nonnegativeInt }),
  z.strictObject({ status: z.enum(['unknown', 'candidate', 'conflict']), cents: z.null() }),
]);
export const TrustedFactsSnapshotSchema = z.strictObject({
  scope: TrustedScopeSchema, stale: z.boolean(), canCalculate: z.boolean(),
  due: AmountSummarySchema, paid: AmountSummarySchema,
}).superRefine((facts, ctx) => {
  if (facts.canCalculate && (facts.stale || facts.due.status !== 'confirmed' || facts.paid.status !== 'confirmed')) {
    ctx.addIssue({ code: 'custom', message: 'Calculation requires current confirmed due and paid totals' });
  }
});
export type TrustedFactsSnapshot = z.infer<typeof TrustedFactsSnapshotSchema>;

export const UserCalculationRequestSchema = z.strictObject({
  action: z.literal('calculate'), requestId: id, scope: TrustedScopeSchema,
});
export type UserCalculationRequest = z.infer<typeof UserCalculationRequestSchema>;

const inputBase = { callId: id, scope: TrustedScopeSchema };
const writeBase = { ...inputBase, idempotencyKey };
// The server assembles these envelopes after policy authorization. Scope and keys
// are absent from ActionProposalSchema, so a model cannot supply them.
export const ToolCallInputSchema = z.discriminatedUnion('tool', [
  z.strictObject({ ...inputBase, tool: z.literal('read_facts') }),
  z.strictObject({ ...inputBase, tool: z.literal('read_evidence_excerpt'),
    evidenceId: id, blockId: id, maxChars: z.number().int().min(1).max(4000) }),
  z.strictObject({ ...inputBase, tool: z.literal('search_public'),
    query: z.string().trim().min(1).max(500), limit: z.number().int().min(1).max(10) }),
  z.strictObject({ ...inputBase, tool: z.literal('get_job'), jobId: id }),
  z.strictObject({ ...writeBase, tool: z.literal('start_extraction'), evidenceId: id }),
  z.strictObject({ ...writeBase, tool: z.literal('request_calculate'), requestId: id }),
]);
export type ToolCallInput = z.infer<typeof ToolCallInputSchema>;

const outputBase = { callId: id, scope: TrustedScopeSchema, resultRef: id };
const job = z.strictObject({ jobId: id, evidenceId: id,
  status: z.enum(['queued', 'running', 'completed', 'failed']), generation: positiveInt });
const source = z.strictObject({ sourceId: id, title: z.string().min(1).max(300),
  url: z.url().refine(value => value.startsWith('https://'), 'Public sources must use HTTPS'),
  excerpt: z.string().max(2000) });
const ToolSuccessSchema = z.discriminatedUnion('tool', [
  z.strictObject({ ...outputBase, status: z.literal('ok'), tool: z.literal('read_facts'), data: TrustedFactsSnapshotSchema }),
  z.strictObject({ ...outputBase, status: z.literal('ok'), tool: z.literal('read_evidence_excerpt'),
    data: z.strictObject({ evidenceId: id, blockId: id, text: z.string().max(4000), truncated: z.boolean() }) }),
  z.strictObject({ ...outputBase, status: z.literal('ok'), tool: z.literal('search_public'),
    data: z.strictObject({ sources: z.array(source).max(10) }) }),
  z.strictObject({ ...outputBase, status: z.literal('ok'), tool: z.literal('get_job'), data: job }),
  z.strictObject({ ...outputBase, status: z.literal('ok'), tool: z.literal('start_extraction'), data: job }),
  z.strictObject({ ...outputBase, status: z.literal('ok'), tool: z.literal('request_calculate'),
    data: z.strictObject({ receiptId: id, dueCents: nonnegativeInt, paidCents: nonnegativeInt,
      gapCents: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER) }) }),
]);
const ToolErrorSchema = z.strictObject({
  ...outputBase, status: z.literal('error'), tool: ToolNameSchema,
  error: z.strictObject({ code: ErrorCodeSchema, retryable: z.boolean() }),
});
export const ToolResultSchema = z.union([ToolSuccessSchema, ToolErrorSchema]).superRefine((result, ctx) => {
  if (result.status !== 'ok') return;
  if (result.tool === 'read_facts' && Object.entries(result.scope).some(([key, value]) =>
    result.data.scope[key as keyof TrustedScope] !== value)) {
    ctx.addIssue({ code: 'custom', message: 'Fact output must belong to the envelope scope' });
  }
  if ((result.tool === 'get_job' || result.tool === 'start_extraction') && result.data.generation !== result.scope.generation) {
    ctx.addIssue({ code: 'custom', message: 'Job output must belong to the envelope generation' });
  }
  if (result.tool === 'request_calculate' && result.data.gapCents !== result.data.dueCents - result.data.paidCents) {
    ctx.addIssue({ code: 'custom', message: 'Calculation output must preserve exact integer arithmetic' });
  }
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

export type ToolEffect = 'read' | 'reconcile' | 'write';
export const TOOL_POLICIES = {
  read_facts: { effect: 'reconcile', timeoutMs: 10_000, idempotency: 'reconcile-current-snapshot' },
  read_evidence_excerpt: { effect: 'read', timeoutMs: 5_000, idempotency: 'read-only' },
  search_public: { effect: 'read', timeoutMs: 10_000, idempotency: 'read-only' },
  get_job: { effect: 'reconcile', timeoutMs: 10_000, idempotency: 'reconcile-current-snapshot' },
  start_extraction: { effect: 'write', timeoutMs: 15_000, idempotency: 'required' },
  request_calculate: { effect: 'write', timeoutMs: 10_000, idempotency: 'required' },
} as const satisfies Record<ToolName, { effect: ToolEffect; timeoutMs: number; idempotency: string }>;
