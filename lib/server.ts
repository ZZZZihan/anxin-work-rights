import { env } from 'cloudflare:workers';
import type {
  BootstrapData,
  ChatMessage,
  DocumentDraft,
  EvidenceFile,
  LegalSource,
  WorkCase,
} from './types';
import type { RequestUser } from './auth';
import { materialSchemaStatements } from './material-schema';
import { materialFactSchemaStatements } from './material-fact-schema';

let schemaPromise: Promise<void> | null = null;

const schemaStatements = [
  ...materialSchemaStatements,
  `CREATE TABLE IF NOT EXISTS profiles (
    user_id TEXT PRIMARY KEY NOT NULL,
    display_name TEXT NOT NULL,
    email TEXT NOT NULL,
    seeded_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS cases (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    company TEXT NOT NULL,
    amount INTEGER DEFAULT 0 NOT NULL,
    status TEXT NOT NULL,
    current_step INTEGER DEFAULT 0 NOT NULL,
    next_action TEXT NOT NULL,
    deadline TEXT,
    location TEXT DEFAULT '' NOT NULL,
    description TEXT DEFAULT '' NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS cases_user_idx ON cases (user_id)',
  `CREATE TABLE IF NOT EXISTS evidence_files (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    case_id TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    size INTEGER DEFAULT 0 NOT NULL,
    mime_type TEXT NOT NULL,
    status TEXT NOT NULL,
    note TEXT DEFAULT '' NOT NULL,
    object_key TEXT,
    content_hash TEXT,
    uploaded_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS evidence_user_idx ON evidence_files (user_id)',
  'CREATE INDEX IF NOT EXISTS evidence_case_idx ON evidence_files (case_id)',
  `CREATE TABLE IF NOT EXISTS evidence_upload_cancellations (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    object_key TEXT,
    cancelled_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    case_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    sources_json TEXT DEFAULT '[]' NOT NULL,
    created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS chat_user_idx ON chat_messages (user_id)',
  'CREATE INDEX IF NOT EXISTS chat_case_idx ON chat_messages (case_id)',
  `CREATE TABLE IF NOT EXISTS document_drafts (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    case_id TEXT NOT NULL,
    type TEXT NOT NULL,
    fields_json TEXT NOT NULL,
    revision INTEGER DEFAULT 1 NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS documents_user_idx ON document_drafts (user_id)',
  'CREATE INDEX IF NOT EXISTS documents_case_idx ON document_drafts (case_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS documents_owner_case_type_idx ON document_drafts (user_id, case_id, type)',
  ...materialFactSchemaStatements,
];

export function getDatabase(): D1Database {
  if (!env.DB) throw new Error('D1 binding DB is unavailable.');
  return env.DB;
}

export function getFilesBucket(): R2Bucket {
  if (!env.FILES) throw new Error('R2 binding FILES is unavailable.');
  return env.FILES;
}

export async function ensureSchema(): Promise<void> {
  // Production schema is owned by the checked-in Drizzle migrations. Local
  // previews preserve their Miniflare data across starts and need upgrades too.
  if (process.env.NODE_ENV === 'production') return;

  if (!schemaPromise) {
    schemaPromise = upgradeLocalSchema()
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }
  return schemaPromise;
}

async function upgradeLocalSchema(): Promise<void> {
  const db = getDatabase();
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)));
  for (const [table, column, definition] of [
    ['document_drafts', 'revision', 'INTEGER DEFAULT 1 NOT NULL'],
    ['evidence_files', 'content_hash', 'TEXT'],
  ]) {
    const hasColumn = async () => (await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>())
      .results.some((item) => item.name === column);
    if (await hasColumn()) continue;
    try {
      await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
    } catch (error) {
      // Another local worker may have upgraded the same persisted database.
      if (!(await hasColumn())) throw error;
    }
  }

  // Adopt only migrations whose complete schema is now present. This also
  // covers old runtime-created databases with no Wrangler migration journal.
  // Keep these names aligned with drizzle/ when adding a local schema upgrade.
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS d1_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    ...[
      '0000_fresh_bill_hollister.sql',
      '0001_mighty_fantastic_four.sql',
      '0002_evidence_upload_cancellations.sql',
      '0003_material_analyses.sql',
      '0004_material_facts.sql',
    ].map((name) => db.prepare('INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)').bind(name)),
  ]);
}

