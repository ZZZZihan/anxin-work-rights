import { readFileSync, readdirSync } from 'node:fs';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentDraft } from './types';

const bindings = vi.hoisted(() => ({ DB: undefined as unknown as D1Database, FILES: undefined as unknown as R2Bucket }));
vi.mock('cloudflare:workers', () => ({ env: bindings }));

const migrations = readdirSync(new URL('../drizzle/', import.meta.url)).filter((name) => name.endsWith('.sql')).sort();
const user = { userId: 'schema-upgrade-synthetic', email: 'upgrade@synthetic.test', displayName: '合成升级账户' };
let miniflare: Miniflare;

async function applyMigration(name: string) {
  const statements = readFileSync(new URL(`../drizzle/${name}`, import.meta.url), 'utf8').split('--> statement-breakpoint');
  await bindings.DB.batch(statements.filter((sql) => sql.trim()).map((sql) => bindings.DB.prepare(sql)));
}

async function seedLegacy() {
  await applyMigration(migrations[0]);
  await bindings.DB.batch([
    bindings.DB.prepare(`INSERT INTO cases (id,user_id,type,company,status,next_action,created_at,updated_at)
      VALUES ('legacy-case',?,'欠薪争议','升级保留单位','collecting','整理材料','2026-10-08','2026-10-08')`).bind(user.userId),
    bindings.DB.prepare(`INSERT INTO document_drafts (id,user_id,case_id,type,fields_json,updated_at)
      VALUES ('legacy-draft',?,'legacy-case','fact-timeline','{"title":"升级前文字"}','2026-10-08')`).bind(user.userId),
    bindings.DB.prepare(`INSERT INTO evidence_files (id,user_id,case_id,name,category,mime_type,status,object_key,uploaded_at)
      VALUES ('legacy-evidence',?,'legacy-case','旧证据.txt','其他','text/plain','uploaded','legacy-object','2026-10-08')`).bind(user.userId),
  ]);
  await bindings.FILES.put('legacy-object', '升级前原始文件');
}

async function explicitMigrationAfterStartup() {
  // Same name-based journal contract used by Wrangler's migration command.
  const applied = (await bindings.DB.prepare('SELECT name FROM d1_migrations').all<{ name: string }>()).results;
  for (const name of migrations.filter((name) => !applied.some((row) => row.name === name))) await applyMigration(name);
  expect(applied.map((row) => row.name).sort()).toEqual(migrations);
}

describe('persisted local schema upgrades', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'development');
    miniflare = new Miniflare(convertV4MiniflareOptions({
      modules: true, script: 'export default { fetch() { return new Response("synthetic schema test"); } };',
      compatibilityDate: '2026-09-11', d1Databases: ['DB'], r2Buckets: ['FILES'],
    }));
    bindings.DB = await miniflare.getD1Database('DB') as unknown as D1Database;
    bindings.FILES = await miniflare.getR2Bucket('FILES') as unknown as R2Bucket;
  }, 30_000);
  afterEach(async () => { await miniflare?.dispose(); vi.unstubAllEnvs(); }, 20_000);

  it('upgrades a journal-free old database without losing drafts, records or file bytes', async () => {
    await seedLegacy();
    const server = await import('./server');
    await Promise.all([server.ensureSchema(), server.ensureSchema()]);
    const initial = await server.loadBootstrap(user);
    expect(initial.cases[0].company).toBe('升级保留单位');
    expect(initial.documents[0]).toMatchObject({ id: 'legacy-draft', revision: 1, fields: { title: '升级前文字' } });
    expect(initial.evidence[0]).toMatchObject({ id: 'legacy-evidence', downloadable: true });
    expect(await (await bindings.FILES.get('legacy-object'))?.text()).toBe('升级前原始文件');

    const headers = { 'oai-authenticated-user-id': user.userId, 'oai-authenticated-user-email': user.email };
    const { PUT } = await import('../app/api/documents/route');
    const saved = await PUT(new Request('http://127.0.0.1/api/documents', {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseId: 'legacy-case', type: 'fact-timeline', revision: 1, fields: { title: '升级后文字' } }),
    }));
    expect(saved.status).toBe(200);
    expect((await saved.json() as { document: DocumentDraft }).document).toMatchObject({ id: 'legacy-draft', revision: 2 });
    const { POST } = await import('../app/api/evidence/route');
    const form = new FormData(); form.append('caseId', 'legacy-case');
    form.append('file', new File(['升级后文件'], 'new.txt', { type: 'text/plain' }));
    expect((await POST(new Request('http://127.0.0.1/api/evidence', { method: 'POST', headers, body: form }))).status).toBe(201);

    vi.resetModules();
    const restarted = await import('./server');
    await restarted.ensureSchema();
    await explicitMigrationAfterStartup();
    expect((await restarted.loadBootstrap(user)).documents[0].revision).toBe(2);
    expect((await restarted.loadBootstrap(user)).evidence).toHaveLength(2);
  });

  it('adopts a fresh runtime-created database so later explicit migrations are harmless', async () => {
    await (await import('./server')).ensureSchema();
    await explicitMigrationAfterStartup();
    vi.resetModules();
    await (await import('./server')).ensureSchema();
    await explicitMigrationAfterStartup();
    const columns = (await bindings.DB.prepare('PRAGMA table_info(document_drafts)').all<{ name: string }>()).results;
    expect(columns.filter((column) => column.name === 'revision')).toHaveLength(1);
  });

  it('finishes a partial upgrade and preserves existing revisions and journal entries', async () => {
    await seedLegacy();
    await bindings.DB.prepare('ALTER TABLE document_drafts ADD COLUMN revision INTEGER DEFAULT 1 NOT NULL').run();
    await bindings.DB.prepare('UPDATE document_drafts SET revision = 7').run();
    await bindings.DB.prepare('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)').run();
    await bindings.DB.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(migrations[0]).run();
    await (await import('./server')).ensureSchema();
    await explicitMigrationAfterStartup();
    expect(await bindings.DB.prepare('SELECT revision FROM document_drafts').first()).toEqual({ revision: 7 });
    expect(await bindings.DB.prepare('SELECT content_hash FROM evidence_files').first()).toEqual({ content_hash: null });
  });

  it('leaves production schemas to explicit migrations and can reopen a migrated database locally', async () => {
    for (const name of migrations) await applyMigration(name);
    vi.stubEnv('NODE_ENV', 'production');
    await (await import('./server')).ensureSchema();
    expect(await bindings.DB.prepare("SELECT name FROM sqlite_master WHERE name = 'd1_migrations'").first()).toBeNull();
    vi.stubEnv('NODE_ENV', 'development');
    await (await import('./server')).ensureSchema();
    await explicitMigrationAfterStartup();
  });
});
