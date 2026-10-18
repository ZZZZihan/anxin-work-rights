// Disposable D1 API integration; service replies and all document text here are
// synthetic fixtures. These checks do not measure real-model extraction quality.
import { readFileSync, readdirSync } from 'node:fs';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeMaterialFactsResponse as MaterialFactsResponse } from './material-fact-runtime-types';

const bindings = vi.hoisted(() => ({ DB: undefined as unknown as D1Database, service: vi.fn() }));
vi.mock('cloudflare:workers', () => ({ env: bindings }));
vi.mock('./material-service-client', () => ({ materialServiceConfigured: () => true, callMaterialService: bindings.service }));
import { GET, POST } from '../app/api/cases/[id]/facts/route';

let mf: Miniflare;
const headers = (user = 'owner') => ({ 'oai-authenticated-user-id': user, 'oai-authenticated-user-email': `${user}@synthetic.test` });
const context = { params: Promise.resolve({ id: 'fact-case' }) };
const request = (method = 'GET', body?: unknown, user = 'owner') => new Request('http://127.0.0.1/api/cases/fact-case/facts', { method, headers: headers(user), ...(body ? { body: JSON.stringify(body) } : {}) });
const scope = { worker: '张三', employer: '合成测试单位', start: '2026-01-01', end: '2026-01-31' };
const note = '合成集成测试：已核对同一劳动者同一工资期间的完整金额，统一为税前口径。';
const raw = JSON.stringify({ candidates: [
  { kind: 'due_total', value: '1000元', quote: '本期完整应付工资1000元', blockId: 'b1', subject: '张三', period: '2026年1月', qualifier: 'gross', assertion: 'narrated' },
  { kind: 'paid_total', value: '200元', quote: '本期完整已付工资200元', blockId: 'b1', subject: '张三', period: '2026年1月', qualifier: 'gross', assertion: 'narrated' },
] });

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
async function extracted() {
  let current = await read();
  expect((await act(current, { action: 'extract', evidenceId: 'source-1' })).status).toBe(202);
  current = await read();
  expect(current.candidates).toHaveLength(2);
  return current;
}
async function confirmed(due = '1000', paid = '200') {
  let current = await extracted();
  let response = await act(current, { action: 'confirm_scope', scope, note, verified: true });
  expect(response.status).toBe(200); current = await response.json() as MaterialFactsResponse;
  for (const [field, amount] of [['due', due], ['paid', paid]]) {
    response = await act(current, { action: 'confirm_amount', field, amount, note, complete: true, verified: true, reviewedCandidateIds: current.candidates.map((candidate) => candidate.id) });
    expect(response.status).toBe(200); current = await response.json() as MaterialFactsResponse;
  }
  return current;
}

