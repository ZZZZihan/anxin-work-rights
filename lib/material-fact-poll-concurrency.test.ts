// Disposable D1 API integration; service replies and all document text here are
// synthetic fixtures. These checks do not measure real-model extraction quality.
import { readFileSync, readdirSync } from 'node:fs';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaterialFactsResponse } from './material-fact-types';

const bindings = vi.hoisted(() => ({ DB: undefined as unknown as D1Database, service: vi.fn() }));
vi.mock('cloudflare:workers', () => ({ env: bindings }));
vi.mock('./material-service-client', () => ({ materialServiceConfigured: () => true, callMaterialService: bindings.service }));
import { GET, POST } from '../app/api/cases/[id]/facts/route';

let mf: Miniflare;
const headers = (user = 'owner') => ({ 'oai-authenticated-user-id': user, 'oai-authenticated-user-email': `${user}@synthetic.test` });
const context = { params: Promise.resolve({ id: 'fact-case' }) };
const request = (method = 'GET', body?: unknown, user = 'owner') => new Request('http://127.0.0.1/api/cases/fact-case/facts', { method, headers: headers(user), ...(body ? { body: JSON.stringify(body) } : {}) });
const note = '合成集成测试：已核对同一劳动者同一工资期间的完整金额，统一为税前口径。';
const raw = JSON.stringify({ candidates: [] });

async function addSource(id = 'source-1', ready = true) {
  await bindings.DB.prepare(`INSERT INTO evidence_files (id,user_id,case_id,name,category,size,mime_type,status,note,object_key,content_hash,uploaded_at)
    VALUES (?,'owner','fact-case','synthetic.txt','工资支付',100,'text/plain',?,'','synthetic-object',?,'2026-10-17')`).bind(id, ready ? 'uploaded' : 'uploading', 'a'.repeat(64)).run();
  if (!ready) return;
  const result = { engine: { ocr: 'controlled-test-fixture', structuring: 'ocr_rules', model: null }, pageCount: 1,
    blocks: [{ id: 'b1', page: 1, text: '张三在合成测试单位的2026年1月本期完整应付工资1000元，本期完整已付工资200元。', bbox: null, confidence: null }],
    fields: [], warnings: [], source: { evidenceId: id, name: 'synthetic.txt', sha256: 'a'.repeat(64), mimeType: 'text/plain' } };
  await bindings.DB.prepare(`INSERT INTO evidence_analyses (evidence_id,user_id,content_hash,document_kind,status,revision,run_id,result_json,started_at,updated_at)
    VALUES (?,'owner',?,'other','ready',1,'synthetic-run',?,'2026-10-17','2026-10-17')`).bind(id, 'a'.repeat(64), JSON.stringify(result)).run();
}
async function read(user = 'owner') {
  const response = await GET(request('GET', undefined, user), context);
  expect(response.status).toBe(200);
  return await response.json() as MaterialFactsResponse;
}
async function act(current: MaterialFactsResponse, action: Record<string, unknown>, user = 'owner') {
  return POST(request('POST', { revision: current.revision, generation: current.generation, ...action }, user), context);
}

async function startJob() {
  const initial = await read();
  const started = await act(initial, { action: 'extract', evidenceId: 'source-1' });
  expect(started.status).toBe(202);
  return await started.json() as MaterialFactsResponse;
}

function holdPolls(reply: unknown, expected = 2) {
  const releases: (() => void)[] = [];
  let enter!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  bindings.service.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/health') return { capabilities: { factBackend: 'controlled-test-fixture', factConfigured: true } };
    if (init?.method === 'DELETE') return { ok: true };
    if (path === '/fact-jobs') return { jobId: JSON.parse(String(init?.body)).jobId };
    const index = releases.length;
    await new Promise<void>(resolve => {
      releases.push(resolve);
      if (releases.length === expected) enter();
    });
    if (reply instanceof Error) throw reply;
    return typeof reply === 'function' ? reply(index) : reply;
  });
  return { entered, release: () => { for (const release of releases) release(); }, releaseOne: (index: number) => releases[index]() };
}
const ready = { status: 'ready', result: { raw, backend: 'controlled-test-fixture', model: null } };

