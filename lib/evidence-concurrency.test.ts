import { readFileSync } from 'node:fs';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const bindings = vi.hoisted(() => ({
  db: undefined as unknown as D1Database,
  bucket: undefined as unknown as R2Bucket,
}));

// The route uses real disposable D1/R2 bindings. Only the R2 call timing is
// controlled, so these tests deterministically cover otherwise rare races.
vi.mock('@/lib/server', () => ({
  getDatabase: () => bindings.db,
  getFilesBucket: () => bindings.bucket,
  ensureUserSeed: async () => undefined,
  cleanText: (value: unknown, length: number) => typeof value === 'string' ? value.trim().slice(0, length) : '',
  jsonError: (error: string, status = 400) => Response.json({ error }, { status }),
  rowToEvidence: (row: Record<string, unknown>) => ({ id: row.id, status: row.status }),
}));

import { DELETE, POST } from '../app/api/evidence/route';

const userId = 'evidence-concurrency-synthetic-user';
const caseId = crypto.randomUUID();
const payload = 'synthetic exact bytes\n'.repeat(25_000);
const headers = { 'oai-authenticated-user-id': userId, 'oai-authenticated-user-email': 'race@synthetic.test' };
let miniflare: Miniflare;
let bucket: R2Bucket;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function upload(id: string) {
  const form = new FormData();
  form.append('caseId', caseId);
  form.append('operationId', id);
  form.append('file', new File([payload], 'race.txt', { type: 'text/plain' }));
  return POST(new Request('http://127.0.0.1/api/evidence', { method: 'POST', headers, body: form }));
}

function remove(id: string) {
  return DELETE(new Request(`http://127.0.0.1/api/evidence?id=${id}`, { method: 'DELETE', headers }));
}

function wrapBucket(overrides: Partial<Pick<R2Bucket, 'put' | 'delete'>>) {
  bindings.bucket = {
    put: bucket.put.bind(bucket),
    delete: bucket.delete.bind(bucket),
    ...overrides,
  } as R2Bucket;
}

async function cancellation(id: string) {
  return bindings.db.prepare('SELECT * FROM evidence_upload_cancellations WHERE id = ?').bind(id)
    .first<{ id: string; user_id: string; object_key: string }>();
}

describe('evidence upload and cancellation interleavings', () => {
  beforeAll(async () => {
    miniflare = new Miniflare(convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response("disposable binding test"); } };',
      compatibilityDate: '2026-09-11',
      d1Databases: ['DB'],
      r2Buckets: ['FILES'],
    }));
    bindings.db = await miniflare.getD1Database('DB') as unknown as D1Database;
    bucket = await miniflare.getR2Bucket('FILES') as unknown as R2Bucket;
    for (const migration of ['0000_fresh_bill_hollister.sql', '0001_mighty_fantastic_four.sql', '0002_evidence_upload_cancellations.sql', '0003_material_analyses.sql']) {
      const statements = readFileSync(new URL(`../drizzle/${migration}`, import.meta.url), 'utf8').split('--> statement-breakpoint');
      await bindings.db.batch(statements.filter((statement) => statement.trim()).map((statement) => bindings.db.prepare(statement)));
    }
    await bindings.db.prepare(
      `INSERT INTO cases (id, user_id, type, company, status, next_action, created_at, updated_at)
       VALUES (?, ?, '欠薪争议', '合成竞态测试单位', 'collecting', '整理材料', ?, ?)`,
    ).bind(caseId, userId, new Date().toISOString(), new Date().toISOString()).run();
  }, 30_000);

  beforeEach(() => wrapBucket({}));
  afterAll(async () => { await miniflare?.dispose(); }, 20_000);

  it('keeps original bytes when identical concurrent requests finalize the same upload', async () => {
    const id = crypto.randomUUID();
    const bothPutsStarted = deferred();
    const release = deferred();
    let puts = 0;
    wrapBucket({ put: async (...args) => {
      if (++puts === 2) bothPutsStarted.resolve();
      await release.promise;
      return bucket.put(...args);
    } });
    const pending = [upload(id), upload(id)];
    await bothPutsStarted.promise;
    release.resolve();
    const responses = await Promise.all(pending);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    const row = await bindings.db.prepare('SELECT status, object_key FROM evidence_files WHERE id = ?').bind(id)
      .first<{ status: string; object_key: string }>();
    expect(row?.status).toBe('uploaded');
    expect(await (await bucket.get(row!.object_key))?.text()).toBe(payload);
    expect(await cancellation(id)).toBeNull();
  }, 15_000);

  it('cleans a put that completes after DELETE without recreating the cancelled UUID', async () => {
    const id = crypto.randomUUID();
    const started = deferred();
    const release = deferred();
    wrapBucket({ put: async (...args) => {
      started.resolve();
      await release.promise;
      return bucket.put(...args);
    } });
    const pending = upload(id);
    await started.promise;
    expect((await remove(id)).status).toBe(200);
    const cancelled = await cancellation(id);
    expect(cancelled?.user_id).toBe(userId);
    release.resolve();
    expect((await pending).status).toBe(409);
    expect(await bucket.get(cancelled!.object_key)).toBeNull();
    expect(await bindings.db.prepare('SELECT id FROM evidence_files WHERE id = ?').bind(id).first()).toBeNull();
    expect((await upload(id)).status).toBe(409);
    expect((await remove(id)).status).toBe(200);
  }, 15_000);

  it('retains the key for a DELETE retry when late-put cleanup fails', async () => {
    const id = crypto.randomUUID();
    const started = deferred();
    const release = deferred();
    let deletes = 0;
    wrapBucket({
      put: async (...args) => {
        started.resolve();
        await release.promise;
        return bucket.put(...args);
      },
      delete: async (...args) => {
        if (++deletes === 2) throw new Error('synthetic late cleanup failure');
        return bucket.delete(...args);
      },
    });
    const pending = upload(id);
    await started.promise;
    expect((await remove(id)).status).toBe(200);
    release.resolve();
    expect((await pending).status).toBe(503);
    const cancelled = await cancellation(id);
    expect(await (await bucket.get(cancelled!.object_key))?.text()).toBe(payload);
    expect((await upload(id)).status).toBe(409);
    wrapBucket({});
    expect((await remove(id)).status).toBe(200);
    expect(await bucket.get(cancelled!.object_key)).toBeNull();
    expect(await cancellation(id)).not.toBeNull();
  }, 15_000);

  it('rolls back cancellation if marking deletion fails and preserves the uploaded bytes', async () => {
    const id = crypto.randomUUID();
    expect((await upload(id)).status).toBe(201);
    const row = await bindings.db.prepare('SELECT object_key FROM evidence_files WHERE id = ?').bind(id)
      .first<{ object_key: string }>();
    await bindings.db.prepare(
      `CREATE TRIGGER synthetic_cancel_failure BEFORE UPDATE OF status ON evidence_files
       WHEN OLD.id = '${id}' AND NEW.status = 'deleting'
       BEGIN SELECT RAISE(ABORT, 'synthetic cancellation failure'); END;`,
    ).run();
    try {
      expect((await remove(id)).status).toBe(503);
      expect(await cancellation(id)).toBeNull();
      expect(await (await bucket.get(row!.object_key))?.text()).toBe(payload);
      expect((await upload(id)).status).toBe(200);
    } finally {
      await bindings.db.prepare('DROP TRIGGER synthetic_cancel_failure').run();
    }
  }, 15_000);
});
