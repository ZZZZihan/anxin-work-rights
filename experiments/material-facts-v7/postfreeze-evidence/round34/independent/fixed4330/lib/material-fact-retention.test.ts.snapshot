// Real API route handlers + disposable D1 + the actual bounded fact queue.
// Only the service-client boundary and wall clock are controlled; no Worker or
// real inference process is started, and these fixtures are not model evaluation.
import { readFileSync, readdirSync } from 'node:fs';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FactSource } from './material-fact-types';
import type { RuntimeMaterialFactsResponse as MaterialFactsResponse } from './material-fact-runtime-types';
// @ts-expect-error The production queue is a native JavaScript module without declarations.
import { createFactJobs } from '../scripts/fact-jobs.mjs';

type Queue = {
  submit(payload: { source: FactSource; jobId: string }): { jobId: string };
  get(id: string): { status: string; result?: { raw: string } } | null;
  cancel(id: string): Promise<void>;
  close(): Promise<void>;
};
const bindings = vi.hoisted(() => ({ DB: undefined as unknown as D1Database, service: vi.fn() }));
vi.mock('cloudflare:workers', () => ({ env: bindings }));
vi.mock('./material-service-client', () => ({ materialServiceConfigured: () => true, callMaterialService: bindings.service }));
import { GET, POST } from '../app/api/cases/[id]/facts/route';

let mf: Miniflare;
let jobs: Queue;
let submission: { source: FactSource; jobId: string };
const minute = 60_000;
const epoch = Date.parse('2026-10-18T12:00:00.000Z');
const context = { params: Promise.resolve({ id: 'retention-case' }) };
const headers = { 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'owner@synthetic.test' };
const request = (body?: unknown) => new Request('http://127.0.0.1/api/cases/retention-case/facts', {
  method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}),
});
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
  const started = await response.json() as MaterialFactsResponse;
  expect(started.state.job).toMatchObject({ id: submission.jobId, status: 'running', startedAt: new Date(epoch).toISOString(), submissionPending: false });
  expect(jobs.get(submission.jobId)?.status).toBe('ready');
  return started;
}
async function stored() {
  const row = await bindings.DB.prepare("SELECT revision,state_json FROM case_material_facts WHERE case_id='retention-case'")
    .first<{ revision: number; state_json: string }>();
  return { revision: row!.revision, state: JSON.parse(row!.state_json) as MaterialFactsResponse['state'] };
}
const polls = () => bindings.service.mock.calls.filter(([path, init]) => path.startsWith('/fact-jobs/') && init?.method !== 'DELETE');
const deletes = () => bindings.service.mock.calls.filter(([, init]) => init?.method === 'DELETE');
function readyRaw() {
  const raw = jobs.get(submission.jobId)?.result?.raw;
  expect(typeof raw).toBe('string');
  return raw!;
}
function singleImport(state: MaterialFactsResponse['state'], raw: string) {
  expect.soft(state.job).toBeNull();
  expect.soft(state.materials).toHaveLength(1);
  expect.soft(state.materials[0]?.raw).toBe(raw);
  expect.soft(state.history.filter(item => item.type === 'candidates_extracted')).toHaveLength(1);
  expect.soft(state.confirmations).toEqual({ due: null, paid: null });
  expect.soft(state.calculation).toBeNull();
}

