import { getRequestUser, unauthorized } from '@/lib/auth';
import { cleanText, ensureUserSeed, getDatabase, jsonError, rowToDocument } from '@/lib/server';

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

  const safeFields = Object.fromEntries(
    Object.entries(rawFields as Record<string, unknown>)
      .slice(0, 40)
      .map(([key, value]) => [key.slice(0, 60), cleanText(value, 3000)]),
  );
  const db = getDatabase();
  const caseExists = await db
    .prepare("SELECT id FROM cases WHERE id = ? AND user_id = ? AND status != 'archived'")
    .bind(caseId, user.userId)
    .first();
  if (!caseExists) return jsonError('未找到所选案件。', 404);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO document_drafts (id, user_id, case_id, type, fields_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, case_id, type) DO UPDATE SET
         fields_json = excluded.fields_json,
         updated_at = excluded.updated_at`,
    )
    .bind(id, user.userId, caseId, type, JSON.stringify(safeFields), now)
    .run();

  const row = await db
    .prepare('SELECT * FROM document_drafts WHERE user_id = ? AND case_id = ? AND type = ?')
    .bind(user.userId, caseId, type)
    .first<Record<string, unknown>>();
  if (!row) return jsonError('草稿保存后未能读取。', 500);
  return Response.json({ document: rowToDocument(row) });
}