describe('material facts API and transactional persistence', () => {
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

  it('keeps extraction as candidates, binds actor to authentication, and persists raw provenance', async () => {
    const current = await extracted();
    expect(current.state.confirmations).toEqual({ due: null, paid: null });
    expect(current.canCalculate).toBe(false);
    expect(current.state.materials[0]).toMatchObject({ raw, model: null, backend: 'controlled-test-fixture' });
    expect(current.state.history.every((entry) => entry.actor === 'owner')).toBe(true);
    const foreign = await GET(request('GET', undefined, 'other'), context);
    expect(foreign.status).toBe(404);
    const forged = await act(current, { action: 'confirm_scope', scope, note, verified: true, actor: 'model' });
    expect(forged.status).toBe(400);
    expect((await act(current, { action: 'calculate' }, 'other')).status).toBe(404);
  });

  it('requires explicit totals and commits integer arithmetic plus receipt in D1', async () => {
    let current = await confirmed('1000.01', '200.02');
    expect(current.canCalculate).toBe(true);
    const response = await act(current, { action: 'calculate' });
    expect(response.status).toBe(200);
    current = await response.json() as MaterialFactsResponse;
    expect(current.state.calculation).toMatchObject({ due: '1000.01', paid: '200.02', gap: '799.99', actor: 'owner', generation: current.generation });
    expect(current.state.calculation!.receiptId).toBeTruthy();
    const persisted = await bindings.DB.prepare('SELECT state_json FROM case_material_facts WHERE case_id=?').bind('fact-case').first<{ state_json: string }>();
    expect(JSON.parse(persisted!.state_json).calculation).toEqual(current.state.calculation);
  });

  it('does not produce a calculation receipt when the final SQL loses generation CAS', async () => {
    const current = await confirmed();
    const original = bindings.DB;
    let interleaved = false;
    bindings.DB = {
      batch: original.batch.bind(original),
      prepare(sql: string) {
        const statement = original.prepare(sql);
        if (!sql.includes('state_json=json_set')) return statement;
        return { bind(...values: unknown[]) {
          const bound = statement.bind(...values);
          return { async run() { interleaved = true; await addSource('during-calculation', false); return bound.run(); } };
        } } as unknown as D1PreparedStatement;
      },
    } as unknown as D1Database;
    const response = await act(current, { action: 'calculate' });
    expect(interleaved).toBe(true);
    expect(response.status).toBe(409);
    const persisted = await original.prepare('SELECT state_json FROM case_material_facts WHERE case_id=?').bind('fact-case').first<{ state_json: string }>();
    expect(JSON.parse(persisted!.state_json).calculation).toBeNull();
    expect(persisted!.state_json).not.toContain('receiptId');
  });

  it('preserves exact cents for a negative sub-yuan difference', async () => {
    const current = await confirmed('0', '0.01');
    const response = await act(current, { action: 'calculate' });
    expect(response.status).toBe(200);
    expect((await response.json() as MaterialFactsResponse).state.calculation!.gap).toBe('-0.01');
  });

  it('accepts explicit zero and rejects blank totals without modifying confirmation', async () => {
    const current = await confirmed('1000', '0');
    expect(current.state.confirmations.paid!.cents).toBe(0);
    const response = await act(current, { action: 'confirm_amount', field: 'paid', amount: '', note, complete: true, verified: true, reviewedCandidateIds: current.candidates.map((candidate) => candidate.id) });
    expect(response.status).toBe(400);
    expect((await read()).state.confirmations.paid!.cents).toBe(0);
  });

  it('invalidates confirmations from the first upload intent and blocks omitted new sources', async () => {
    const current = await confirmed();
    await addSource('new-upload', false);
    expect((await act(current, { action: 'calculate' })).status).toBe(409);
    const latest = await read();
    expect(latest.generation).toBeGreaterThan(current.generation);
    expect(latest.state.scope).toBeNull();
    expect(latest.state.confirmations).toEqual({ due: null, paid: null });
    expect(latest.canCalculate).toBe(false);
    expect(latest.sources.map((source) => source.id)).toContain('new-upload');
  });

  it('clears derived private text at deletion and rejects late stale actions', async () => {
    const current = await extracted();
    await bindings.DB.prepare("UPDATE evidence_files SET status='deleting' WHERE id='source-1'").run();
    expect(await bindings.DB.prepare('SELECT state_json FROM case_material_facts').first()).toBeNull();
    await bindings.DB.prepare("DELETE FROM evidence_analyses WHERE evidence_id='source-1'").run();
    await bindings.DB.prepare("DELETE FROM evidence_files WHERE id='source-1'").run();
    expect((await act(current, { action: 'confirm_scope', scope, note, verified: true })).status).toBe(409);
    const latest = await read();
    expect(latest.candidates).toEqual([]);
    expect(JSON.stringify(latest.state)).not.toContain('本期完整应付工资');
  });

  it('makes archive/restore and company changes invalidate earlier authorizations', async () => {
    const current = await confirmed();
    await bindings.DB.prepare("UPDATE cases SET status='archived' WHERE id='fact-case'").run();
    expect((await GET(request(), context)).status).toBe(404);
    await bindings.DB.prepare("UPDATE cases SET status='collecting' WHERE id='fact-case'").run();
    expect((await act(current, { action: 'calculate' })).status).toBe(409);
    const restored = await read();
    expect(restored.state.confirmations.due).toBeNull();
    await bindings.DB.prepare("UPDATE cases SET company='另一合成单位' WHERE id='fact-case'").run();
    expect((await read()).generation).toBeGreaterThan(restored.generation);
  });

  it('rejects stale concurrent revisions without a second write', async () => {
    const current = await extracted();
    const both = await Promise.all([act(current, { action: 'confirm_scope', scope, note, verified: true }), act(current, { action: 'exclude_source', evidenceId: 'source-1', reason: note })]);
    expect(both.map((response) => response.status).sort()).toEqual([200, 409]);
  });

  it('cancels a job started while another upload changes the generation', async () => {
    const current = await read();
    let release!: (value: unknown) => void;
    let entered!: () => void;
    const called = new Promise<void>((resolve) => { entered = resolve; });
    bindings.service.mockImplementation(async (path: string) => {
      if (path === '/fact-jobs') { entered(); return new Promise((resolve) => { release = resolve; }); }
      return { ok: true };
    });
    const pending = act(current, { action: 'extract', evidenceId: 'source-1' });
    await called;
    await addSource('racing-upload', false);
    const submittedId = JSON.parse(String(bindings.service.mock.calls.find(([path]) => path === '/fact-jobs')![1]!.body)).jobId;
    release({ jobId: submittedId });
    expect((await pending).status).toBe(409);
    expect(bindings.service).toHaveBeenCalledWith(`/fact-jobs/${submittedId}`, { method: 'DELETE' });
    expect((await read()).state.job).toBeNull();
  });

  it('claims re-extraction before a delayed service call and blocks concurrent calculation', async () => {
    const current = await confirmed();
    let release!: (value: unknown) => void;
    let entered!: () => void;
    const called = new Promise<void>((resolve) => { entered = resolve; });
    bindings.service.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/fact-jobs') { entered(); return new Promise((resolve) => { release = resolve; }); }
      if (path === '/health') return { capabilities: { factBackend: 'controlled-test-fixture', factConfigured: true } };
      if (init?.method === 'DELETE') return { ok: true };
      throw new Error('starting job must not be remotely polled');
    });
    const pending = act(current, { action: 'extract', evidenceId: 'source-1' });
    await called;
    expect((await act(current, { action: 'calculate' })).status).toBe(409);
    const claimed = await read();
    expect(claimed.state.job!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(claimed.state.job!.submissionPending).toBe(true);
    expect(claimed.state.job!.status).toBe('running');
    expect(claimed.state.scope).toBeNull();
    expect(claimed.state.confirmations).toEqual({ due: null, paid: null });
    expect(claimed.canCalculate).toBe(false);
    expect((await act(claimed, { action: 'calculate' })).status).toBe(400);
    expect(bindings.service.mock.calls.some(([path]) => String(path).startsWith('/fact-jobs/starting_'))).toBe(false);
    release({ jobId: claimed.state.job!.id });
    const finished = await pending;
    expect(finished.status).toBe(202);
    expect((await finished.json() as MaterialFactsResponse).state.job!.id).toBe(claimed.state.job!.id);
  });

  it('expires an interrupted starting claim without querying a fabricated remote job', async () => {
    const current = await read();
    const state = { ...current.state, job: { id: `starting_${Date.now() - 61_000}_synthetic`, evidenceId: 'source-1', generation: current.generation, status: 'running', error: null } };
    await bindings.DB.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=?').bind(JSON.stringify(state), 'fact-case').run();
    const latest = await read();
    expect(latest.state.job!.status).toBe('failed');
    expect(latest.state.job!.error).toContain('未能完成提交');
    expect(bindings.service.mock.calls.some(([path]) => String(path).startsWith('/fact-jobs/starting_'))).toBe(false);
  });

  it('retains a temporarily unreachable job for polling recovery without fabricating candidates', async () => {
    const current = await read();
    expect((await act(current, { action: 'extract', evidenceId: 'source-1' })).status).toBe(202);
    bindings.service.mockImplementation(async (path: string) => {
      if (path === '/health') return { capabilities: { factBackend: 'controlled-test-fixture', factConfigured: true } };
      throw new Error('synthetic offline extraction');
    });
    const latest = await read();
    expect(latest.state.job).toMatchObject({ status: 'running', error: expect.stringContaining('正在重试') });
    expect(latest.candidates).toEqual([]);
    expect(latest.state.confirmations).toEqual({ due: null, paid: null });
  });

  it('invalidates earlier confirmations while an ambiguous submission is being reconciled', async () => {
    const current = await confirmed();
    bindings.service.mockImplementation(async (path: string) => {
      if (path === '/health') return { capabilities: { factBackend: 'controlled-test-fixture', factConfigured: true } };
      throw new Error('synthetic submission unavailable');
    });
    const response = await act(current, { action: 'extract', evidenceId: 'source-1' });
    expect(response.status).toBe(202);
    const latest = await response.json() as MaterialFactsResponse;
    expect(latest.state.job).toMatchObject({ status: 'running', error: expect.stringContaining('提交回执暂未收到') });
    expect(latest.state.scope).toBeNull();
    expect(latest.state.confirmations).toEqual({ due: null, paid: null });
    expect(latest.state.materials).toEqual([]);
    expect(latest.canCalculate).toBe(false);
  });

  it('keeps malformed original model output for review while the source stays unresolved', async () => {
    const current = await read();
    expect((await act(current, { action: 'extract', evidenceId: 'source-1' })).status).toBe(202);
    bindings.service.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/health') return { capabilities: { factBackend: 'controlled-test-fixture', factConfigured: true } };
      if (init?.method === 'DELETE') return { ok: true };
      return { status: 'ready', result: { raw: 'synthetic invalid JSON response', backend: 'controlled-test-fixture', model: 'synthetic-model' } };
    });
    const latest = await read();
    expect(latest.state.job).toMatchObject({ status: 'failed', raw: 'synthetic invalid JSON response', backend: 'controlled-test-fixture', model: 'synthetic-model' });
    expect(latest.state.materials).toEqual([]);
    expect(latest.canCalculate).toBe(false);
  });

  it('preserves incomplete model output without accepting even syntactically valid candidates', async () => {
    const current = await read();
    expect((await act(current, { action: 'extract', evidenceId: 'source-1' })).status).toBe(202);
    bindings.service.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/health') return { capabilities: { factBackend: 'controlled-test-fixture', factConfigured: true } };
      if (init?.method === 'DELETE') return { ok: true };
      return { status: 'ready', result: { raw, backend: 'controlled-test-fixture', model: 'synthetic-model', finish_reason: 'length' } };
    });
    const latest = await read();
    expect(latest.state.job).toMatchObject({ status: 'failed', raw });
    expect(latest.state.job!.error).toContain('length');
    expect(latest.candidates).toEqual([]);
    expect(latest.state.materials).toEqual([]);
  });

  it('blocks dispatch for malformed stored original blocks and rejects client-owned state', async () => {
    await bindings.DB.prepare("UPDATE evidence_analyses SET result_json='{}' WHERE evidence_id='source-1'").run();
    const current = await read();
    expect(current.sources[0].ready).toBe(false);
    expect((await act(current, { action: 'extract', evidenceId: 'source-1' })).status).toBe(400);
    expect(bindings.service.mock.calls.some(([path]) => path === '/fact-jobs')).toBe(false);
    expect((await act(current, { action: 'calculate', state: { confirmed: true } })).status).toBe(400);
  });
});
