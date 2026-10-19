import { describe, expect, it } from 'vitest';
import {
  ActionProposalSchema, AmountSummarySchema, HarnessStateSchema, TOOL_POLICIES,
  ToolCallInputSchema, ToolResultSchema, TrustedFactsSnapshotSchema,
  createInitialHarnessState, type TrustedScope,
} from './contracts';

const scope: TrustedScope = { ownerId: 'owner-1', caseId: 'case-1', runId: 'run-1', revision: 3, generation: 2 };
const snapshot = { revision: 3, generation: 2 };
const initial = () => createInitialHarnessState(scope, { remainingSteps: 8, remainingToolCalls: 4, deadlineAt: 1000 });

describe('harness runtime contracts', () => {
  it('accepts only bounded action proposals without model authority fields', () => {
    const action = { action: 'read_facts', expectedSnapshot: snapshot };
    expect(ActionProposalSchema.parse(action)).toEqual(action);
    for (const injected of [
      { actor: 'owner-1' }, { verified: true }, { confirmed: true }, { caseId: 'case-2' },
      { scope }, { canCalculate: true }, { idempotencyKey: 'model-supplied-key' },
    ]) expect(ActionProposalSchema.safeParse({ ...action, ...injected }).success).toBe(false);
    for (const forbidden of ['confirm_scope', 'confirm_amount', 'revoke', 'exclude_source', 'calculate']) {
      expect(ActionProposalSchema.safeParse({ action: forbidden, expectedSnapshot: snapshot }).success).toBe(false);
    }
    expect(ActionProposalSchema.safeParse({ action: 'search_public', expectedSnapshot: snapshot,
      query: 'x'.repeat(501), limit: 1 }).success).toBe(false);
    expect(ActionProposalSchema.safeParse({ action: 'ask_user', expectedSnapshot: snapshot,
      reason: 'confirm_amounts', fields: ['due', 'due'] }).success).toBe(false);
  });

  it('keeps unknown amounts distinct from explicitly confirmed zero', () => {
    expect(AmountSummarySchema.parse({ status: 'unknown', cents: null })).toEqual({ status: 'unknown', cents: null });
    expect(AmountSummarySchema.parse({ status: 'confirmed', cents: 0 })).toEqual({ status: 'confirmed', cents: 0 });
    for (const status of ['unknown', 'candidate', 'conflict']) {
      expect(AmountSummarySchema.safeParse({ status, cents: 0 }).success).toBe(false);
    }
    expect(AmountSummarySchema.safeParse({ status: 'confirmed', cents: null }).success).toBe(false);
    expect(TrustedFactsSnapshotSchema.safeParse({ scope, stale: false, canCalculate: true,
      due: { status: 'confirmed', cents: 800000 }, paid: { status: 'unknown', cents: null } }).success).toBe(false);
  });

  it('requires consistent waiting/terminal states and bounded finite budgets', () => {
    const state = initial();
    expect(HarnessStateSchema.parse(state)).toEqual(state);
    for (const budget of [
      { remainingSteps: Infinity }, { remainingSteps: -1 }, { remainingSteps: 101 },
      { remainingToolCalls: 1.1 }, { deadlineAt: NaN },
    ]) expect(HarnessStateSchema.safeParse({ ...state, budget: { ...state.budget, ...budget } }).success).toBe(false);
    expect(HarnessStateSchema.safeParse({ ...state, status: 'waiting_user' }).success).toBe(false);
    expect(HarnessStateSchema.safeParse({ ...state, status: 'completed' }).success).toBe(false);
    const waiting = { ...state, phase: 'awaiting_user', status: 'waiting_user', pendingUserInput: {
      requestId: 'request-1', reason: 'confirm_amounts', fields: ['due', 'paid'], snapshot,
    } };
    expect(HarnessStateSchema.safeParse(waiting).success).toBe(true);
    expect(HarnessStateSchema.safeParse({ ...waiting, pendingUserInput: {
      ...waiting.pendingUserInput, snapshot: { revision: 2, generation: 2 },
    } }).success).toBe(false);
    expect(HarnessStateSchema.safeParse({ ...state, trace: [{ raw: 'private evidence' }] }).success).toBe(false);
  });

  it('separates server input envelopes from model proposals and requires write keys', () => {
    const call = { tool: 'request_calculate', scope, callId: 'call-1', requestId: 'request-1' };
    expect(ToolCallInputSchema.safeParse(call).success).toBe(false);
    expect(ToolCallInputSchema.safeParse({ ...call, idempotencyKey: 'server-generated' }).success).toBe(true);
    expect(TOOL_POLICIES.read_facts.effect).toBe('reconcile');
    expect(TOOL_POLICIES.get_job.effect).toBe('reconcile');
    expect(TOOL_POLICIES.read_evidence_excerpt.effect).toBe('read');
    expect(TOOL_POLICIES.request_calculate.idempotency).toBe('required');
    for (const policy of Object.values(TOOL_POLICIES)) expect(policy.timeoutMs).toBeGreaterThan(0);
  });

  it('validates concrete output shapes, generations and exact calculation arithmetic', () => {
    const base = { callId: 'call-1', scope, resultRef: 'result-1', status: 'ok' };
    const calculation = { ...base, tool: 'request_calculate', data: {
      receiptId: 'receipt-1', dueCents: 800000, paidCents: 0, gapCents: 800000,
    } };
    expect(ToolResultSchema.safeParse(calculation).success).toBe(true);
    expect(ToolResultSchema.safeParse({ ...calculation, data: { ...calculation.data, gapCents: 0 } }).success).toBe(false);
    expect(ToolResultSchema.safeParse({ ...base, tool: 'get_job', data: {
      jobId: 'job-1', evidenceId: 'evidence-1', status: 'running', generation: 1,
    } }).success).toBe(false);
    expect(ToolResultSchema.safeParse({ ...base, tool: 'read_facts', data: {
      scope: { ...scope, caseId: 'another-case' }, stale: false, canCalculate: false,
      due: { status: 'unknown', cents: null }, paid: { status: 'unknown', cents: null },
    } }).success).toBe(false);
    expect(ToolResultSchema.safeParse({ ...base, tool: 'read_evidence_excerpt', data: {} }).success).toBe(false);
    expect(ToolResultSchema.safeParse({ ...base, status: 'error', tool: 'read_facts', error: {
      code: 'timeout', retryable: true, raw: 'secret backend response',
    } }).success).toBe(false);
  });
});
