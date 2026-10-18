// Real route handlers + disposable D1. The material service is a controlled
// boundary; these regressions do not exercise a live service or model quality.
import { readFileSync, readdirSync } from 'node:fs';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FactState, MaterialFactsResponse } from './material-fact-types';

const bindings = vi.hoisted(() => ({ DB: undefined as unknown as D1Database, service: vi.fn() }));
vi.mock('cloudflare:workers', () => ({ env: bindings }));
vi.mock('./material-service-client', () => ({ materialServiceConfigured: () => true, callMaterialService: bindings.service }));
import { GET, POST } from '../app/api/cases/[id]/facts/route';

let mf: Miniflare;
const context = { params: Promise.resolve({ id: 'recovery-case' }) };
const headers = { 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'owner@synthetic.test' };
const request = (body?: unknown) => new Request('http://127.0.0.1/api/cases/recovery-case/facts', {
  method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}),
});
const ready = { status: 'ready', result: { raw: JSON.stringify({ schemaVersion: 3, candidates: [] }), backend: 'controlled-test-fixture', model: null, finish_reason: 'stop' } };
let reply: unknown;
type JobMetadata = { startedAt?: string; pollFailureSince?: string; submissionPending?: boolean };
async function stored() {
  const row = await bindings.DB.prepare("SELECT revision,state_json FROM case_material_facts WHERE case_id='recovery-case'")
    .first<{ revision: number; state_json: string }>();
  return { revision: row!.revision, state: JSON.parse(row!.state_json) as FactState };
}
async function read() {
  const response = await GET(request(), context);
  expect(response.status).toBe(200);
  return await response.json() as MaterialFactsResponse;
}
async function act(current: MaterialFactsResponse, action: Record<string, unknown>) {
  return POST(request({ revision: current.revision, generation: current.generation, ...action }), context);
}
async function start() {
  const initial = await read();
  const response = await act(initial, { action: 'extract', evidenceId: 'source-1' });
  expect(response.status).toBe(202);
  return await response.json() as MaterialFactsResponse;
}
function deletes() { return bindings.service.mock.calls.filter(([, init]) => init?.method === 'DELETE'); }
function polls() { return bindings.service.mock.calls.filter(([path, init]) => path.startsWith('/fact-jobs/') && init?.method !== 'DELETE'); }
const ago = (milliseconds: number) => new Date(Date.now() - milliseconds).toISOString();
async function seedJob(patch: Record<string, unknown>, remove: string[] = []) {
  const row = await stored();
  const job = { ...row.state.job, ...patch } as NonNullable<FactState['job']> & Record<string, unknown>;
  for (const key of remove) delete job[key];
  await bindings.DB.prepare("UPDATE case_material_facts SET state_json=? WHERE case_id='recovery-case'")
    .bind(JSON.stringify({ ...row.state, job })).run();
}
async function addSource(id = 'source-1', readySource = true) {
  await bindings.DB.prepare(`INSERT INTO evidence_files (id,user_id,case_id,name,category,size,mime_type,status,note,object_key,content_hash,uploaded_at)
    VALUES (?,'owner','recovery-case','synthetic.txt','工资支付',100,'text/plain',?,'','synthetic-object',?,'2026-10-18')`)
    .bind(id, readySource ? 'uploaded' : 'uploading', 'a'.repeat(64)).run();
  if (!readySource) return;
  const result = { engine: { ocr: 'controlled-test-fixture', structuring: 'ocr_rules', model: null }, pageCount: 1,
    blocks: [{ id: 'b1', page: 1, text: '合成测试单位的张三2026年1月完整应付工资1000元。', bbox: null, confidence: null }], fields: [], warnings: [],
    source: { evidenceId: id, name: 'synthetic.txt', sha256: 'a'.repeat(64), mimeType: 'text/plain' } };
  await bindings.DB.prepare(`INSERT INTO evidence_analyses (evidence_id,user_id,content_hash,document_kind,status,revision,run_id,result_json,started_at,updated_at)
    VALUES (?,'owner',?,'other','ready',1,'synthetic-run',?,'2026-10-18','2026-10-18')`).bind(id, 'a'.repeat(64), JSON.stringify(result)).run();
}
async function serviceReply(path: string, init?: RequestInit): Promise<unknown> {
  if (path === '/health') return { capabilities: { factBackend: 'controlled-test-fixture', factConfigured: true } };
  if (init?.method === 'DELETE') return { ok: true };
  if (path === '/fact-jobs') {
    const payload = JSON.parse(String(init?.body)) as { jobId?: string };
    return { jobId: payload.jobId ?? 'legacy-fixture-job' };
  }
  if (reply instanceof Error) throw reply;
  return reply;
}
function holdOnePoll() {
  let entered!: () => void;
  let resolve!: (value: unknown) => void;
  let reject!: (failure: Error) => void;
  const waiting = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
  const observed = new Promise<void>(yes => { entered = yes; });
  let held = false;
  bindings.service.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.startsWith('/fact-jobs/') && init?.method !== 'DELETE' && !held) {
      held = true; entered(); return waiting;
    }
    return serviceReply(path, init);
  });
  return { entered: observed, resolve, reject };
}

