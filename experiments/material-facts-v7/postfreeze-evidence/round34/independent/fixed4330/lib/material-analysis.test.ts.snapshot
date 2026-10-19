import { readFileSync, readdirSync } from 'node:fs';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { MaterialAnalysisResponse } from './material-types';

const bindings = vi.hoisted(() => ({ DB: undefined as unknown as D1Database, FILES: undefined as unknown as R2Bucket, service: vi.fn() }));
vi.mock('cloudflare:workers', () => ({ env: bindings }));
vi.mock('./material-service-client', () => ({ materialServiceConfigured: () => true, callMaterialService: bindings.service }));
import { GET, POST, PUT } from '../app/api/evidence/[id]/analysis/route';
import { POST as upload, DELETE as remove } from '../app/api/evidence/route';
import { validateMaterialResult } from './material-validation';

let mf: Miniflare;
const headers = (user = 'a') => ({ 'oai-authenticated-user-id': `material-${user}`, 'oai-authenticated-user-email': `${user}@synthetic.test` });
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (id: string, method = 'GET', body?: unknown, user = 'a') => new Request(`http://127.0.0.1/api/evidence/${id}/analysis`, { method, headers: headers(user), ...(body ? { body: JSON.stringify(body) } : {}) });
const syntheticResult = () => ({
  engine: { ocr: 'controlled_test_fixture', structuring: 'local_vision_model', model: 'controlled-test-model-not-real-inference' },
  pageCount: 1, blocks: [
    { id: 'p1_l1', page: 1, text: '单位：合成测试公司', bbox: [0.1, 0.1, 0.5, 0.1], confidence: 0.9 },
    { id: 'p1_l2', page: 1, text: '工资标准：每月6000元。公司拖欠工资。', bbox: [0.1, 0.3, 0.8, 0.1], confidence: 0.9 },
  ], fields: [{ key: 'wage_standard', label: '工资', value: '6000元', quote: '工资标准：每月6000元。公司拖欠工资。', blockIds: ['p1_l2'], origin: 'model' }], warnings: [],
});
const source = { evidenceId: 'synthetic', name: 'synthetic.png', sha256: 'a'.repeat(64), mimeType: 'image/png' };
async function seedFile(mime = 'text/plain') {
  const form = new FormData(); form.set('file', new File(['工资标准：每月6000元。公司拖欠工资。'], 'synthetic.txt', { type: mime })); form.set('caseId', 'material-case');
  const response = await upload(new Request('http://127.0.0.1/api/evidence', { method: 'POST', headers: headers(), body: form }));
  expect(response.status).toBe(201);
  return (await response.json() as { evidence: { id: string } }).evidence.id;
}
async function start(id: string, retry = false) {
  return POST(request(id, 'POST', { documentKind: 'contract', retry }), context(id));
}
async function read(id: string) { return GET(request(id), context(id)); }
async function ready(id: string) {
  await start(id);
  const response = await read(id);
  expect(response.status).toBe(200);
  return (await response.json() as MaterialAnalysisResponse).analysis!;
}

