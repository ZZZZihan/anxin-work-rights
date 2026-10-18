// Real route + disposable D1 + actual service client. Only the HTTP boundary is
// controlled; this does not exercise a live service, browser, or model quality.
import { readFileSync, readdirSync } from 'node:fs';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeFactState, RuntimeMaterialFactsResponse } from './material-fact-runtime-types';

const bindings = vi.hoisted(() => ({
  DB: undefined as unknown as D1Database,
  ANXIN_MATERIAL_SERVICE_URL: 'http://127.0.0.1:41977/',
  ANXIN_MATERIAL_SERVICE_TOKEN: 'synthetic-submit-rejection-token',
}));
vi.mock('cloudflare:workers', () => ({ env: bindings }));
import { GET, POST } from '../app/api/cases/[id]/facts/route';

let mf: Miniflare;
const caseId = 'submit-rejection-case';
const context = { params: Promise.resolve({ id: caseId }) };
const originalRaw = '{ "schemaVersion": 3, "candidates": [] }';
const ready = { status: 'ready', result: { raw: originalRaw, backend: 'controlled-http-fixture', model: null, finish_reason: 'stop' } };
type Dispatch = (jobId: string) => Response | Promise<Response>;
let dispatch: Dispatch;
let pollReply: unknown;
let accepted: Set<string>;
let calls: { path: string; method: string; jobId?: string }[];
function request(body?: unknown, owner = 'owner') {
  return new Request(`http://127.0.0.1/api/cases/${caseId}/facts`, {
    method: body ? 'POST' : 'GET',
    headers: { 'oai-authenticated-user-id': owner, 'oai-authenticated-user-email': `${owner}@synthetic.test` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function stored() {
  const row = await bindings.DB.prepare('SELECT revision,state_json FROM case_material_facts WHERE case_id=?')
    .bind(caseId).first<{ revision: number; state_json: string }>();
  return { revision: row!.revision, state: JSON.parse(row!.state_json) as RuntimeFactState, json: row!.state_json };
}
async function read() {
  const response = await GET(request(), context);
  expect(response.status).toBe(200);
  return await response.json() as RuntimeMaterialFactsResponse;
}
async function act(current: RuntimeMaterialFactsResponse, action: Record<string, unknown>, owner = 'owner') {
  return POST(request({ revision: current.revision, generation: current.generation, ...action }, owner), context);
}
const submit = (current: RuntimeMaterialFactsResponse) => act(current, { action: 'extract', evidenceId: 'source-1' });
const submits = () => calls.filter(call => call.path === '/fact-jobs' && call.method === 'POST');
const polls = () => calls.filter(call => call.path.startsWith('/fact-jobs/') && call.method === 'GET');
const deletes = () => calls.filter(call => call.method === 'DELETE');
async function addSource(id = 'source-1') {
  await bindings.DB.prepare(`INSERT INTO evidence_files (id,user_id,case_id,name,category,size,mime_type,status,note,object_key,content_hash,uploaded_at)
    VALUES (?,'owner',?,'synthetic.txt','工资支付',100,'text/plain','uploaded','','synthetic-object',?,'2026-10-18')`)
    .bind(id, caseId, 'a'.repeat(64)).run();
  const result = { engine: { ocr: 'controlled-test-fixture', structuring: 'ocr_rules', model: null }, pageCount: 1,
    blocks: [{ id: 'b1', page: 1, text: '合成测试单位的张三2026年1月完整应付工资1000元。', bbox: null, confidence: null }], fields: [], warnings: [],
    source: { evidenceId: id, name: 'synthetic.txt', sha256: 'a'.repeat(64), mimeType: 'text/plain' } };
  await bindings.DB.prepare(`INSERT INTO evidence_analyses (evidence_id,user_id,content_hash,document_kind,status,revision,run_id,result_json,started_at,updated_at)
    VALUES (?,'owner',?,'other','ready',1,'synthetic-run',?,'2026-10-18','2026-10-18')`).bind(id, 'a'.repeat(64), JSON.stringify(result)).run();
}
async function boundary(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  expect(url.origin).toBe('http://127.0.0.1:41977');
  expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${bindings.ANXIN_MATERIAL_SERVICE_TOKEN}`);
  const method = init?.method ?? 'GET';
  const call: (typeof calls)[number] = { path: url.pathname, method };
  calls.push(call);
  if (url.pathname === '/health') return Response.json({ capabilities: { factBackend: 'controlled-http-fixture', factConfigured: true } });
  if (url.pathname === '/fact-jobs' && method === 'POST') {
    const body = JSON.parse(String(init?.body)) as { jobId: string; source: { id: string } };
    expect(body.source.id).toBe('source-1');
    expect(body.jobId).toMatch(/^[a-f0-9-]{36}$/);
    call.jobId = body.jobId;
    return dispatch(body.jobId);
  }
  if (url.pathname.startsWith('/fact-jobs/') && method === 'DELETE') return Response.json({ ok: true });
  if (url.pathname.startsWith('/fact-jobs/') && method === 'GET') {
    const jobId = decodeURIComponent(url.pathname.slice('/fact-jobs/'.length));
    return accepted.has(jobId) ? Response.json(pollReply) : Response.json({ error: 'Synthetic job absent' }, { status: 404 });
  }
  throw new Error(`Unexpected synthetic HTTP ${method} ${url.pathname}`);
}

function holdFirstSubmission() {
  let enter!: () => void;
  let release!: (response: Response) => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const held = new Promise<Response>(resolve => { release = resolve; });
  let first = true;
  dispatch = jobId => {
    if (first) { first = false; enter(); return held; }
    accepted.add(jobId); return Response.json({ jobId }, { status: 202 });
  };
  return { entered, release };
}
async function confirmAmounts(current: RuntimeMaterialFactsResponse) {
  const scope = await act(current, { action: 'confirm_scope', scope: { worker: '张三', employer: '合成测试单位', start: '2026-01-01', end: '2026-01-31' }, note: 'Synthetic complete scope independently checked', verified: true });
  expect([200, 202]).toContain(scope.status);
  current = await scope.json() as RuntimeMaterialFactsResponse;
  for (const [field, amount] of [['due', '1000'], ['paid', '0']] as const) {
    const confirmation = await act(current, { action: 'confirm_amount', field, amount, note: 'Synthetic user attestation, not model confirmation', reviewedCandidateIds: current.candidates.filter(candidate => candidate.amount !== null).map(candidate => candidate.id), complete: true, verified: true });
    expect([200, 202]).toContain(confirmation.status);
    current = await confirmation.json() as RuntimeMaterialFactsResponse;
  }
  return current;
}
function expectNoInventedResult(current: RuntimeMaterialFactsResponse) {
  expect(current.state.materials).toHaveLength(0);
  expect(current.candidates).toHaveLength(0);
  expect(current.state.confirmations).toEqual({ due: null, paid: null });
  expect(current.state.calculation).toBeNull();
  expect(current.state.history.filter(item => item.type === 'candidates_extracted')).toHaveLength(0);
  expect(current.canCalculate).toBe(false);
}

describe('independent submit rejection versus uncertain acceptance through real client and D1 routes', () => {
  beforeEach(async () => {
    vi.stubEnv('NODE_ENV', 'production');
    calls = []; accepted = new Set(); pollReply = ready;
    dispatch = jobId => { accepted.add(jobId); return Response.json({ jobId }, { status: 202 }); };
    mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("disposable rejection test"); } };', compatibilityDate: '2026-09-11', d1Databases: ['DB'] }));
    bindings.DB = await mf.getD1Database('DB') as unknown as D1Database;
    for (const name of readdirSync(new URL('../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
      const sql = readFileSync(new URL(`../drizzle/${name}`, import.meta.url), 'utf8').split('--> statement-breakpoint');
      await bindings.DB.batch(sql.filter(statement => statement.trim()).map(statement => bindings.DB.prepare(statement)));
    }
    await bindings.DB.prepare(`INSERT INTO cases (id,user_id,type,company,status,next_action,created_at,updated_at)
      VALUES (?,'owner','欠薪','合成测试单位','collecting','整理材料','2026-10-18','2026-10-18')`).bind(caseId).run();
    await addSource();
    vi.stubGlobal('fetch', vi.fn(boundary));
  }, 30_000);
  afterEach(async () => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.unstubAllEnvs(); await mf?.dispose(); }, 20_000);

  it('persists a definite HTTP 429 rejection as failed and never polls a nonexistent job', async () => {
    dispatch = () => Response.json({ error: 'Synthetic capacity rejection' }, { status: 429 });
    const response = await submit(await read());
    const body = await response.json() as RuntimeMaterialFactsResponse;
    expect.soft(response.status).not.toBe(202);
    expect.soft(body.state.job?.status).toBe('failed');
    expect.soft((await stored()).state.job?.status).toBe('failed');
    await read(); await read();
    expect.soft(polls()).toHaveLength(0);
    expect(submits()).toHaveLength(1);
  });

  for (const status of [400, 401, 403, 404, 408, 409, 410, 413, 415, 422, 499]) it(`HTTP ${status} rejection is terminal without manufacturing model data`, async () => {
    dispatch = () => Response.json({ error: 'SYNTHETIC_PRIVATE_SERVICE_DETAIL', ...ready, jobId: 'forged-other-job' }, { status });
    const initial = await read();
    const response = await submit(initial);
    expect.soft(response.status).toBe(200);
    const body = await response.json() as RuntimeMaterialFactsResponse;
    expect.soft(body.state.job).toMatchObject({ id: submits()[0].jobId, status: 'failed', submissionPending: false });
    expect.soft(body.state.job?.pollFailureSince).toBeUndefined();
    expect.soft(body.state.job?.raw).toBeUndefined();
    expectNoInventedResult(body);
    expect(JSON.stringify(body)).not.toContain('SYNTHETIC_PRIVATE_SERVICE_DETAIL');
    expect((await stored()).json).not.toContain('SYNTHETIC_PRIVATE_SERVICE_DETAIL');
    const revision = body.revision;
    const later = await read();
    expect.soft(later.state.job?.status).toBe('failed');
    expect.soft(later.revision).toBe(revision);
    expect.soft(polls()).toHaveLength(0);
    expect(submits()).toHaveLength(1);
  });

  for (const [label, status, create] of [
    ['plain text 429', 429, () => new Response('SYNTHETIC_PRIVATE_SERVICE_DETAIL', { status: 429 })],
    ['malformed JSON 400', 400, () => new Response('{ "error":', { status: 400 })],
    ['empty 422', 422, () => new Response(null, { status: 422 })],
    ['unreadable 429', 429, () => { const response = new Response(null, { status: 429 }); vi.spyOn(response, 'text').mockRejectedValue(new Error('Synthetic body stream failure')); return response; }],
    ['oversized 413', 413, () => new Response('x'.repeat(500_001), { status: 413 })],
  ] as const) it(`recognizes ${label} from HTTP status independently of its response body`, async () => {
    dispatch = () => create();
    const response = await submit(await read());
    expect.soft(response.status, `HTTP ${status} must not be acknowledged as accepted`).toBe(200);
    const body = await response.json() as RuntimeMaterialFactsResponse;
    expect.soft(body.state.job?.status).toBe('failed');
    expect.soft(body.state.job?.pollFailureSince).toBeUndefined();
    expectNoInventedResult(body);
    expect(JSON.stringify(body)).not.toContain('SYNTHETIC_PRIVATE_SERVICE_DETAIL');
    await read();
    expect.soft(polls()).toHaveLength(0);
    expect(submits()).toHaveLength(1);
  });

  for (const [label, uncertainReply] of [
    ['HTTP 503 after acceptance', () => Response.json({ error: 'Synthetic upstream unavailable' }, { status: 503 })],
    ['malformed HTTP 500 after acceptance', () => new Response('not JSON', { status: 500 })],
    ['network timeout after acceptance', () => { throw new DOMException('Synthetic response timeout', 'TimeoutError'); }],
    ['network reset after acceptance', () => { throw new TypeError('Synthetic connection reset'); }],
    ['successful empty reply', () => new Response(null, { status: 202 })],
    ['successful malformed reply', () => new Response('{"jobId":', { status: 202 })],
    ['successful unreadable body', () => { const response = new Response(null, { status: 202 }); vi.spyOn(response, 'text').mockRejectedValue(new Error('Synthetic response stream lost')); return response; }],
  ] as const) it(`recovers the same persisted UUID after ${label}, without another POST`, async () => {
    dispatch = jobId => { accepted.add(jobId); return uncertainReply(); };
    const response = await submit(await read());
    expect(response.status).toBe(202);
    const pending = await response.json() as RuntimeMaterialFactsResponse;
    const jobId = submits()[0].jobId!;
    expect(pending.state.job).toMatchObject({ id: jobId, status: 'running', submissionPending: false });
    expect(pending.state.job?.pollFailureSince).toEqual(expect.any(String));
    expect((await stored()).state.job?.id).toBe(jobId);
    expectNoInventedResult(pending);
    const recovered = await read();
    expect(recovered.state.job).toBeNull();
    expect(recovered.state.materials).toHaveLength(1);
    expect(recovered.state.materials[0]).toMatchObject({ evidenceId: 'source-1', raw: originalRaw, backend: 'controlled-http-fixture' });
    expect(recovered.state.history.filter(item => item.type === 'candidates_extracted')).toHaveLength(1);
    expect(recovered.state.confirmations).toEqual({ due: null, paid: null });
    const saved = await stored();
    const reread = await read();
    expect(reread.revision).toBe(recovered.revision);
    expect((await stored()).json).toBe(saved.json);
    expect(submits()).toHaveLength(1);
    expect(polls()).toEqual([{ path: `/fact-jobs/${jobId}`, method: 'GET' }]);
    expect(deletes().every(call => call.path === `/fact-jobs/${jobId}`)).toBe(true);
  });

  it('does not fabricate a result or resubmit when a 503 was not actually accepted', async () => {
    dispatch = () => Response.json({ error: 'Synthetic unavailable before admission' }, { status: 503 });
    const response = await submit(await read());
    expect(response.status).toBe(202);
    const pending = await response.json() as RuntimeMaterialFactsResponse;
    for (let index = 0; index < 2; index++) {
      const current = await read();
      expect(current.state.job).toMatchObject({ id: pending.state.job!.id, status: 'running' });
      expectNoInventedResult(current);
    }
    expect(submits()).toHaveLength(1);
    expect(polls()).toHaveLength(2);
  });

  it('blocks another owner before dispatching or changing the fact row', async () => {
    const initial = await read();
    const before = await stored();
    const beforeCalls = calls.length;
    const post = await act(initial, { action: 'extract', evidenceId: 'source-1' }, 'other-owner');
    expect(post.status).toBe(404);
    expect((await GET(request(undefined, 'other-owner'), context)).status).toBe(404);
    expect(await stored()).toEqual(before);
    expect(calls).toHaveLength(beforeCalls);
  });

  it('a late 429 cannot overwrite a newer source generation or revive its retired UUID', async () => {
    const hold = holdFirstSubmission();
    const pending = submit(await read());
    await hold.entered;
    const oldJob = (await stored()).state.job!.id;
    await addSource('source-2');
    const latest = await read();
    const before = await stored();
    expect(latest.state.job).toBeNull();
    hold.release(Response.json({ error: 'Synthetic capacity rejection' }, { status: 429 }));
    expect((await pending).status).toBe(409);
    expect(await stored()).toEqual(before);
    expect(deletes().some(call => call.path === `/fact-jobs/${oldJob}`)).toBe(true);
    expect(polls()).toHaveLength(0);
  });

  it('a late 429 cannot overwrite a newer job in the same generation', async () => {
    const hold = holdFirstSubmission();
    const pending = submit(await read());
    await hold.entered;
    const claimed = await read();
    const oldJob = claimed.state.job!.id;
    const replacement = await submit(claimed);
    expect(replacement.status).toBe(202);
    const latest = await replacement.json() as RuntimeMaterialFactsResponse;
    const newJob = latest.state.job!.id;
    expect(newJob).not.toBe(oldJob);
    const before = await stored();
    hold.release(Response.json({ error: 'Synthetic capacity rejection' }, { status: 429 }));
    expect((await pending).status).toBe(409);
    expect(await stored()).toEqual(before);
    expect(deletes().some(call => call.path === `/fact-jobs/${oldJob}`)).toBe(true);
    expect(deletes().some(call => call.path === `/fact-jobs/${newJob}`)).toBe(false);
    const recovered = await read();
    expect(recovered.state.materials[0].raw).toBe(originalRaw);
    expect(polls()).toEqual([{ path: `/fact-jobs/${newJob}`, method: 'GET' }]);
    expect(submits()).toHaveLength(2);
  });

  it('a late rejection preserves intervening manual facts instead of silently overwriting them', async () => {
    const hold = holdFirstSubmission();
    const pending = submit(await read());
    await hold.entered;
    const current = await confirmAmounts(await read());
    const before = await stored();
    expect(current.state.confirmations).toMatchObject({ due: { amount: '1000.00' }, paid: { amount: '0.00' } });
    hold.release(new Response('Synthetic rejected', { status: 400 }));
    expect((await pending).status).toBe(409);
    expect(await stored()).toEqual(before);
    expect(polls()).toHaveLength(0);
  });

  for (const rejection of [true, false]) it(`never restores revoked manual confirmations after ${rejection ? 'definite rejection' : 'uncertain acceptance and later success'}`, async () => {
    const initialResponse = await submit(await read());
    expect(initialResponse.status).toBe(202);
    const original = await confirmAmounts(await read());
    const history = original.state.history;
    expect(original.canCalculate).toBe(true);
    dispatch = jobId => {
      if (!rejection) accepted.add(jobId);
      return Response.json({ error: 'Synthetic dispatch outcome' }, { status: rejection ? 429 : 503 });
    };
    const response = await submit(original);
    expect.soft(response.status).toBe(rejection ? 200 : 202);
    const changed = await response.json() as RuntimeMaterialFactsResponse;
    expect(changed.state.confirmations).toEqual({ due: null, paid: null });
    expect(changed.state.scope).toBeNull();
    expect(changed.state.calculation).toBeNull();
    expect(changed.state.history.slice(0, history.length)).toEqual(history);
    expect(changed.state.history.filter(item => item.type === 'amount_confirmed')).toHaveLength(2);
    expect(changed.state.job?.raw).toBeUndefined();
    const later = await read();
    expect(later.state.confirmations).toEqual({ due: null, paid: null });
    expect(later.state.history.filter(item => item.type === 'amount_confirmed')).toHaveLength(2);
    expect(later.canCalculate).toBe(false);
    if (rejection) {
      expect.soft(later.state.job?.status).toBe('failed');
      expect.soft(later.state.materials).toHaveLength(0);
    } else {
      expect(later.state.job).toBeNull();
      expect(later.state.materials[0].raw).toBe(originalRaw);
    }
    expect(submits()).toHaveLength(2);
  });

});
