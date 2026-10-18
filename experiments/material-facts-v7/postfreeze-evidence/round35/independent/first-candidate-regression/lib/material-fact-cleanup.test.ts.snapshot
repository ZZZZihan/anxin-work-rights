// Disposable D1 and real case routes; all job replies and private text are fixtures.
import { readFileSync, readdirSync } from 'node:fs';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bindings = vi.hoisted(() => ({ DB: undefined as unknown as D1Database, service: vi.fn() }));
vi.mock('cloudflare:workers', () => ({ env: bindings }));
vi.mock('./material-service-client', () => ({ callMaterialService: bindings.service, materialServiceConfigured: () => false }));
import { PATCH } from '../app/api/cases/route';
import { GET as readFacts, POST as actOnFacts } from '../app/api/cases/[id]/facts/route';
import { enqueueMaterialFactCleanup, retryMaterialFactCleanup } from './material-fact-cleanup';
import { materialFactCleanupMigration, materialFactCleanupSchemaStatements } from './material-fact-cleanup-schema';
import type { MaterialFactsResponse } from './material-fact-types';

let miniflare: Miniflare;
const headers = (owner: string) => ({ 'oai-authenticated-user-id': owner, 'oai-authenticated-user-email': `${owner}@synthetic.test` });
const patch = (body: object, owner = 'owner') => PATCH(new Request('http://127.0.0.1/api/cases', {
  method: 'PATCH', headers: headers(owner), body: JSON.stringify({ id: 'cleanup-case', ...body }),
}));
const cancellations = () => bindings.service.mock.calls.filter(([, init]) => init?.method === 'DELETE');
const queued = () => bindings.DB.prepare('SELECT user_id,case_id,job_id FROM case_material_fact_cleanup ORDER BY job_id').all();

async function applyMigration(name: string) {
  const sql = readFileSync(new URL(`../drizzle/${name}`, import.meta.url), 'utf8').split('--> statement-breakpoint');
  await bindings.DB.batch(sql.filter(statement => statement.trim()).map(statement => bindings.DB.prepare(statement)));
}

async function seedJob(jobId = 'cleanup-job') {
  await bindings.DB.prepare(`INSERT INTO case_material_facts(case_id,user_id,revision,state_json,updated_at)
    VALUES ('cleanup-case','owner',1,?,'2026-10-17')`).bind(JSON.stringify({
    job: { id: jobId }, materials: [{ raw: 'synthetic private material must disappear' }],
  })).run();
}