describe('material extraction boundaries and persisted ownership', () => {
  beforeEach(async () => {
    vi.stubEnv('NODE_ENV', 'production');
    bindings.service.mockReset().mockImplementation(async (path: string) => path === '/jobs' ? { jobId: 'test-job' } : { status: 'ready', result: syntheticResult() });
    mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("isolated material test"); } };', compatibilityDate: '2026-09-11', d1Databases: ['DB'], r2Buckets: ['FILES'] }));
    bindings.DB = await mf.getD1Database('DB') as unknown as D1Database;
    bindings.FILES = await mf.getR2Bucket('FILES') as unknown as R2Bucket;
    for (const name of readdirSync(new URL('../drizzle/', import.meta.url)).filter((name) => name.endsWith('.sql')).sort()) {
      const statements = readFileSync(new URL(`../drizzle/${name}`, import.meta.url), 'utf8').split('--> statement-breakpoint');
      await bindings.DB.batch(statements.filter((s) => s.trim()).map((s) => bindings.DB.prepare(s)));
    }
    await bindings.DB.prepare(`INSERT INTO cases (id,user_id,type,company,status,next_action,created_at,updated_at) VALUES ('material-case','material-a','欠薪','合成单位','collecting','整理材料','2026-10-13','2026-10-13')`).run();
  }, 30_000);
  afterEach(async () => { await mf?.dispose(); vi.unstubAllEnvs(); }, 20_000);

  it('uploads exact bytes, deduplicates starts, persists grounded fields and real public citations, and protects review revisions', async () => {
    const id = await seedFile();
    const responses = await Promise.all([start(id), start(id)]);
    expect(responses.every((r) => [200, 202].includes(r.status))).toBe(true);
    expect(bindings.service.mock.calls.filter(([path]) => path === '/jobs')).toHaveLength(1);
    const analysis = (await (await read(id)).json() as MaterialAnalysisResponse).analysis!;
    expect(analysis.status).toBe('ready');
    expect(analysis.result!.fields[0]).toMatchObject({ value: '6000元', quote: syntheticResult().blocks[1].text, review: 'pending' });
    expect(analysis.result!.knowledge.hits.some((hit) => hit.kind === 'case')).toBe(true);
    expect(analysis.result!.knowledge.hits.some((hit) => hit.kind === 'provision')).toBe(true);
    for (const hit of analysis.result!.knowledge.hits) expect(hit.citations.every((c) => c.text && c.paragraphId && c.sourceUrl.startsWith('https://'))).toBe(true);
    const body = { revision: analysis.revision, fields: [{ id: 'field-1', value: '6500元', confirmed: true }] };
    expect((await PUT(request(id, 'PUT', body), context(id))).status).toBe(200);
    expect((await PUT(request(id, 'PUT', body), context(id))).status).toBe(409);
    const saved = (await (await read(id)).json() as MaterialAnalysisResponse).analysis!;
    expect(saved.result!.fields[0]).toMatchObject({ value: '6500元', extractedValue: '6000元', review: 'corrected', confirmed: true, quote: syntheticResult().blocks[1].text });
    expect(saved.revision).toBe(analysis.revision + 1);
  });

  it('rejects cross-user reads, starts and edits without service calls or state changes', async () => {
    const id = await seedFile(); await ready(id); bindings.service.mockClear();
    const before = await bindings.DB.prepare('SELECT * FROM evidence_analyses WHERE evidence_id=?').bind(id).first();
    for (const [method, handler] of [['GET', GET], ['POST', POST], ['PUT', PUT]] as const) {
      const response = await handler(request(id, method, method === 'POST' ? { documentKind: 'contract' } : method === 'PUT' ? { revision: 1, fields: [] } : undefined, 'b'), context(id));
      expect(response.status).toBe(404);
    }
    expect(bindings.service).not.toHaveBeenCalled();
    expect(await bindings.DB.prepare('SELECT * FROM evidence_analyses WHERE evidence_id=?').bind(id).first()).toEqual(before);
    expect((await GET(new Request(`http://127.0.0.1/api/evidence/${id}/analysis`), context(id))).status).toBe(401);
  });

  it('preserves the original through service failure and recovers only through explicit retry', async () => {
    const id = await seedFile(); bindings.service.mockRejectedValueOnce(new Error('controlled offline failure'));
    const failed = (await (await start(id)).json() as MaterialAnalysisResponse).analysis!;
    expect(failed.status).toBe('failed');
    const original = await bindings.DB.prepare('SELECT object_key,status FROM evidence_files WHERE id=?').bind(id).first<{ object_key: string; status: string }>();
    expect(original!.status).toBe('uploaded'); expect(await (await bindings.FILES.get(original!.object_key))!.text()).toContain('6000元');
    await start(id); expect(bindings.service).toHaveBeenCalledTimes(1);
    expect((await start(id, true)).status).toBe(202);
    expect((await (await read(id)).json() as MaterialAnalysisResponse).analysis!.status).toBe('ready');
  });

  it('rejects changed original bytes before sending a job', async () => {
    const id = await seedFile();
    const original = await bindings.DB.prepare('SELECT object_key FROM evidence_files WHERE id=?').bind(id).first<{ object_key: string }>();
    await bindings.FILES.put(original!.object_key, 'changed');
    expect((await start(id)).status).toBe(409); expect(bindings.service).not.toHaveBeenCalled();
    expect(await bindings.DB.prepare('SELECT * FROM evidence_analyses WHERE evidence_id=?').bind(id).first()).toBeNull();
  });

  it('does not revive results when a file is deleted while the provider returns', async () => {
    const id = await seedFile(); await start(id);
    let release!: (value: unknown) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    bindings.service.mockImplementationOnce(() => { entered(); return new Promise((resolve) => { release = resolve; }); });
    const pending = read(id); await started;
    expect((await remove(new Request(`http://127.0.0.1/api/evidence?id=${id}`, { method: 'DELETE', headers: headers() }))).status).toBe(200);
    release({ status: 'ready', result: syntheticResult() });
    expect((await pending).status).toBe(404);
    expect(await bindings.DB.prepare('SELECT * FROM evidence_analyses WHERE evidence_id=?').bind(id).first()).toBeNull();
  });

  it('blocks archived case access and unsupported formats', async () => {
    const id = await seedFile('application/msword'); expect((await start(id)).status).toBe(415);
    await bindings.DB.prepare("UPDATE cases SET status='archived' WHERE id='material-case'").run();
    expect((await read(id)).status).toBe(404); expect((await start(id)).status).toBe(404);
    expect(bindings.service).not.toHaveBeenCalled();
  });

  it('cancels a job whose ID arrives only after the original was deleted', async () => {
    const id = await seedFile();
    let release!: (value: unknown) => void;
    let entered!: () => void;
    const submitted = new Promise<void>((resolve) => { entered = resolve; });
    bindings.service.mockImplementationOnce(() => { entered(); return new Promise((resolve) => { release = resolve; }); });
    const pending = start(id); await submitted;
    expect((await remove(new Request(`http://127.0.0.1/api/evidence?id=${id}`, { method: 'DELETE', headers: headers() }))).status).toBe(200);
    release({ jobId: 'late-job' });
    expect((await pending).status).toBe(404);
    expect(bindings.service).toHaveBeenCalledWith('/jobs/late-job', { method: 'DELETE' });
    expect(await bindings.DB.prepare('SELECT * FROM evidence_analyses WHERE evidence_id=?').bind(id).first()).toBeNull();
  });

  it('turns expired/unknown provider jobs into visible retryable failures', async () => {
    const id = await seedFile(); await start(id);
    bindings.service.mockResolvedValueOnce({ status: 'unexpected' });
    expect((await (await read(id)).json() as MaterialAnalysisResponse).analysis!.status).toBe('failed');
    await start(id, true);
    await bindings.DB.prepare('UPDATE evidence_analyses SET started_at=? WHERE evidence_id=?').bind('2000-01-01T00:00:00.000Z', id).run();
    const expired = (await (await read(id)).json() as MaterialAnalysisResponse).analysis!;
    expect(expired.status).toBe('failed'); expect(expired.error).toContain('超时');
  });

  it('drops invented values/references and rejects fake geometry instead of fabricating source support', () => {
    const raw = syntheticResult();
    raw.fields.push({ ...raw.fields[0], value: '90000元' }, { ...raw.fields[0], blockIds: ['invented'] });
    const validated = validateMaterialResult(raw, source);
    expect(validated.fields).toHaveLength(1); expect(validated.warnings.join('')).toContain('2 个候选字段');
    raw.blocks[0].bbox = [0.9, 0.1, 0.5, 0.2];
    expect(() => validateMaterialResult(raw, source)).toThrow('区域');
  });
});
