import { getRequestUser, unauthorized } from '@/lib/auth';
import {
  cleanText,
  ensureUserSeed,
  getDatabase,
  getFilesBucket,
  jsonError,
  rowToEvidence,
} from '@/lib/server';

export const dynamic = 'force-dynamic';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
  'text/plain',
]);

export async function POST(request: Request) {
  const user = getRequestUser(request);
  if (!user) return unauthorized();
  await ensureUserSeed(user);

  const form = await request.formData().catch(() => null);
  if (!form) return jsonError('上传内容格式不正确。');
  const upload = form.get('file');
  const caseId = cleanText(form.get('caseId'), 80);
  const category = cleanText(form.get('category'), 60) || '其他材料';
  const note = cleanText(form.get('note'), 500);

  if (!(upload instanceof File) || !caseId) return jsonError('请选择案件和要上传的文件。');
  if (upload.size <= 0) return jsonError('不能上传空文件。');
  if (upload.size > MAX_FILE_BYTES) return jsonError('单个文件不能超过 10MB。');
  if (!ALLOWED_TYPES.has(upload.type)) {
    return jsonError('仅支持 PDF、Word、PNG、JPG 和 TXT 文件。');
  }

  const db = getDatabase();
  const caseExists = await db
    .prepare("SELECT id FROM cases WHERE id = ? AND user_id = ? AND status != 'archived'")
    .bind(caseId, user.userId)
    .first();
  if (!caseExists) return jsonError('未找到所选案件。', 404);

  const id = crypto.randomUUID();
  const safeName = normaliseFileName(upload.name);
  const objectKey = `${encodeURIComponent(user.userId)}/${caseId}/${id}-${safeName}`;
  const now = new Date().toISOString();

  await getFilesBucket().put(objectKey, upload.stream(), {
    httpMetadata: { contentType: upload.type },
    customMetadata: { originalName: safeName, userId: user.userId, caseId },
  });

  try {
    await db
      .prepare(
        `INSERT INTO evidence_files
          (id, user_id, case_id, name, category, size, mime_type, status, note, object_key, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'uploaded', ?, ?, ?)`,
      )
      .bind(
        id,
        user.userId,
        caseId,
        safeName,
        category,
        upload.size,
        upload.type,
        note,
        objectKey,
        now,
      )
      .run();
  } catch (error) {
    await getFilesBucket().delete(objectKey);
    throw error;
  }

  const row = await db
    .prepare('SELECT * FROM evidence_files WHERE id = ? AND user_id = ?')
    .bind(id, user.userId)
    .first<Record<string, unknown>>();
  if (!row) return jsonError('文件保存后未能读取。', 500);
  return Response.json({ evidence: rowToEvidence(row) }, { status: 201 });
}

export async function DELETE(request: Request) {
  const user = getRequestUser(request);
  if (!user) return unauthorized();
  await ensureUserSeed(user);

  const id = cleanText(new URL(request.url).searchParams.get('id'), 80);
  if (!id) return jsonError('缺少证据编号。');

  const db = getDatabase();
  const row = await db
    .prepare('SELECT object_key FROM evidence_files WHERE id = ? AND user_id = ?')
    .bind(id, user.userId)
    .first<{ object_key: string | null }>();
  if (!row) return jsonError('未找到这个证据记录。', 404);

  if (row.object_key) await getFilesBucket().delete(row.object_key);
  await db
    .prepare('DELETE FROM evidence_files WHERE id = ? AND user_id = ?')
    .bind(id, user.userId)
    .run();
  return Response.json({ ok: true });
}

function normaliseFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/]/g, '-')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 120);
  return cleaned || '未命名文件';
}
