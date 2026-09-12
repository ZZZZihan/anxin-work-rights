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

let schemaPromise: Promise<void> | null = null;

const schemaStatements = [
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
    uploaded_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS evidence_user_idx ON evidence_files (user_id)',
  'CREATE INDEX IF NOT EXISTS evidence_case_idx ON evidence_files (case_id)',
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
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS documents_user_idx ON document_drafts (user_id)',
  'CREATE INDEX IF NOT EXISTS documents_case_idx ON document_drafts (case_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS documents_owner_case_type_idx ON document_drafts (user_id, case_id, type)',
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
  // previews do not run the hosting migration lifecycle, so they bootstrap a
  // disposable Miniflare database here for developer convenience only.
  if (process.env.NODE_ENV === 'production') return;

  if (!schemaPromise) {
    schemaPromise = getDatabase()
      .batch(schemaStatements.map((statement) => getDatabase().prepare(statement)))
      .then(() => undefined)
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }
  return schemaPromise;
}

export async function ensureUserSeed(user: RequestUser): Promise<void> {
  await ensureSchema();
  const db = getDatabase();
  const now = new Date().toISOString();
  const profileInsert = await db
    .prepare(
      'INSERT OR IGNORE INTO profiles (user_id, display_name, email, seeded_at) VALUES (?, ?, ?, ?)',
    )
    .bind(user.userId, user.displayName, user.email, now)
    .run();

  if ((profileInsert.meta.changes ?? 0) === 0) {
    await db
      .prepare('UPDATE profiles SET display_name = ?, email = ? WHERE user_id = ?')
      .bind(user.displayName, user.email, user.userId)
      .run();
    return;
  }

  const wageCaseId = crypto.randomUUID();
  const terminationCaseId = crypto.randomUUID();
  const injuryCaseId = crypto.randomUUID();
  const insertCase = db.prepare(
    `INSERT INTO cases
      (id, user_id, type, company, amount, status, current_step, next_action, deadline, location, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertEvidence = db.prepare(
    `INSERT INTO evidence_files
      (id, user_id, case_id, name, category, size, mime_type, status, note, object_key, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  await db.batch([
    insertCase.bind(
      wageCaseId,
      user.userId,
      '欠薪争议',
      '华信电子有限公司',
      12480,
      'collecting',
      1,
      '补齐 3 月考勤与工资流水',
      '2026-09-02',
      '江苏省南京市',
      '3 月至 4 月工资及部分加班费尚未结清。',
      now,
      now,
    ),
    insertCase.bind(
      terminationCaseId,
      user.userId,
      '解除劳动合同',
      '星河餐饮管理有限公司',
      18000,
      'negotiating',
      2,
      '书面确认解除日期与理由',
      '2026-09-08',
      '江苏省苏州市',
      '门店负责人通过口头方式通知不再排班，尚未收到书面解除材料。',
      now,
      now,
    ),
    insertCase.bind(
      injuryCaseId,
      user.userId,
      '工伤认定',
      '宏远物流有限公司',
      0,
      'collecting',
      1,
      '向单位索要事故报告并核对申请进度',
      '2026-09-18',
      '安徽省合肥市',
      '装卸作业中受伤，已就医，正在整理认定材料。',
      now,
      now,
    ),
    insertEvidence.bind(
      crypto.randomUUID(),
      user.userId,
      wageCaseId,
      '劳动合同（示例记录）.pdf',
      '劳动关系',
      0,
      'application/pdf',
      'example',
      '示例记录，不含真实文件；可删除后上传自己的材料。',
      null,
      now,
    ),
    insertEvidence.bind(
      crypto.randomUUID(),
      user.userId,
      wageCaseId,
      '工资流水（示例记录）.pdf',
      '工资支付',
      0,
      'application/pdf',
      'example',
      '示例记录，不含真实文件；建议保留银行流水原件。',
      null,
      now,
    ),
    insertEvidence.bind(
      crypto.randomUUID(),
      user.userId,
      terminationCaseId,
      '解除通知聊天记录（示例记录）.png',
      '解除经过',
      0,
      'image/png',
      'example',
      '示例记录，不含真实文件；真实上传请保留完整上下文。',
      null,
      now,
    ),
  ]);
}

export async function loadBootstrap(user: RequestUser): Promise<BootstrapData> {
  await ensureUserSeed(user);
  const db = getDatabase();
  const [caseRows, evidenceRows, messageRows, documentRows] = await Promise.all([
    db
      .prepare("SELECT * FROM cases WHERE user_id = ? AND status != 'archived' ORDER BY updated_at DESC")
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
    cases: caseRows.results.map(rowToCase),
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
    downloadable: Boolean(row.object_key),
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
