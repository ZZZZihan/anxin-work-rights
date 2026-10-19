// Isolated validation entrypoint only. Never imported by the application router.
// Identity and facts here are synthetic fixtures, not a production auth gateway.
import { Annotation, Command, END, START, StateGraph, interrupt } from '@langchain/langgraph';
import { z } from 'zod';
import { D1CheckpointSaver } from '../lib/agent-harness/d1-checkpointer';
import { createInitialHarnessState, HarnessStateSchema, type HarnessState, type TrustedScope } from '../lib/agent-harness/contracts';
import { authorizeProposal, HarnessPolicyError } from '../lib/agent-harness/policy';
import { initializeHarnessRuntime } from '../lib/agent-harness/runtime';

type Env = { DB: D1Database; PROBE_TOKEN: string };
type Fixture = { ownerId: string; caseId: string };
type Run = { revision: number; generation: number; scenario: 'interrupt' | 'parallel'; prepared: number; successful: number; finished: number; released: number };
let bootId: string | undefined;
const fixtures: Record<string, Fixture> = {
  alice: { ownerId: 'synthetic-alice', caseId: 'synthetic-case-a' },
  bob: { ownerId: 'synthetic-bob', caseId: 'synthetic-case-a' },
  otherCase: { ownerId: 'synthetic-alice', caseId: 'synthetic-case-b' },
};
const input = z.strictObject({
  runId: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/),
  operation: z.enum(['start', 'resume', 'state', 'history', 'bump', 'release', 'delete']),
  scenario: z.enum(['interrupt', 'parallel']).optional(),
  decision: z.unknown().optional(),
});
const resumeInput = z.strictObject({ decision: z.literal('continue') });
const HarnessGraphState = Annotation.Root({ harness: Annotation<HarnessState>() });
const ParallelState = Annotation.Root({
  results: Annotation<string[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
});

function config(runId: string) {
  return { configurable: { thread_id: runId }, durability: 'sync' as const, recursionLimit: 12 };
}
async function load(db: D1Database, scope: Fixture, runId: string) {
  return db.prepare('SELECT * FROM harness_probe_runs WHERE owner_id=? AND case_id=? AND run_id=?')
    .bind(scope.ownerId, scope.caseId, runId).first<Run>();
}
async function count(db: D1Database, scope: Fixture, runId: string, field: 'prepared' | 'successful' | 'finished') {
  // Deliberately non-idempotent diagnostic counter: repeated execution must be
  // observable. This is not a production tool-call ledger or exactly-once claim.
  await db.prepare(`UPDATE harness_probe_runs SET ${field}=${field}+1 WHERE owner_id=? AND case_id=? AND run_id=?`)
    .bind(scope.ownerId, scope.caseId, runId).run();
}
function makeInterruptGraph(db: D1Database, scope: Fixture, runId: string, saver: D1CheckpointSaver) {
  return new StateGraph(HarnessGraphState)
    .addNode('prepare', async state => {
      const saved = HarnessStateSchema.parse(state.harness);
      const current = await load(db, scope, runId);
      if (!current) throw new HarnessPolicyError('not_found');
      const trusted: TrustedScope = { ...scope, runId, revision: current.revision, generation: current.generation };
      const authorized = authorizeProposal({ action: 'read_evidence_excerpt', evidenceId: 'synthetic-evidence', blockId: 'block-1', maxChars: 100,
        expectedSnapshot: saved.snapshot }, saved, {
        scope: trusted, currentFacts: null, userRequest: null, allowStartExtraction: false,
        permittedEvidenceIds: ['synthetic-evidence'], now: Date.now(),
      });
      const next = authorized.nextState;
      await count(db, scope, runId, 'prepared');
      return { harness: HarnessStateSchema.parse({ ...next, phase: 'awaiting_user', status: 'waiting_user',
        pendingUserInput: { requestId: 'synthetic-request', reason: 'clarify_request', fields: ['request'], snapshot: next.snapshot },
        toolResultRefs: [{ callId: 'synthetic-call', tool: 'read_evidence_excerpt', resultRef: 'synthetic-result', status: 'ok', snapshot: next.snapshot }],
      }) };
    })
    .addNode('wait_for_user', async state => {
      const saved = HarnessStateSchema.parse(state.harness);
      // The payload is a question, never authorization to confirm material facts.
      resumeInput.parse(interrupt(saved.pendingUserInput));
      const current = await load(db, scope, runId);
      if (!current) throw new HarnessPolicyError('not_found');
      const running = HarnessStateSchema.parse({ ...saved, phase: 'planning', status: 'running', pendingUserInput: null });
      const authorized = authorizeProposal({ action: 'finish', reason: 'answered', expectedSnapshot: saved.snapshot }, running, {
        scope: { ...scope, runId, revision: current.revision, generation: current.generation },
        currentFacts: null, userRequest: null, allowStartExtraction: false, now: Date.now(),
      });
      const next = authorized.nextState;
      await count(db, scope, runId, 'finished');
      return { harness: HarnessStateSchema.parse({ ...next, phase: 'finished', status: 'completed' }) };
    })
    .addEdge(START, 'prepare').addEdge('prepare', 'wait_for_user').addEdge('wait_for_user', END)
    .compile({ checkpointer: saver });
}
function makeParallelGraph(db: D1Database, scope: Fixture, runId: string, saver: D1CheckpointSaver) {
  return new StateGraph(ParallelState)
    .addNode('successful_tool', async () => {
      await count(db, scope, runId, 'successful');
      return { results: ['completed-once'] };
    })
    .addNode('recoverable_tool', async () => {
      if (!(await load(db, scope, runId))?.released) {
        // Do not race the sibling's completion: an early error can cancel it
        // after its diagnostic side effect but before LangGraph saves output.
        // This fixture tests recovery of a durably completed sibling, not the
        // separate crash-between-effect-and-receipt problem for tool adapters.
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const checkpoint = await saver.getTuple(config(runId));
          if (checkpoint?.pendingWrites?.some(([, channel, value]) =>
            channel === 'results' && Array.isArray(value) && value.includes('completed-once'))) {
            throw new Error('synthetic_retryable_failure');
          }
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        throw new Error('synthetic_completion_barrier_timeout');
      }
      return { results: ['recovered'] };
    })
    .addNode('joined', async () => { await count(db, scope, runId, 'finished'); return {}; })
    .addEdge(START, 'successful_tool').addEdge(START, 'recoverable_tool')
    .addEdge(['successful_tool', 'recoverable_tool'], 'joined').addEdge('joined', END)
    .compile({ checkpointer: saver });
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    initializeHarnessRuntime();
    bootId ??= crypto.randomUUID();
    if (new URL(request.url).pathname === '/health') return Response.json({ fixture: true, bootId });
    if (!env.PROBE_TOKEN || request.headers.get('authorization') !== `Bearer ${env.PROBE_TOKEN}`) return new Response(null, { status: 401 });
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/probe') return new Response(null, { status: 404 });
    const fixtureId = request.headers.get('x-probe-fixture') ?? '';
    const scope = Object.hasOwn(fixtures, fixtureId) ? fixtures[fixtureId] : undefined;
    if (!scope) return new Response(null, { status: 403 });
    try {
      const body = input.parse(await request.json());
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS harness_probe_runs (
        owner_id TEXT NOT NULL, case_id TEXT NOT NULL, run_id TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1, generation INTEGER NOT NULL DEFAULT 1,
        scenario TEXT NOT NULL, prepared INTEGER NOT NULL DEFAULT 0,
        successful INTEGER NOT NULL DEFAULT 0, finished INTEGER NOT NULL DEFAULT 0,
        released INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(owner_id,case_id,run_id))`).run();
      const run = await load(env.DB, scope, body.runId);
      if (body.operation === 'start') {
        if (run) return Response.json({ error: 'already_started' }, { status: 409 });
        await env.DB.prepare('INSERT INTO harness_probe_runs(owner_id,case_id,run_id,scenario) VALUES(?,?,?,?)')
          .bind(scope.ownerId, scope.caseId, body.runId, body.scenario ?? 'interrupt').run();
      } else if (!run) return Response.json({ error: 'not_found' }, { status: 404 });
      const saver = new D1CheckpointSaver(env.DB, { ...scope, runId: body.runId });
      if (body.operation === 'bump' || body.operation === 'release') {
        const update = body.operation === 'bump' ? 'revision=revision+1,generation=generation+1' : 'released=1';
        await env.DB.prepare(`UPDATE harness_probe_runs SET ${update} WHERE owner_id=? AND case_id=? AND run_id=?`)
          .bind(scope.ownerId, scope.caseId, body.runId).run();
      } else if (body.operation === 'delete') {
        await saver.deleteThread(body.runId);
      }
      const scenario = run?.scenario ?? body.scenario ?? 'interrupt';
      const cfg = config(body.runId);
      if (body.operation === 'history') {
        const history = [];
        for await (const tuple of saver.list(cfg)) history.push({ id: tuple.checkpoint.id,
          parentId: tuple.parentConfig?.configurable?.checkpoint_id ?? null,
          // These values are synthetic fixture results, never case materials.
          pendingWrites: tuple.pendingWrites ?? [] });
        return Response.json({ history });
      }
      if (scenario === 'parallel') {
        const graph = makeParallelGraph(env.DB, scope, body.runId, saver);
        if (body.operation === 'start') await graph.invoke({ results: [] }, cfg);
        if (body.operation === 'resume') {
          const current = await graph.getState(cfg);
          if (!current.next.length) return Response.json({ error: 'already_finished' }, { status: 409 });
          await graph.invoke(null, cfg);
        }
        const state = await graph.getState(cfg);
        return Response.json({ bootId, results: state.values.results ?? [], next: state.next, run: await load(env.DB, scope, body.runId) });
      }
      const graph = makeInterruptGraph(env.DB, scope, body.runId, saver);
      if (body.operation === 'start') await graph.invoke({ harness: createInitialHarnessState({ ...scope, runId: body.runId, revision: 1, generation: 1 },
        { remainingSteps: 8, remainingToolCalls: 4, deadlineAt: Date.now() + 300_000 }) }, cfg);
      if (body.operation === 'resume') {
        const current = await graph.getState(cfg);
        if (!current.next.length) return Response.json({ error: 'already_finished' }, { status: 409 });
        await graph.invoke(new Command({ resume: resumeInput.parse(body.decision) }), cfg);
      }
      const state = await graph.getState(cfg);
      return Response.json({ bootId, harness: state.values.harness ?? null, next: state.next,
        interrupts: state.tasks.flatMap(task => task.interrupts ?? []), run: await load(env.DB, scope, body.runId) });
    } catch (error) {
      if (error instanceof z.ZodError) return Response.json({ error: 'invalid_input' }, { status: 400 });
      if (error instanceof HarnessPolicyError) return Response.json({ error: error.code }, { status: 409 });
      if (error instanceof Error && error.message === 'synthetic_retryable_failure') return Response.json({ error: error.message }, { status: 503 });
      console.error(error); // Only this isolated synthetic Worker, never real materials.
      return Response.json({ error: 'probe_failed', diagnostic: error instanceof Error ? error.stack : String(error) }, { status: 500 });
    }
  },
};

export default worker;