describe('completed fact result retention across an inactive page', () => {
  beforeEach(async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("disposable retention test"); } };', compatibilityDate: '2026-09-11', d1Databases: ['DB'] }));
    bindings.DB = await mf.getD1Database('DB') as unknown as D1Database;
    for (const name of readdirSync(new URL('../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
      const sql = readFileSync(new URL(`../drizzle/${name}`, import.meta.url), 'utf8').split('--> statement-breakpoint');
      await bindings.DB.batch(sql.filter(statement => statement.trim()).map(statement => bindings.DB.prepare(statement)));
    }
    await bindings.DB.prepare(`INSERT INTO cases (id,user_id,type,company,status,next_action,created_at,updated_at)
      VALUES ('retention-case','owner','欠薪','合成测试单位','collecting','整理材料','2026-10-18','2026-10-18')`).run();
    await bindings.DB.prepare(`INSERT INTO evidence_files (id,user_id,case_id,name,category,size,mime_type,status,note,object_key,content_hash,uploaded_at)
      VALUES ('source-1','owner','retention-case','synthetic.txt','工资支付',100,'text/plain','uploaded','','synthetic-object',?,'2026-10-18')`).bind('a'.repeat(64)).run();
    const result = { engine: { ocr: 'controlled-test-fixture', structuring: 'ocr_rules', model: null }, pageCount: 1,
      blocks: [{ id: 'b1', page: 1, text: '张三在合成测试单位2026年1月应发工资1000元，累计已付0元。', bbox: null, confidence: null }], fields: [], warnings: [],
      source: { evidenceId: 'source-1', name: 'synthetic.txt', sha256: 'a'.repeat(64), mimeType: 'text/plain' } };
    await bindings.DB.prepare(`INSERT INTO evidence_analyses (evidence_id,user_id,content_hash,document_kind,status,revision,run_id,result_json,started_at,updated_at)
      VALUES ('source-1','owner',?,'other','ready',1,'synthetic-run',?,'2026-10-18','2026-10-18')`).bind('a'.repeat(64), JSON.stringify(result)).run();
    // Fake Date only: Miniflare's I/O/timers remain real. Both D1 claim metadata
    // and the queue's injectable clock therefore use the same explicit instant.
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(epoch);
    jobs = createFactJobs({}, undefined, { now: () => Date.now() }) as Queue;
    bindings.service.mockReset().mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/health') return { capabilities: { factBackend: 'rules', factConfigured: true } };
      if (path === '/fact-jobs' && init?.method === 'POST') {
        submission = JSON.parse(String(init.body));
        return jobs.submit(submission);
      }
      const id = path.slice('/fact-jobs/'.length);
      if (init?.method === 'DELETE') { await jobs.cancel(id); return { ok: true }; }
      const result = jobs.get(id);
      if (!result) throw Object.assign(new Error('Synthetic HTTP 404: job not found or expired'), { status: 404 });
      return result;
    });
  }, 30_000);
  afterEach(async () => {
    await jobs?.close(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); await mf?.dispose();
  }, 20_000);

  for (const [label, elapsed] of [['six minutes', 6 * minute], ['30 minutes 59.999 seconds', 31 * minute - 1]] as const) {
    it(`recovers the original ready result after ${label} and commits it only once`, async () => {
      const started = await start();
      const raw = readyRaw();
      bindings.service.mockClear(); vi.setSystemTime(epoch + elapsed);
      const recovered = await read();
      singleImport(recovered.state, raw);
      expect.soft(recovered.revision).toBe(started.revision + 1);
      expect.soft(recovered.canCalculate).toBe(false);
      const afterFirst = await stored();
      for (let count = 0; count < 2; count++) singleImport((await read()).state, raw);
      expect.soft(await stored()).toEqual(afterFirst);
      expect.soft(deletes()).toHaveLength(1);
      expect.soft(polls()).toHaveLength(1);
      expect.soft(jobs.get(submission.jobId)).toBeNull();
      expect(() => jobs.submit(submission)).toThrowError(expect.objectContaining({ status: 410 }));
    });
  }

  it('converges two returning readers near the deadline to one raw import and one D1 write', async () => {
    const started = await start(); const raw = readyRaw();
    bindings.service.mockClear(); vi.setSystemTime(epoch + 31 * minute - 1);
    const returning = await Promise.all([read(), read()]);
    for (const result of returning) {
      singleImport(result.state, raw);
      expect.soft(result.revision).toBe(started.revision + 1);
    }
    const saved = await stored();
    singleImport(saved.state, raw);
    expect.soft(saved.revision).toBe(started.revision + 1);
    expect.soft(deletes()).toHaveLength(1);
  });

  for (const [label, elapsed] of [['exactly 31 minutes', 31 * minute], ['past 31 minutes', 31 * minute + 1]] as const) {
    it(`fails closed ${label} before polling and cancels the owned task`, async () => {
      const started = await start(); readyRaw();
      bindings.service.mockClear(); vi.setSystemTime(epoch + elapsed);
      const expired = await read();
      expect(expired.state.job).toMatchObject({ id: started.state.job!.id, status: 'failed', error: expect.stringContaining('最长等待时间') });
      expect(expired.state.materials).toEqual([]);
      expect(expired.state.history.filter(item => item.type === 'candidates_extracted')).toEqual([]);
      expect(expired.canCalculate).toBe(false);
      expect(polls()).toEqual([]);
      expect(deletes()).toHaveLength(1);
      expect(jobs.get(submission.jobId)).toBeNull();
      const expiredRow = await stored(); await read();
      expect(await stored()).toEqual(expiredRow);
      expect(deletes()).toHaveLength(1);
      expect(() => jobs.submit(submission)).toThrowError(expect.objectContaining({ status: 410 }));
    });
  }

  it('allows an explicit exclusion after six minutes to cancel retained output without importing it', async () => {
    const started = await start();
    bindings.service.mockClear(); vi.setSystemTime(epoch + 6 * minute);
    const response = await act(started, { action: 'exclude_source', evidenceId: 'source-1', reason: '合成取消测试：此材料不属于本次工资范围。' });
    expect(response.status).toBe(200);
    const cancelled = await response.json() as MaterialFactsResponse;
    expect(cancelled.state.job).toBeNull();
    expect(cancelled.state.materials).toEqual([expect.objectContaining({ status: 'excluded', raw: null, candidates: [] })]);
    expect(cancelled.state.history.filter(item => item.type === 'candidates_extracted')).toEqual([]);
    expect(polls()).toEqual([]);
    expect(deletes()).toHaveLength(1);
    expect(jobs.get(submission.jobId)).toBeNull();
    expect(() => jobs.submit(submission)).toThrowError(expect.objectContaining({ status: 410 }));
    const cancelledRow = await stored(); await read();
    expect(await stored()).toEqual(cancelledRow);
  });

  it('keeps an earlier cancellation effective when the inactive page returns at six minutes', async () => {
    const started = await start(); vi.setSystemTime(epoch + 2 * minute);
    const response = await act(started, { action: 'exclude_source', evidenceId: 'source-1', reason: '合成取消测试：保留原文件但排除本次提取。' });
    expect(response.status).toBe(200);
    const cancelledRow = await stored();
    bindings.service.mockClear(); vi.setSystemTime(epoch + 6 * minute);
    const returned = await read();
    expect(returned.state.job).toBeNull();
    expect(returned.state.materials.every(material => material.raw === null)).toBe(true);
    expect(returned.state.history.filter(item => item.type === 'candidates_extracted')).toEqual([]);
    expect(await stored()).toEqual(cancelledRow);
    expect(polls()).toEqual([]);
    expect(deletes()).toEqual([]);
    expect(() => jobs.submit(submission)).toThrowError(expect.objectContaining({ status: 410 }));
  });
});
