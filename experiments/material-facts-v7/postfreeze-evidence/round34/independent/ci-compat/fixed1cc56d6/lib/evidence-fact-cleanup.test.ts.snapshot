// Real disposable D1/R2 and route handlers; only companion replies are fixtures.
import { readFileSync, readdirSync } from 'node:fs';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bindings = vi.hoisted(() => ({
  DB: undefined as unknown as D1Database,
  FILES: undefined as unknown as R2Bucket,
  service: vi.fn(),
}));
vi.mock('cloudflare:workers', () => ({ env: bindings }));
vi.mock('./material-service-client', () => ({ callMaterialService: bindings.service, materialServiceConfigured: () => false }));
import { DELETE } from '../app/api/evidence/route';
import { PATCH } from '../app/api/cases/route';

const activeJob = '11111111-1111-4111-8111-111111111111';
const newerJob = '22222222-2222-4222-8222-222222222222';
const headers = (owner = 'owner') => ({ 'oai-authenticated-user-id': owner, 'oai-authenticated-user-email': `${owner}@synthetic.test` });
const remove = (id = 'evidence', owner = 'owner') => DELETE(new Request(`http://127.0.0.1/api/evidence?id=${id}`, { method: 'DELETE', headers: headers(owner) }));
const retry = () => PATCH(new Request('http://127.0.0.1/api/cases', {
  method: 'PATCH', headers: headers(), body: JSON.stringify({ id: 'case', nextAction: '合成清理重试' }),
}));
const queued = async () => (await bindings.DB.prepare('SELECT user_id,case_id,job_id FROM case_material_fact_cleanup ORDER BY user_id,case_id,job_id').all()).results;
const evidence = () => bindings.DB.prepare("SELECT status FROM evidence_files WHERE id='evidence'").first();
const facts = () => bindings.DB.prepare("SELECT state_json FROM case_material_facts WHERE case_id='case'").first<{ state_json: string }>();
const cancellations = () => bindings.service.mock.calls.map(([path]) => path);
let miniflare: Miniflare;

async function seedFacts(job = activeJob) {
  await bindings.DB.prepare(`INSERT INTO case_material_facts(case_id,user_id,revision,state_json,updated_at)
    VALUES ('case','owner',1,?,'2026-10-18')`).bind(JSON.stringify({ job: { id: job }, materials: [] })).run();
}