export async function ensureUserSeed(user: RequestUser): Promise<void> {
  await ensureSchema();
  await getDatabase().prepare(
    `INSERT INTO profiles (user_id, display_name, email, seeded_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET display_name = excluded.display_name, email = excluded.email`,
  ).bind(user.userId, user.displayName, user.email, new Date().toISOString()).run();
}

export async function loadBootstrap(user: RequestUser): Promise<BootstrapData> {
  await ensureUserSeed(user);
  const db = getDatabase();
  const [caseRows, evidenceRows, messageRows, documentRows] = await Promise.all([
    db
      .prepare('SELECT * FROM cases WHERE user_id = ? ORDER BY updated_at DESC')
      .bind(user.userId)
      .all<Record<string, unknown>>(),
    db
      .prepare('SELECT * FROM evidence_files WHERE user_id = ? ORDER BY uploaded_at DESC')
      .bind(user.userId)
      .all<Record<string, unknown>>(),
    db
      .prepare('SELECT * FROM chat_messages WHERE user_id = ? ORDER BY created_at ASC')
      .bind(user.userId)
      .all<Record<string, unknown>>(),
    db
      .prepare('SELECT * FROM document_drafts WHERE user_id = ? ORDER BY updated_at DESC')
      .bind(user.userId)
      .all<Record<string, unknown>>(),
  ]);

  return {
    user: {
      userId: user.userId,
      displayName: user.displayName,
      email: user.email,
    },
    cases: caseRows.results.filter((row) => row.status !== 'archived').map(rowToCase),
    archivedCases: caseRows.results.filter((row) => row.status === 'archived').map(rowToCase),
    evidence: evidenceRows.results.map(rowToEvidence),
    messages: messageRows.results.map(rowToMessage),
    documents: documentRows.results.map(rowToDocument),
  };
}

export function rowToCase(row: Record<string, unknown>): WorkCase {
  return {
    id: String(row.id),
    type: String(row.type),
    company: String(row.company),
    amount: Number(row.amount),
    status: String(row.status) as WorkCase['status'],
    currentStep: Number(row.current_step),
    nextAction: String(row.next_action),
    deadline: row.deadline ? String(row.deadline) : null,
    location: String(row.location ?? ''),
    description: String(row.description ?? ''),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function rowToEvidence(row: Record<string, unknown>): EvidenceFile {
  return {
    id: String(row.id),
    caseId: String(row.case_id),
    name: String(row.name),
    category: String(row.category),
    size: Number(row.size),
    mimeType: String(row.mime_type),
    status: String(row.status) as EvidenceFile['status'],
    note: String(row.note ?? ''),
    downloadable: Boolean(row.object_key) && ['uploaded', 'needs_review'].includes(String(row.status)),
    uploadedAt: String(row.uploaded_at),
  };
}

export function rowToMessage(row: Record<string, unknown>): ChatMessage {
  return {
    id: String(row.id),
    caseId: String(row.case_id),
    role: String(row.role) as ChatMessage['role'],
    content: String(row.content),
    sources: safeJson<LegalSource[]>(String(row.sources_json), []),
    createdAt: String(row.created_at),
  };
}

export function rowToDocument(row: Record<string, unknown>): DocumentDraft {
  return {
    id: String(row.id),
    caseId: String(row.case_id),
    type: String(row.type),
    fields: safeJson<Record<string, string>>(String(row.fields_json), {}),
    revision: Number(row.revision),
    updatedAt: String(row.updated_at),
  };
}

function safeJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function cleanText(value: unknown, maxLength = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}
