// Independent API review probes: isolated D1/R2, controlled service; no real model inference.
import { readFileSync, readdirSync } from 'node:fs';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { MaterialAnalysisResponse } from './material-types';

const bindings = vi.hoisted(() => ({ DB: undefined as unknown as D1Database, FILES: undefined as unknown as R2Bucket, service: vi.fn() }));
vi.mock('cloudflare:workers', () => ({ env: bindings }));
vi.mock('./material-service-client', () => ({ materialServiceConfigured: () => true, callMaterialService: bindings.service }));
import { GET, POST } from '../app/api/evidence/[id]/analysis/route';
import { POST as upload, DELETE as remove } from '../app/api/evidence/route';
import { applyFieldReview, validateMaterialResult } from './material-validation';

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

describe('independent material lifecycle review regressions', () => {
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

  it('independent: cancellation captures a job attached before deletion transaction starts', async () => {
    const id = await seedFile();
    let releaseJob!: (value: unknown) => void;
    let enteredJob!: () => void;
    const submitted = new Promise<void>((resolve) => { enteredJob = resolve; });
    bindings.service.mockImplementationOnce(() => { enteredJob(); return new Promise((resolve) => { releaseJob = resolve; }); });
    const starting = start(id); await submitted;
    const originalDb = bindings.DB;
    let releaseDelete!: () => void;
    let enteredDelete!: () => void;
    const captured = new Promise<void>((resolve) => { enteredDelete = resolve; });
    const barrier = new Promise<void>((resolve) => { releaseDelete = resolve; });
    bindings.DB = {
      prepare: originalDb.prepare.bind(originalDb),
      async batch(statements: D1PreparedStatement[]) { enteredDelete(); await barrier; return originalDb.batch(statements); },
    } as unknown as D1Database;
    const deleting = remove(new Request(`http://127.0.0.1/api/evidence?id=${id}`, { method: 'DELETE', headers: headers() }));
    await captured;
    releaseJob({ jobId: 'lookup-window-job' });
    expect((await starting).status).toBe(202);
    releaseDelete();
    expect((await deleting).status).toBe(200);
    expect(await originalDb.prepare('SELECT * FROM evidence_analyses WHERE evidence_id=?').bind(id).first()).toBeNull();
    expect(bindings.service).toHaveBeenCalledWith('/jobs/lookup-window-job', { method: 'DELETE' });
  });

  it('independent: archival during submission cancels the late job and keeps analysis inaccessible', async () => {
    const id = await seedFile();
    let release!: (value: unknown) => void;
    let entered!: () => void;
    const submitted = new Promise<void>((resolve) => { entered = resolve; });
    bindings.service.mockImplementationOnce(() => { entered(); return new Promise((resolve) => { release = resolve; }); });
    const starting = start(id); await submitted;
    await bindings.DB.prepare("UPDATE cases SET status='archived' WHERE id='material-case'").run();
    release({ jobId: 'archived-job' });
    expect((await starting).status).toBe(404);
    expect(bindings.service).toHaveBeenCalledWith('/jobs/archived-job', { method: 'DELETE' });
    expect((await read(id)).status).toBe(404);
    expect((await bindings.DB.prepare('SELECT result_json FROM evidence_analyses WHERE evidence_id=?').bind(id).first<{ result_json: string | null }>())!.result_json).toBeNull();
  });

  it('independent: foreign deletion leaves owner records and original bytes intact', async () => {
    const id = await seedFile(); await ready(id); bindings.service.mockClear();
    const before = await bindings.DB.prepare('SELECT * FROM evidence_analyses WHERE evidence_id=?').bind(id).first();
    const original = await bindings.DB.prepare('SELECT object_key FROM evidence_files WHERE id=?').bind(id).first<{ object_key: string }>();
    expect((await remove(new Request(`http://127.0.0.1/api/evidence?id=${id}`, { method: 'DELETE', headers: headers('b') }))).status).toBe(404);
    expect(bindings.service).not.toHaveBeenCalled();
    expect(await bindings.DB.prepare('SELECT * FROM evidence_analyses WHERE evidence_id=?').bind(id).first()).toEqual(before);
    expect(await (await bindings.FILES.get(original!.object_key))!.text()).toContain('6000元');
  });

  it('independent: offline cache cleanup is reported while original and analysis deletion finish', async () => {
    const id = await seedFile(); await ready(id);
    const original = await bindings.DB.prepare('SELECT object_key FROM evidence_files WHERE id=?').bind(id).first<{ object_key: string }>();
    bindings.service.mockRejectedValueOnce(new Error('controlled offline cleanup'));
    const response = await remove(new Request(`http://127.0.0.1/api/evidence?id=${id}`, { method: 'DELETE', headers: headers() }));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true, processingCleanupPending: true });
    expect(await bindings.FILES.get(original!.object_key)).toBeNull();
    expect(await bindings.DB.prepare('SELECT * FROM evidence_analyses WHERE evidence_id=?').bind(id).first()).toBeNull();
    expect((await read(id)).status).toBe(404);
  });

  it('independent: maximum OCR and corrected fields stay within retrieval limit and preserve provenance', () => {
    const raw = syntheticResult();
    raw.blocks = Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, page: 1, text: Array.from({ length: 6 }, (_, j) => `${String(i*6+j).padStart(3, '0')}${'中'.repeat(297)}`).join('')+'中'.repeat(1200), bbox: null, confidence: null })) as unknown as typeof raw.blocks;
    raw.blocks.push({ id: 'tail', page: 1, text: '中'.repeat(1996)+'拖欠工资', bbox: null, confidence: null } as unknown as typeof raw.blocks[number]);
    raw.fields = Array.from({ length: 60 }, (_, i) => ({ key: 'management_statement', label: '不得信任模型标签', value: `${String(i).padStart(3, '0')}${'中'.repeat(297)}`, quote: `${String(i).padStart(3, '0')}${'中'.repeat(297)}`, blockIds: [`b${Math.floor(i/6)}`], origin: 'model' }));
    const validated = validateMaterialResult({ ...raw, knowledge: { hits: [{ title: '伪造法律来源' }] } }, source);
    expect(validated.fields).toHaveLength(60);
    expect(validated.knowledge.hits.length).toBeGreaterThan(0);
    expect(validated.knowledge.hits.some((hit) => hit.title === '伪造法律来源')).toBe(false);
    const revised = applyFieldReview(validated, validated.fields.map((field) => ({ id: field.id, value: '工资'.repeat(150), confirmed: true })));
    expect(revised.fields.every((field) => field.value.length === 300 && field.confirmed && field.review === 'corrected' && field.extractedValue !== field.value)).toBe(true);
    expect(revised.knowledge.hits.length).toBeGreaterThan(0);
    expect(revised.blocks).toEqual(validated.blocks);
    expect(revised.fields.map((field) => field.quote)).toEqual(validated.fields.map((field) => field.quote));
    raw.blocks.at(-1)!.text += '中';
    expect(() => validateMaterialResult(raw, source)).toThrow('过长');
    expect(() => applyFieldReview(validated, [{ id: validated.fields[0].id, value: '中'.repeat(301), confirmed: true }])).toThrow('文字');
  });
});
