import { getRequestUser, unauthorized } from '@/lib/auth';
import { buildLegalGuidance } from '@/lib/legal';
import { cleanText, ensureUserSeed, getDatabase, jsonError, rowToCase, rowToMessage } from '@/lib/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = getRequestUser(request);
  if (!user) return unauthorized();
  await ensureUserSeed(user);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const message = cleanText(body?.message, 2000);
  const caseId = cleanText(body?.caseId, 80);
  if (!message || !caseId) return jsonError('请选择案件并输入问题。');

  const db = getDatabase();
  const caseRow = await db
    .prepare("SELECT * FROM cases WHERE id = ? AND user_id = ? AND status != 'archived'")
    .bind(caseId, user.userId)
    .first<Record<string, unknown>>();
  if (!caseRow) return jsonError('未找到所选案件。', 404);

  const activeCase = rowToCase(caseRow);
  const guidance = buildLegalGuidance(message, activeCase);
  const now = new Date();
  const userMessageId = crypto.randomUUID();
  const assistantMessageId = crypto.randomUUID();
  const insert = db.prepare(
    `INSERT INTO chat_messages
      (id, user_id, case_id, role, content, sources_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  await db.batch([
    insert.bind(userMessageId, user.userId, caseId, 'user', message, '[]', now.toISOString()),
    insert.bind(
      assistantMessageId,
      user.userId,
      caseId,
      'assistant',
      guidance.content,
      JSON.stringify(guidance.sources),
      new Date(now.getTime() + 1).toISOString(),
    ),
  ]);

  const rows = await db
    .prepare('SELECT * FROM chat_messages WHERE id IN (?, ?) ORDER BY created_at ASC')
    .bind(userMessageId, assistantMessageId)
    .all<Record<string, unknown>>();
  return Response.json({ messages: rows.results.map(rowToMessage) }, { status: 201 });
}