describe('material fact transient transport recovery and bounded ownership', () => {
  beforeEach(async () => {
    vi.stubEnv('NODE_ENV', 'production');
    reply = { status: 'running' };
    bindings.service.mockReset().mockImplementation(serviceReply);
    mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("disposable recovery test"); } };', compatibilityDate: '2026-09-11', d1Databases: ['DB'] }));
    bindings.DB = await mf.getD1Database('DB') as unknown as D1Database;
    for (const name of readdirSync(new URL('../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
      const sql = readFileSync(new URL(`../drizzle/${name}`, import.meta.url), 'utf8').split('--> statement-breakpoint');
      await bindings.DB.batch(sql.filter(statement => statement.trim()).map(statement => bindings.DB.prepare(statement)));
    }
    await bindings.DB.prepare(`INSERT INTO cases (id,user_id,type,company,status,next_action,created_at,updated_at)
      VALUES ('recovery-case','owner','欠薪','合成测试单位','collecting','整理材料','2026-10-18','2026-10-18')`).run();
    await addSource();
  }, 30_000);
  afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await mf?.dispose(); }, 20_000);

  for (const [label, failure] of [
    ['timeout', new DOMException('Synthetic timeout', 'TimeoutError')],
    ['503', Object.assign(new Error('Synthetic service unavailable'), { status: 503 })],
    ['invalid JSON', new SyntaxError('Synthetic malformed service JSON')],
  ] as const) it(`retains a running job after transient ${label} and consumes its later success`, async () => {
    const started = await start();
    bindings.service.mockClear();
    reply = failure;
    const interrupted = await read();
    expect.soft(interrupted.state.job).toMatchObject({ id: started.state.job!.id, status: 'running' });
    expect(interrupted.state.materials).toEqual([]);
    expect(interrupted.canCalculate).toBe(false);
    expect.soft(deletes()).toEqual([]);
    expect.soft((await stored()).state.job?.status).toBe('running');
    reply = ready;
    const recovered = await read();
    expect(recovered.state.job).toBeNull();
    expect(recovered.state.materials).toHaveLength(1);
    expect(recovered.state.materials[0].raw).toBe(ready.result.raw);
    expect(recovered.state.history.filter(item => item.type === 'candidates_extracted')).toHaveLength(1);
    expect(deletes()).toHaveLength(1);
  });

  for (const [label, malformed] of [
    ['missing body', undefined], ['null body', null], ['unknown state', { status: 'unrecognized' }],
    ['array running state', { status: ['running'] }], ['array ready state', { status: ['ready'], result: ready.result }],
    ['incomplete ready envelope', { status: 'ready', result: { backend: 'controlled-test-fixture', model: null } }],
  ] as const) it(`keeps ${label} recoverable without cancelling a possibly healthy task`, async () => {
    const started = await start(); bindings.service.mockClear(); reply = malformed;
    const interrupted = await read();
    expect(interrupted.state.job).toMatchObject({ id: started.state.job!.id, status: 'running' });
    expect(deletes()).toEqual([]);
    reply = ready;
    expect((await read()).state.job).toBeNull();
    expect((await stored()).state.materials).toHaveLength(1);
  });

  it('preserves readable raw output from an incomplete envelope without making it a material or total', async () => {
    await start(); bindings.service.mockClear();
    const raw = '{"candidates":[],"synthetic":"untrusted original response"}';
    reply = { status: 'ready', result: { raw, backend: 'controlled-test-fixture', model: 17 } };
    const interrupted = await read();
    expect(interrupted.state.job).toMatchObject({ status: 'running', raw, backend: 'controlled-test-fixture' });
    expect(interrupted.state.materials).toEqual([]);
    expect(interrupted.canCalculate).toBe(false);
    expect((await stored()).state.job?.raw).toBe(raw);
    expect(deletes()).toEqual([]);
    reply = ready;
    expect((await read()).state.materials[0].raw).toBe(ready.result.raw);
  });

  it('preserves an explicit terminal service failure and cleans up immediately', async () => {
    const started = await start(); bindings.service.mockClear();
    reply = { status: 'failed', error: { message: 'Synthetic terminal inference failure' } };
    const failed = await read();
    expect(failed.state.job).toMatchObject({ id: started.state.job!.id, status: 'failed', error: 'Synthetic terminal inference failure' });
    expect(failed.state.materials).toEqual([]);
    expect(deletes()).toHaveLength(1);
    expect((await stored()).state.job?.status).toBe('failed');
  });

  for (const [label, result] of [
    ['invalid candidate protocol', { ...ready.result, raw: '{"unexpected":true}' }],
    ['truncated model output', { ...ready.result, finish_reason: 'length' }],
  ] as const) it(`keeps ${label} terminal and preserves raw output rather than authorizing it`, async () => {
    await start(); bindings.service.mockClear(); reply = { status: 'ready', result };
    const failed = await read();
    expect(failed.state.job).toMatchObject({ status: 'failed', raw: result.raw });
    expect(failed.state.materials).toEqual([]);
    expect(failed.canCalculate).toBe(false);
    expect(deletes()).toHaveLength(1);
  });

  it('uses elapsed time rather than a small retry count for repeated transport errors', async () => {
    await start(); bindings.service.mockClear(); reply = new Error('Synthetic transient outage');
    for (let index = 0; index < 5; index++) expect((await read()).state.job?.status).toBe('running');
    const current = await stored();
    const metadata = current.state.job as NonNullable<FactState['job']> & JobMetadata;
    expect(Number.isFinite(Date.parse(metadata.pollFailureSince ?? ''))).toBe(true);
    expect(deletes()).toEqual([]);
    await seedJob({ pollFailureSince: ago(61_000) });
    const expired = await read();
    expect(expired.state.job?.status).toBe('failed');
    expect(deletes()).toHaveLength(1);
  });

  it('a normal running reply clears the consecutive-error window before a later interruption', async () => {
    await start();
    await seedJob({ pollFailureSince: ago(59_000), error: 'Synthetic old timeout' });
    reply = { status: 'running' };
    const healthy = await read();
    expect(healthy.state.job?.status).toBe('running');
    expect(healthy.state.job?.error).toBeNull();
    expect((healthy.state.job as JobMetadata).pollFailureSince).toBeUndefined();
    bindings.service.mockClear(); reply = new Error('Synthetic new interruption');
    const interrupted = await read();
    expect(interrupted.state.job?.status).toBe('running');
    const since = Date.parse((interrupted.state.job as JobMetadata).pollFailureSince ?? '');
    expect(since).toBeGreaterThan(Date.now() - 5_000);
    expect(deletes()).toEqual([]);
  });

  it('permits the queue plus runtime budget, then terminates a job past the 31-minute total bound', async () => {
    await start();
    await seedJob({ startedAt: ago(30 * 60_000) });
    bindings.service.mockClear(); reply = { status: 'running' };
    expect((await read()).state.job?.status).toBe('running');
    expect(deletes()).toEqual([]);
    await seedJob({ startedAt: ago(31 * 60_000 + 1_000) });
    expect((await read()).state.job?.status).toBe('failed');
    expect(deletes()).toHaveLength(1);
  });

  it('records the first legacy transport failure and bounds it without inventing a start date', async () => {
    await start();
    await seedJob({}, ['startedAt', 'pollFailureSince', 'submissionPending']);
    bindings.service.mockClear(); reply = new Error('Synthetic legacy transport outage');
    const interrupted = await read();
    expect(interrupted.state.job?.status).toBe('running');
    const job = interrupted.state.job as NonNullable<FactState['job']> & JobMetadata;
    expect(job.startedAt).toBeUndefined();
    expect(Number.isFinite(Date.parse(job.pollFailureSince ?? ''))).toBe(true);
    expect(deletes()).toEqual([]);
    await seedJob({ pollFailureSince: ago(61_000) });
    expect((await read()).state.job?.status).toBe('failed');
    expect(deletes()).toHaveLength(1);
  });

  it('retains compatibility for an old starting claim and expires it without polling a fabricated job', async () => {
    await start();
    await seedJob({ id: `starting_${Date.now()}_legacy`, status: 'running' }, ['startedAt', 'submissionPending']);
    bindings.service.mockClear();
    expect((await read()).state.job?.status).toBe('running');
    expect(polls()).toEqual([]);
    await seedJob({ id: `starting_${Date.now() - 61_000}_legacy` });
    expect((await read()).state.job?.status).toBe('failed');
    expect(polls()).toEqual([]);
  });

  it('persists the caller UUID before POST and does not poll while submission is pending', async () => {
    const initial = await read();
    let entered!: () => void;
    let release!: () => void;
    const observed = new Promise<void>(yes => { entered = yes; });
    const held = new Promise<void>(yes => { release = yes; });
    let payload: { source?: unknown; jobId?: string } = {};
    let claimed: Awaited<ReturnType<typeof stored>> | undefined;
    bindings.service.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path !== '/fact-jobs') return serviceReply(path, init);
      payload = JSON.parse(String(init?.body)); claimed = await stored(); entered();
      await held;
      return { jobId: payload.jobId ?? 'legacy-fixture-job' };
    });
    const pending = act(initial, { action: 'extract', evidenceId: 'source-1' });
    await observed;
    const interim = await read();
    const pollCalls = polls();
    release();
    const response = await pending;
    const accepted = await response.json() as MaterialFactsResponse;
    expect(payload.jobId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(Object.keys(payload).sort()).toEqual(['jobId', 'source']);
    expect(claimed!.state.job).toMatchObject({ id: payload.jobId, status: 'running', submissionPending: true });
    expect(Number.isFinite(Date.parse((claimed!.state.job as JobMetadata).startedAt ?? ''))).toBe(true);
    expect(interim.state.job?.id).toBe(payload.jobId);
    expect(pollCalls).toEqual([]);
    expect(response.status).toBe(202);
    expect(accepted.state.job).toMatchObject({ id: payload.jobId, status: 'running' });
    expect((accepted.state.job as JobMetadata).submissionPending).not.toBe(true);
  });

  it('recovers a POST whose service accepted the known UUID but whose response was lost', async () => {
    const initial = await read();
    let submitted: string | undefined;
    bindings.service.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/fact-jobs') {
        submitted = (JSON.parse(String(init?.body)) as { jobId?: string }).jobId;
        throw new DOMException('Synthetic accepted POST response lost', 'TimeoutError');
      }
      return serviceReply(path, init);
    });
    const response = await act(initial, { action: 'extract', evidenceId: 'source-1' });
    expect(response.status).toBe(202);
    const interrupted = await response.json() as MaterialFactsResponse;
    expect(submitted).toBeTruthy();
    expect(interrupted.state.job).toMatchObject({ id: submitted, status: 'running' });
    expect((interrupted.state.job as JobMetadata).submissionPending).not.toBe(true);
    expect(deletes()).toEqual([]);
    bindings.service.mockImplementation(serviceReply); reply = ready;
    const recovered = await read();
    expect(recovered.state.job).toBeNull();
    expect(recovered.state.materials).toHaveLength(1);
    expect(polls().some(([path]) => path === `/fact-jobs/${submitted}`)).toBe(true);
  });

  it('a transient loser returns the same-job completed snapshot without resurrecting it', async () => {
    await start();
    const held = holdOnePoll();
    const pending = GET(request(), context);
    await held.entered; reply = ready;
    const winner = await read();
    held.reject(new Error('Synthetic late network failure'));
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(winner);
    expect((await stored()).state.job).toBeNull();
    expect((await stored()).state.history.filter(item => item.type === 'candidates_extracted')).toHaveLength(1);
  });

  for (const malformed of [false, true]) it(`converges two readers recording the first warning for the same still-running job: partial raw=${malformed}`, async () => {
    const started = await start();
    let enter!: () => void;
    const entered = new Promise<void>(yes => { enter = yes; });
    const releases: (() => void)[] = [];
    bindings.service.mockClear().mockImplementation(async (path: string, init?: RequestInit) => {
      if (!path.startsWith('/fact-jobs/') || init?.method === 'DELETE') return serviceReply(path, init);
      await new Promise<void>(yes => { releases.push(yes); if (releases.length === 2) enter(); });
      if (malformed) return { status: 'ready', result: { raw: 'Synthetic original partial response', backend: 'controlled-test-fixture', model: 17 } };
      throw new Error('Synthetic simultaneous transport interruption');
    });
    const pending = [GET(request(), context), GET(request(), context)];
    await entered;
    for (const release of releases) release();
    const responses = await Promise.all(pending);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    const states = await Promise.all(responses.map(response => response.json() as Promise<MaterialFactsResponse>));
    expect(states[0]).toEqual(states[1]);
    expect(states[0].revision).toBe(started.revision + 1);
    expect(states[0].state.job).toMatchObject({ id: started.state.job!.id, status: 'running' });
    expect(states[0].state.history).toEqual(started.state.history);
    expect(deletes()).toEqual([]);
  });

  it('never attaches a mismatched submission acknowledgement instead of the claimed UUID', async () => {
    const initial = await read();
    let submitted: string | undefined;
    bindings.service.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/fact-jobs') {
        submitted = (JSON.parse(String(init?.body)) as { jobId?: string }).jobId;
        return { jobId: 'mismatched-service-id' };
      }
      return serviceReply(path, init);
    });
    const response = await act(initial, { action: 'extract', evidenceId: 'source-1' });
    expect(response.status).toBe(202);
    const interrupted = await response.json() as MaterialFactsResponse;
    expect(submitted).toBeTruthy();
    expect(interrupted.state.job).toMatchObject({ id: submitted, status: 'running' });
    bindings.service.mockImplementation(serviceReply); reply = ready;
    const recovered = await read();
    expect(recovered.state.job).toBeNull();
    expect(polls().some(([path]) => path === `/fact-jobs/${submitted}`)).toBe(true);
  });

  for (const mutation of ['replacement job', 'new generation'] as const) it(`keeps a transient old poll conflicting after ${mutation}`, async () => {
    const started = await start();
    const held = holdOnePoll();
    const pending = GET(request(), context);
    await held.entered;
    let replacement: MaterialFactsResponse | undefined;
    if (mutation === 'replacement job') {
      const response = await act(started, { action: 'extract', evidenceId: 'source-1' });
      expect(response.status).toBe(202); replacement = await response.json() as MaterialFactsResponse;
    } else await addSource('new-upload', false);
    held.reject(new Error('Synthetic late network failure'));
    expect((await pending).status).toBe(409);
    const current = await stored();
    if (replacement) expect(current.state.job?.id).toBe(replacement.state.job!.id);
    expect(current.state.materials).toEqual([]);
  });
});