describe('durable cancellation after case fact invalidation', () => {
  beforeEach(async () => {
    vi.stubEnv('NODE_ENV', 'production');
    bindings.service.mockReset().mockResolvedValue({ ok: true });
    miniflare = new Miniflare(convertV4MiniflareOptions({
      modules: true, script: 'export default { fetch() { return new Response("synthetic cleanup test"); } };',
      compatibilityDate: '2026-09-11', d1Databases: ['DB'],
    }));
    bindings.DB = await miniflare.getD1Database('DB') as unknown as D1Database;
    for (const name of readdirSync(new URL('../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) await applyMigration(name);
    await bindings.DB.prepare(`INSERT INTO cases(id,user_id,type,company,status,next_action,created_at,updated_at)
      VALUES ('cleanup-case','owner','欠薪争议','合成单位','collecting','整理材料','2026-10-17','2026-10-17')`).run();
    await seedJob();
  }, 30_000);
  afterEach(async () => { await miniflare?.dispose(); vi.unstubAllEnvs(); }, 20_000);

  it('retries a timed-out cancellation on the next owned case request after the fact row is gone', async () => {
    bindings.service.mockRejectedValueOnce(new DOMException('synthetic DELETE timeout', 'TimeoutError'));
    const first = await patch({ company: '另一合成单位' });
    expect(first.status).toBe(200);
    expect((await first.json() as { processingCleanupPending: boolean }).processingCleanupPending).toBe(true);
    expect(await bindings.DB.prepare('SELECT state_json FROM case_material_facts').first()).toBeNull();
    expect((await queued()).results).toEqual([{ user_id: 'owner', case_id: 'cleanup-case', job_id: 'cleanup-job' }]);
    const columns = (await bindings.DB.prepare('PRAGMA table_info(case_material_fact_cleanup)').all<{ name: string }>()).results;
    expect(columns.map(row => row.name)).toEqual(['user_id', 'case_id', 'job_id', 'queued_at']);
    expect(cancellations()).toHaveLength(1);
    const retry = await patch({ company: '另一合成单位' });
    expect(retry.status).toBe(200);
    expect((await retry.json() as { processingCleanupPending: boolean }).processingCleanupPending).toBe(false);
    expect(cancellations()).toHaveLength(2);
    expect(cancellations()[1]).toEqual(['/fact-jobs/cleanup-job', { method: 'DELETE' }]);
    expect((await queued()).results).toEqual([]);
    expect(await bindings.DB.prepare('SELECT state_json FROM case_material_facts').first()).toBeNull();
    const context = { params: Promise.resolve({ id: 'cleanup-case' }) };
    const current = await readFacts(new Request('http://127.0.0.1/api/cases/cleanup-case/facts', { headers: headers('owner') }), context);
    const latest = await current.json() as MaterialFactsResponse;
    expect(current.status).toBe(200);
    expect(latest.state.job).toBeNull();
    expect(latest.candidates).toEqual([]);
    expect(JSON.stringify(latest)).not.toContain('synthetic private material');
    expect((await actOnFacts(new Request('http://127.0.0.1/api/cases/cleanup-case/facts', {
      method: 'POST', headers: headers('owner'), body: JSON.stringify({ revision: 1, generation: 1, action: 'calculate' }),
    }), context)).status).toBe(409);
  });

  it('preserves active work for a company/status no-op and an ordinary case step change', async () => {
    expect((await patch({ company: '合成单位', status: 'collecting' })).status).toBe(200);
    expect((await patch({ currentStep: 1 })).status).toBe(200);
    expect(cancellations()).toEqual([]);
    expect((await queued()).results).toEqual([]);
    expect(await bindings.DB.prepare('SELECT state_json FROM case_material_facts').first()).not.toBeNull();
  });

  it('does not invalidate or cancel another owner case', async () => {
    expect((await patch({ company: '无权修改' }, 'intruder')).status).toBe(404);
    expect(cancellations()).toEqual([]);
    expect(await bindings.DB.prepare('SELECT company FROM cases').first()).toEqual({ company: '合成单位' });
    expect(await bindings.DB.prepare('SELECT state_json FROM case_material_facts').first()).not.toBeNull();
  });

  it('does not drain another owner or another case even when this request has a pending job', async () => {
    bindings.service.mockRejectedValue(new Error('synthetic unavailable'));
    await patch({ company: '另一合成单位' });
    await enqueueMaterialFactCleanup('different-owner', 'cleanup-case', 'foreign-owner-job');
    await enqueueMaterialFactCleanup('owner', 'different-case', 'foreign-case-job');
    bindings.service.mockClear().mockResolvedValue({ ok: true });
    expect((await patch({ nextAction: '无权重试' }, 'intruder')).status).toBe(404);
    expect(cancellations()).toEqual([]);
    expect((await patch({ nextAction: '仅重试本人案件' })).status).toBe(200);
    expect(cancellations().map(([path]) => path)).toEqual(['/fact-jobs/cleanup-job']);
    expect((await queued()).results.map(row => row.job_id)).toEqual(['foreign-case-job', 'foreign-owner-job']);
  });

  it('journals replacements but a pending old job cannot cancel the newer active job', async () => {
    await bindings.DB.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=?')
      .bind(JSON.stringify({ job: { id: 'new-active-job' } }), 'cleanup-case').run();
    expect((await queued()).results.map(row => row.job_id)).toEqual(['cleanup-job']);
    await bindings.DB.prepare('UPDATE case_material_facts SET state_json=? WHERE case_id=?')
      .bind(JSON.stringify({ job: { id: 'new-active-job', status: 'running' } }), 'cleanup-case').run();
    expect(await retryMaterialFactCleanup('owner', 'cleanup-case')).toBe(false);
    expect(cancellations().map(([path]) => path)).toEqual(['/fact-jobs/cleanup-job']);
    expect(await bindings.DB.prepare('SELECT state_json FROM case_material_facts').first()).toEqual({ state_json: JSON.stringify({ job: { id: 'new-active-job', status: 'running' } }) });
  });

  it('rolls back the journal with an aborted fact invalidation transaction', async () => {
    const previous = await bindings.DB.prepare('SELECT state_json FROM case_material_facts').first();
    await expect(bindings.DB.batch([
      bindings.DB.prepare("UPDATE cases SET company='事务内失效' WHERE id='cleanup-case' AND user_id='owner'"),
      bindings.DB.prepare('INSERT INTO missing_cleanup_test_table VALUES (1)'),
    ])).rejects.toThrow();
    expect(await bindings.DB.prepare('SELECT state_json FROM case_material_facts').first()).toEqual(previous);
    expect((await queued()).results).toEqual([]);
    expect(await bindings.DB.prepare('SELECT company FROM cases').first()).toEqual({ company: '合成单位' });
  });

  it('bounds retries and stops at the first unavailable service without dropping any queued IDs', async () => {
    for (let index = 0; index < 8; index++) await enqueueMaterialFactCleanup('owner', 'cleanup-case', `pending-${index}`);
    bindings.service.mockRejectedValue(new Error('synthetic cancellation unavailable'));
    expect(await retryMaterialFactCleanup('owner', 'cleanup-case')).toBe(true);
    expect(cancellations()).toHaveLength(1);
    expect((await queued()).results).toHaveLength(8);
    bindings.service.mockClear().mockResolvedValue({ ok: true });
    expect(await retryMaterialFactCleanup('owner', 'cleanup-case')).toBe(true);
    expect(cancellations()).toHaveLength(5);
    expect((await queued()).results).toHaveLength(3);
    expect(await retryMaterialFactCleanup('owner', 'cleanup-case')).toBe(false);
    expect(cancellations()).toHaveLength(8);
  });

  it('ignores local starting claims and invalid IDs while deletion still clears malformed old state', async () => {
    await bindings.DB.prepare('DELETE FROM case_material_facts').run();
    await bindings.DB.prepare('DELETE FROM case_material_fact_cleanup').run();
    for (const jobId of ['starting_1_fixture', '../bad-id', '', 'x'.repeat(101)]) {
      await seedJob(jobId);
      await bindings.DB.prepare('DELETE FROM case_material_facts').run();
      await enqueueMaterialFactCleanup('owner', 'cleanup-case', jobId);
    }
    await bindings.DB.prepare(`INSERT INTO case_material_facts(case_id,user_id,revision,state_json,updated_at)
      VALUES ('cleanup-case','owner',1,'invalid-json','2026-10-17')`).run();
    expect((await patch({ company: '新合成单位' })).status).toBe(200);
    expect((await queued()).results).toEqual([]);
    expect(cancellations()).toEqual([]);
  });

  it('uses identical local and explicit migration statements and upgrades the old 0004 schema safely', async () => {
    const explicit = readFileSync(new URL(`../drizzle/${materialFactCleanupMigration}`, import.meta.url), 'utf8')
      .split('--> statement-breakpoint').map(sql => sql.trim().replace(/;$/, ''));
    expect(explicit).toEqual(materialFactCleanupSchemaStatements.map(sql => sql.trim()));
    await bindings.DB.prepare('DROP TRIGGER facts_cleanup_delete').run();
    await bindings.DB.prepare('DROP TRIGGER facts_cleanup_replace').run();
    await bindings.DB.prepare('DROP TABLE case_material_fact_cleanup').run();
    vi.stubEnv('NODE_ENV', 'development');
    const { ensureSchema } = await import('./server');
    await ensureSchema();
    expect(await bindings.DB.prepare('SELECT state_json FROM case_material_facts').first()).not.toBeNull();
    const journal = await bindings.DB.prepare('SELECT name FROM d1_migrations WHERE name=?').bind(materialFactCleanupMigration).first();
    expect(journal).toEqual({ name: materialFactCleanupMigration });
    expect((await patch({ status: 'archived' })).status).toBe(200);
    expect(cancellations()).toHaveLength(1);
    expect((await queued()).results).toEqual([]);
    await applyMigration(materialFactCleanupMigration);
    expect(await bindings.DB.prepare('SELECT company FROM cases').first()).toEqual({ company: '合成单位' });
  });
});
