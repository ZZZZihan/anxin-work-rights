import { describe, expect, it } from 'vitest';
import { createInitialHarnessState, type ActionProposal, type TrustedScope } from './contracts';
import { authorizeProposal, consumeBudget, HarnessPolicyError, toolResultReference, type PolicyContext } from './policy';

const scope: TrustedScope = { ownerId: 'owner-1', caseId: 'case-1', runId: 'run-1', revision: 3, generation: 2 };
const snapshot = { revision: 3, generation: 2 };
const state = () => createInitialHarnessState(scope, { remainingSteps: 8, remainingToolCalls: 4, deadlineAt: 1000 });
const proposal = (action: 'read_facts' | 'request_calculate' = 'read_facts'): ActionProposal => ({ action, expectedSnapshot: snapshot });
const context = (): PolicyContext => ({
  scope, currentFacts: { scope, stale: false, canCalculate: true,
    due: { status: 'confirmed', cents: 800000 }, paid: { status: 'confirmed', cents: 0 } },
  userRequest: { action: 'calculate', requestId: 'request-1', scope }, allowStartExtraction: false,
  permittedEvidenceIds: ['evidence-1'], permittedJobIds: ['job-1'], now: 10,
});
function rejects(code: string, call: () => unknown) {
  try { call(); } catch (error) {
    expect(error).toBeInstanceOf(HarnessPolicyError);
    expect((error as HarnessPolicyError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe('trusted harness policy', () => {
  it('blocks owner, case and run scope substitution before any action', () => {
    for (const replacement of [{ ownerId: 'other' }, { caseId: 'other' }, { runId: 'other' }]) {
      rejects('forbidden', () => authorizeProposal(proposal(), state(), {
        ...context(), scope: { ...scope, ...replacement },
      }));
    }
    rejects('invalid_input', () => authorizeProposal({ ...proposal(), actor: 'owner-1', verified: true }, state(), context()));
  });

  it('rejects stale model proposals and stale persisted state', () => {
    for (const expectedSnapshot of [{ revision: 2, generation: 2 }, { revision: 3, generation: 1 }]) {
      rejects('stale_snapshot', () => authorizeProposal({ ...proposal(), expectedSnapshot }, state(), context()));
    }
    rejects('stale_snapshot', () => authorizeProposal(proposal(), state(), {
      ...context(), scope: { ...scope, revision: 4 },
    }));
  });

  it('consumes bounded budgets immutably and refuses deadlines, exhaustion and finished runs', () => {
    const before = state();
    const after = consumeBudget(before, { toolCall: true, now: 10 });
    expect(after.budget).toEqual({ remainingSteps: 7, remainingToolCalls: 3, deadlineAt: 1000 });
    expect(before.budget.remainingSteps).toBe(8);
    expect(authorizeProposal(proposal(), before, context()).nextState.budget).toEqual(after.budget);
    for (const budget of [{ remainingSteps: 0 }, { remainingToolCalls: 0 }]) {
      rejects('budget_exhausted', () => authorizeProposal(proposal(), {
        ...state(), budget: { ...state().budget, ...budget },
      }, context()));
    }
    rejects('budget_exhausted', () => authorizeProposal(proposal(), state(), { ...context(), now: 1000 }));
    rejects('invalid_input', () => consumeBudget(state(), { toolCall: false, now: NaN }));
    rejects('conflict', () => consumeBudget({ ...state(), status: 'completed', phase: 'finished' }, { toolCall: false, now: 10 }));
    const control = authorizeProposal({ action: 'ask_user', expectedSnapshot: snapshot,
      reason: 'confirm_amounts', fields: ['paid'] }, {
      ...state(), budget: { ...state().budget, remainingToolCalls: 0 },
    }, context());
    expect(control.effect).toBe('control');
  });

  it('does not infer resource ownership from an evidence or job identifier', () => {
    const excerpt = { action: 'read_evidence_excerpt', expectedSnapshot: snapshot,
      evidenceId: 'evidence-2', blockId: 'block-1', maxChars: 500 };
    rejects('forbidden', () => authorizeProposal(excerpt, state(), context()));
    rejects('forbidden', () => authorizeProposal({ action: 'get_job', expectedSnapshot: snapshot, jobId: 'job-2' }, state(), context()));
    expect(authorizeProposal({ ...excerpt, evidenceId: 'evidence-1' }, state(), context()).effect).toBe('read');
  });

  it('requires explicit extraction policy and deterministic server write keys', () => {
    const extraction = { action: 'start_extraction', expectedSnapshot: snapshot, evidenceId: 'evidence-1' };
    rejects('extraction_disabled', () => authorizeProposal(extraction, state(), context()));
    const trusted = { ...context(), allowStartExtraction: true };
    const first = authorizeProposal(extraction, state(), trusted);
    expect(first.effect).toBe('write');
    expect(first.idempotencyKey).toEqual(authorizeProposal(extraction, state(), trusted).idempotencyKey);
    expect(first.idempotencyKey).not.toBe(authorizeProposal(proposal('request_calculate'), state(), trusted).idempotencyKey);
  });

  it('requires a current explicit user calculation request and current server facts', () => {
    rejects('user_input_required', () => authorizeProposal(proposal('request_calculate'), state(), { ...context(), userRequest: null }));
    const current = context();
    for (const replacement of [{ caseId: 'another-case' }, { ownerId: 'another-owner' }, { runId: 'another-run' }]) {
      rejects('forbidden', () => authorizeProposal(proposal('request_calculate'), state(), {
        ...current, userRequest: { ...current.userRequest!, scope: { ...scope, ...replacement } },
      }));
      rejects('forbidden', () => authorizeProposal(proposal('request_calculate'), state(), {
        ...current, currentFacts: { ...current.currentFacts!, scope: { ...scope, ...replacement } },
      }));
    }
    rejects('stale_snapshot', () => authorizeProposal(proposal('request_calculate'), state(), {
      ...current, userRequest: { ...current.userRequest!, scope: { ...scope, revision: 2 } },
    }));
    rejects('stale_snapshot', () => authorizeProposal(proposal('request_calculate'), state(), {
      ...current, currentFacts: { ...current.currentFacts!, scope: { ...scope, generation: 1 } },
    }));
  });

  it('refuses unknown/conflicting amounts even when passed a forged canCalculate flag', () => {
    const current = context();
    for (const status of ['unknown', 'candidate', 'conflict'] as const) {
      rejects('calculation_not_ready', () => authorizeProposal(proposal('request_calculate'), state(), {
        ...current, currentFacts: { ...current.currentFacts!, canCalculate: true, paid: { status, cents: null } },
      }));
    }
    rejects('calculation_not_ready', () => authorizeProposal(proposal('request_calculate'), state(), {
      ...current, currentFacts: { ...current.currentFacts!, stale: true },
    }));
    rejects('calculation_not_ready', () => authorizeProposal(proposal('request_calculate'), state(), {
      ...current, currentFacts: { ...current.currentFacts!, canCalculate: false },
    }));
    expect(authorizeProposal(proposal('request_calculate'), state(), current).effect).toBe('write');
  });

  it('persists only a bounded result reference and rejects cross-case output', () => {
    const result = { tool: 'read_evidence_excerpt', callId: 'call-1', resultRef: 'result-1',
      scope, status: 'ok', data: { evidenceId: 'evidence-1', blockId: 'block-1', text: 'private source content', truncated: false } };
    const call = { tool: 'read_evidence_excerpt' as const, callId: 'call-1', scope,
      evidenceId: 'evidence-1', blockId: 'block-1', maxChars: 500 };
    const ref = toolResultReference(result, call);
    expect(ref).toEqual({ callId: 'call-1', tool: 'read_evidence_excerpt', resultRef: 'result-1', status: 'ok', snapshot });
    expect(JSON.stringify(ref)).not.toContain('private source content');
    rejects('forbidden', () => toolResultReference({ ...result, scope: { ...scope, caseId: 'other' } }, call));
    rejects('stale_snapshot', () => toolResultReference({ ...result, scope: { ...scope, revision: 2 } }, call));
    rejects('invalid_input', () => toolResultReference({ ...result, secret: 'token' }, call));
    rejects('conflict', () => toolResultReference({ ...result, callId: 'old-call' }, call));
    rejects('conflict', () => toolResultReference({ ...result, data: { ...result.data, evidenceId: 'other' } }, call));
    rejects('conflict', () => toolResultReference({ ...result, data: { ...result.data, blockId: 'other' } }, call));
    rejects('conflict', () => toolResultReference(result, { ...call, maxChars: 1 }));
    rejects('conflict', () => toolResultReference(result, { callId: 'call-1', scope, tool: 'read_facts' }));
    const advanced = { ...scope, revision: 4 };
    expect(toolResultReference({ ...result, scope: advanced }, call, advanced).snapshot.revision).toBe(4);
    rejects('stale_snapshot', () => toolResultReference({ ...result, scope: { ...scope, generation: 3 } },
      call, { ...scope, generation: 3 }));
  });

  it('binds job outputs to the authorized job or extraction evidence', () => {
    const result = { tool: 'get_job', callId: 'call-1', resultRef: 'result-1', scope, status: 'ok',
      data: { jobId: 'job-2', evidenceId: 'evidence-1', status: 'running', generation: 2 } };
    rejects('conflict', () => toolResultReference(result, { tool: 'get_job', callId: 'call-1', scope, jobId: 'job-1' }));
    rejects('conflict', () => toolResultReference({ ...result, tool: 'start_extraction' }, {
      tool: 'start_extraction', callId: 'call-1', scope, evidenceId: 'evidence-2', idempotencyKey: 'key-1',
    }));
  });
});