describe('material fact read-side job consumption concurrency', () => {
  beforeEach(async () => {
    vi.stubEnv('NODE_ENV', 'production');
    bindings.service.mockReset().mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/health') return { capabilities: { factBackend: 'controlled-test-fixture', factConfigured: true } };
      if (init?.method === 'DELETE') return { ok: true };
      if (path === '/fact-jobs') return { jobId: JSON.parse(String(init?.body)).jobId };
      return { status: 'ready', result: { raw, backend: 'controlled-test-fixture', model: null } };
    });
    mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("disposable fact test"); } };', compatibilityDate: '2026-09-11', d1Databases: ['DB'] }));
    bindings.DB = await mf.getD1Database('DB') as unknown as D1Database;
    for (const name of readdirSync(new URL('../drizzle/', import.meta.url)).filter((name) => name.endsWith('.sql')).sort()) {
      const statements = readFileSync(new URL(`../drizzle/${name}`, import.meta.url), 'utf8').split('--> statement-breakpoint');
      await bindings.DB.batch(statements.filter((statement) => statement.trim()).map((statement) => bindings.DB.prepare(statement)));
    }
    await bindings.DB.prepare(`INSERT INTO cases (id,user_id,type,company,status,next_action,created_at,updated_at) VALUES ('fact-case','owner','欠薪','合成测试单位','collecting','整理材料','2026-10-17','2026-10-17')`).run();
    await addSource();
  }, 30_000);
  afterEach(async () => { await mf?.dispose(); vi.unstubAllEnvs(); }, 20_000);


  it('converges two same-job ready reads without duplicating state, audit or cancellation', async () => {
    const started = await startJob();
    const held = holdPolls(ready);
    const pending = [GET(request(), context), GET(request(), context)];
    await held.entered;
    held.release();
    const responses = await Promise.all(pending);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    const states = await Promise.all(responses.map(response => response.json() as Promise<MaterialFactsResponse>));
    expect(states[0]).toEqual(states[1]);
    expect(states[0].revision).toBe(started.revision + 1);
    expect(states[0].state.job).toBeNull();
    expect(states[0].state.materials).toHaveLength(1);
    expect(states[0].state.history.filter(entry => entry.type === 'candidates_extracted')).toHaveLength(1);
    expect(states[0].state.confirmations).toEqual({ due: null, paid: null });
    expect(states[0].canCalculate).toBe(false);
    expect(bindings.service.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
    // POSTs still require the exact revision, even when they originated from a
    // tab whose read was safely converged to the already-consumed job.
    expect((await act(started, { action: 'exclude_source', evidenceId: 'source-1', reason: note })).status).toBe(409);
  });

  it('converges two failed-job reads and preserves the failure for an explicit retry', async () => {
    const started = await startJob();
    const held = holdPolls({ status: 'failed', error: { message: 'synthetic extraction failure' } });
    const pending = [GET(request(), context), GET(request(), context)];
    await held.entered; held.release();
    const responses = await Promise.all(pending);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    const states = await Promise.all(responses.map(response => response.json() as Promise<MaterialFactsResponse>));
    expect(states[0]).toEqual(states[1]);
    expect(states[0].revision).toBe(started.revision + 1);
    expect(states[0].state.job).toMatchObject({ id: started.state.job!.id, status: 'failed', error: 'synthetic extraction failure' });
    expect(states[0].state.materials).toEqual([]);
    expect(bindings.service.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
    expect((await act(states[0], { action: 'extract', evidenceId: 'source-1' })).status).toBe(202);
  });

  it('returns the stored result if the winning reader already removed the remote job', async () => {
    const started = await startJob();
    const held = holdPolls((index: number) => {
      if (index === 1) throw new Error('synthetic remote job already deleted');
      return ready;
    });
    const pending = [GET(request(), context), GET(request(), context)];
    await held.entered;
    held.releaseOne(0);
    expect((await Promise.race(pending)).status).toBe(200);
    // The second reader saw running locally before the winner committed, but
    // the remote job now no longer exists. Its fallback must not write failed.
    held.releaseOne(1);
    expect((await Promise.all(pending)).map(response => response.status)).toEqual([200, 200]);
    const current = await read();
    expect(current.revision).toBe(started.revision + 1);
    expect(current.state.job).toBeNull();
    expect(current.state.materials).toHaveLength(1);
  });

  it('does not turn a late old poll into a successful write over a replacement job', async () => {
    const started = await startJob();
    const held = holdPolls(ready, 1);
    const pending = GET(request(), context);
    await held.entered;
    const replacement = await act(started, { action: 'extract', evidenceId: 'source-1' });
    expect(replacement.status).toBe(202);
    const newer = await replacement.json() as MaterialFactsResponse;
    held.release();
    expect((await pending).status).toBe(409);
    const current = await bindings.DB.prepare('SELECT state_json FROM case_material_facts WHERE case_id=?').bind('fact-case').first<{ state_json: string }>();
    expect(JSON.parse(current!.state_json).job.id).toBe(newer.state.job!.id);
    expect(JSON.parse(current!.state_json).materials).toEqual([]);
  });

  it('keeps generation changes and user exclusions as genuine conflicts', async () => {
    const started = await startJob();
    let held = holdPolls(ready, 1);
    let pending = GET(request(), context);
    await held.entered;
    const excluded = await act(started, { action: 'exclude_source', evidenceId: 'source-1', reason: note });
    expect(excluded.status).toBe(200);
    held.release();
    expect((await pending).status).toBe(409);
    expect((await read()).state.materials[0].status).toBe('excluded');
    await startJob();
    held = holdPolls(ready, 1);
    pending = GET(request(), context);
    await held.entered;
    await addSource('racing-upload', false);
    held.release();
    expect((await pending).status).toBe(409);
    expect((await read()).state.materials).toEqual([]);
  });

  it('rechecks ownership and archive status before returning a converged snapshot', async () => {
    await startJob();
    const held = holdPolls(ready, 1);
    const pending = GET(request(), context);
    await held.entered;
    await bindings.DB.prepare("UPDATE cases SET status='archived' WHERE id='fact-case'").run();
    held.release();
    expect((await pending).status).toBe(404);
    expect((await GET(request('GET', undefined, 'foreign'), context)).status).toBe(404);
    expect(await bindings.DB.prepare('SELECT state_json FROM case_material_facts').first()).toBeNull();
  });
});