describe('evidence deletion acknowledges its durable fact cancellation', () => {
  beforeEach(async () => {
    vi.stubEnv('NODE_ENV', 'production');
    bindings.service.mockReset().mockResolvedValue({ ok: true });
    miniflare = new Miniflare(convertV4MiniflareOptions({
      modules: true, script: 'export default { fetch() { return new Response("synthetic evidence cleanup"); } };',
      compatibilityDate: '2026-09-11', d1Databases: ['DB'], r2Buckets: ['FILES'],
    }));
    bindings.DB = await miniflare.getD1Database('DB') as unknown as D1Database;
    bindings.FILES = await miniflare.getR2Bucket('FILES') as unknown as R2Bucket;
    for (const name of readdirSync(new URL('../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
      const statements = readFileSync(new URL(`../drizzle/${name}`, import.meta.url), 'utf8').split('--> statement-breakpoint');
      await bindings.DB.batch(statements.filter(sql => sql.trim()).map(sql => bindings.DB.prepare(sql)));
    }
    await bindings.DB.prepare(`INSERT INTO cases(id,user_id,type,company,status,next_action,created_at,updated_at)
      VALUES ('case','owner','欠薪争议','合成单位','collecting','整理材料','2026-10-18','2026-10-18')`).run();
    await bindings.DB.prepare(`INSERT INTO evidence_files(id,user_id,case_id,name,category,size,mime_type,status,object_key,uploaded_at)
      VALUES ('evidence','owner','case','synthetic.txt','其他材料',9,'text/plain','uploaded','synthetic-object','2026-10-18')`).run();
    await bindings.FILES.put('synthetic-object', 'synthetic');
    await seedFacts();
  }, 30_000);
  afterEach(async () => { await miniflare?.dispose(); vi.unstubAllEnvs(); }, 20_000);

  it('removes the successful cancellation journal so a later offline case request has no false pending cleanup', async () => {
    const response = await remove();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, processingCleanupPending: false });
    expect(cancellations()).toEqual([`/fact-jobs/${activeJob}`]);
    expect(await queued()).toEqual([]);
    expect(await evidence()).toBeNull();
    expect(await facts()).toBeNull();
    expect(await bindings.FILES.get('synthetic-object')).toBeNull();
    bindings.service.mockRejectedValue(new Error('synthetic offline after successful deletion'));
    expect((await (await retry()).json() as { processingCleanupPending: boolean }).processingCleanupPending).toBe(false);
    expect(cancellations()).toHaveLength(1);
  });

  it('keeps a failed cancellation durable after the evidence is gone and retries it on an owned request', async () => {
    bindings.service.mockRejectedValueOnce(new Error('synthetic unavailable'));
    const response = await remove();
    expect(response.status).toBe(200);
    expect((await response.json() as { processingCleanupPending: boolean }).processingCleanupPending).toBe(true);
    expect(await queued()).toEqual([{ user_id: 'owner', case_id: 'case', job_id: activeJob }]);
    expect(await evidence()).toBeNull();
    expect(await bindings.FILES.get('synthetic-object')).toBeNull();
    expect((await (await retry()).json() as { processingCleanupPending: boolean }).processingCleanupPending).toBe(false);
    expect(await queued()).toEqual([]);
    expect(cancellations()).toEqual([`/fact-jobs/${activeJob}`, `/fact-jobs/${activeJob}`]);
  });

  it('acknowledges only the captured owner, case and job while preserving other queued tasks', async () => {
    for (const [owner, caseId, job] of [['other-owner', 'case', activeJob], ['owner', 'other-case', activeJob], ['owner', 'case', newerJob]]) {
      await bindings.DB.prepare('INSERT INTO case_material_fact_cleanup(user_id,case_id,job_id,queued_at) VALUES (?,?,?,?)')
        .bind(owner, caseId, job, '2026-10-18').run();
    }
    expect((await remove()).status).toBe(200);
    expect(await queued()).toEqual([
      { user_id: 'other-owner', case_id: 'case', job_id: activeJob },
      { user_id: 'owner', case_id: 'case', job_id: newerJob },
      { user_id: 'owner', case_id: 'other-case', job_id: activeJob },
    ]);
    expect(cancellations()).toEqual([`/fact-jobs/${activeJob}`]);
  });

  it('preserves a newer active job when the already deleted evidence is retried', async () => {
    expect((await remove()).status).toBe(200);
    await seedFacts(newerJob);
    const response = await remove();
    expect(response.status).toBe(200);
    expect((await response.json() as { processingCleanupPending: boolean }).processingCleanupPending).toBe(false);
    expect(JSON.parse((await facts())!.state_json).job.id).toBe(newerJob);
    expect(cancellations()).toEqual([`/fact-jobs/${activeJob}`]);
    expect(await queued()).toEqual([]);
  });

  it('does not cancel or change facts for a missing or foreign evidence ID', async () => {
    expect((await remove('missing')).status).toBe(404);
    expect((await remove('evidence', 'intruder')).status).toBe(404);
    expect(await evidence()).toEqual({ status: 'uploaded' });
    expect(JSON.parse((await facts())!.state_json).job.id).toBe(activeJob);
    expect(await bindings.FILES.get('synthetic-object')).not.toBeNull();
    expect(cancellations()).toEqual([]);
    expect(await queued()).toEqual([]);
  });

  it('makes no external cancellation when the deleting transaction rolls back', async () => {
    await bindings.DB.prepare(`CREATE TRIGGER synthetic_abort_evidence_delete BEFORE DELETE ON evidence_analyses
      BEGIN SELECT RAISE(ABORT,'synthetic evidence transaction failure'); END`).run();
    // A row ensures the final statement fires after the evidence status trigger.
    await bindings.DB.prepare(`INSERT INTO evidence_analyses(evidence_id,user_id,content_hash,document_kind,run_id,job_id,status,revision,started_at,updated_at)
      VALUES ('evidence','owner','synthetic-hash','other','synthetic-run','synthetic-analysis','running',1,'2026-10-18','2026-10-18')`).run();
    const previous = await facts();
    expect((await remove()).status).toBe(503);
    expect(await facts()).toEqual(previous);
    expect(await evidence()).toEqual({ status: 'uploaded' });
    expect(await queued()).toEqual([]);
    expect(await bindings.FILES.get('synthetic-object')).not.toBeNull();
    expect(cancellations()).toEqual([]);
    expect(await bindings.DB.prepare('SELECT id FROM evidence_upload_cancellations').first()).toBeNull();
  });

  it('reports pending and retains the journal when the remote deletion succeeds but its acknowledgement fails', async () => {
    await bindings.DB.prepare(`CREATE TRIGGER synthetic_abort_cleanup_ack BEFORE DELETE ON case_material_fact_cleanup
      BEGIN SELECT RAISE(ABORT,'synthetic acknowledgement failure'); END`).run();
    const response = await remove();
    expect(response.status).toBe(200);
    expect((await response.json() as { processingCleanupPending: boolean }).processingCleanupPending).toBe(true);
    expect(await queued()).toEqual([{ user_id: 'owner', case_id: 'case', job_id: activeJob }]);
    expect(await evidence()).toBeNull();
    expect(cancellations()).toEqual([`/fact-jobs/${activeJob}`]);
    await bindings.DB.prepare('DROP TRIGGER synthetic_abort_cleanup_ack').run();
    expect((await (await retry()).json() as { processingCleanupPending: boolean }).processingCleanupPending).toBe(false);
    expect(await queued()).toEqual([]);
    expect(cancellations()).toEqual([`/fact-jobs/${activeJob}`, `/fact-jobs/${activeJob}`]);
  });
});
