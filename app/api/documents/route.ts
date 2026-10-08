import { getRequestUser, unauthorized } from '@/lib/auth';
import { cleanText, ensureUserSeed, getDatabase, jsonError, rowToDocument } from '@/lib/server';

import { isRecord, templateFields } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function PUT(request: Request) {
  const user = getRequestUser(request);
  if (!user) return unauthorized();
  await ensureUserSeed(user);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const caseId = cleanText(body?.caseId, 80);
  const type = cleanText(body?.type, 60);
  const rawFields = body?.fields;
  if (!caseId || !type || !rawFields || typeof rawFields !== 'object' || Array.isArray(rawFields)) {
    return jsonError('文书草稿内容不完整。');
  }

  if (!isRecord(body) || !Object.hasOwn(templateFields, type) || !isRecord(rawFields)) return jsonError('文书模板不支持。');
  if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0) return jsonError('缺少有效的草稿修订号。');
  const entries = Object.entries(rawFields);
  if (entries.some(([key, value]) => !templateFields[type].includes(key) || typeof value !== 'string' || value.length > 3000)) return jsonError('草稿字段或长度不正确。');
  const safeFields = Object.fromEntries(entries);
  const db = getDatabase();
  const caseExists = await db
    .prepare("SELECT id FROM cases WHERE id = ? AND user_id = ? AND status != 'archived'")
    .bind(caseId, user.userId)
    .first();
  if (!caseExists) return jsonError('未找到所选案件。', 404);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `INSERT INTO document_drafts (id, user_id, case_id, type, fields_json, updated_at, revision)
       SELECT ?, ?, ?, ?, ?, ?, 1 WHERE ? = 0 OR EXISTS (SELECT 1 FROM document_drafts WHERE user_id = ? AND case_id = ? AND type = ?)
       ON CONFLICT (user_id, case_id, type) DO UPDATE SET
         fields_json = excluded.fields_json,
         updated_at = excluded.updated_at,
         revision = document_drafts.revision + 1
       WHERE document_drafts.revision = ?`,
    )
    .bind(id, user.userId, caseId, type, JSON.stringify(safeFields), now, body.revision, user.userId, caseId, type, body.revision)
    .run();

  if ((result.meta.changes ?? 0) === 0) return jsonError('草稿已在其他页面更新，请刷新后核对；当前文字仍保留。', 409);

  const row = await db
    .prepare('SELECT * FROM document_drafts WHERE user_id = ? AND case_id = ? AND type = ?')
    .bind(user.userId, caseId, type)
    .first<Record<string, unknown>>();
  if (!row) return jsonError('草稿保存后未能读取。', 500);
  return Response.json({ document: rowToDocument(row) });
}
