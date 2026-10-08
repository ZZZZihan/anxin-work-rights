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

  const operationId = cleanText(form.get('operationId'), 80);
  if (operationId && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) return jsonError('上传操作编号不正确。');
  const id = operationId || crypto.randomUUID();
  const safeName = normaliseFileName(upload.name);
  const objectKey = `${encodeURIComponent(user.userId)}/${caseId}/${id}-${safeName}`;
  const bytes = await upload.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const now = new Date().toISOString();
  // Record the intent before touching R2 so every object has recoverable metadata.
  await db.prepare(
    `INSERT OR IGNORE INTO evidence_files
      (id, user_id, case_id, name, category, size, mime_type, status, note, object_key, uploaded_at, content_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?, ?, ?)`,
  ).bind(id, user.userId, caseId, safeName, category, upload.size, upload.type, note, objectKey, now, hash).run();
  const intent = await db.prepare('SELECT * FROM evidence_files WHERE id = ? AND user_id = ?')
    .bind(id, user.userId).first<Record<string, unknown>>();
  if (!intent || intent.content_hash !== hash || intent.case_id !== caseId || intent.name !== safeName || intent.category !== category || intent.note !== note || intent.mime_type !== upload.type) return jsonError('上传操作编号已用于其他文件。', 409);
  if (intent.status === 'uploaded') return Response.json({ evidence: rowToEvidence(intent) });
  if (!['uploading', 'upload_failed'].includes(String(intent.status))) return jsonError('文件正在删除，不能重复上传。', 409);
  try {
    await getFilesBucket().put(objectKey, bytes, {
      httpMetadata: { contentType: upload.type },
      customMetadata: { originalName: safeName, userId: user.userId, caseId },
    });
    const finalized = await db.prepare("UPDATE evidence_files SET status = 'uploaded' WHERE id = ? AND user_id = ? AND status IN ('uploading', 'upload_failed')")
      .bind(id, user.userId).run();
    if ((finalized.meta.changes ?? 0) === 0) {
      await getFilesBucket().delete(objectKey);
      return jsonError('上传已取消，请重新选择文件。', 409);
    }
  } catch (error) {
    console.error('evidence upload incomplete', error);
    // Keep the key and intent even if recording the failure itself is unavailable.
    await db.prepare("UPDATE evidence_files SET status = 'upload_failed' WHERE id = ? AND user_id = ? AND status = 'uploading'")
      .bind(id, user.userId).run().catch(() => undefined);
    return jsonError('上传未完成，记录已保留；可重试相同文件或删除记录。', 503);
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

  try {
    // A durable tombstone blocks downloads before irreversible object deletion.
    await db.prepare("UPDATE evidence_files SET status = 'deleting' WHERE id = ? AND user_id = ?")
      .bind(id, user.userId).run();
    if (row.object_key) await getFilesBucket().delete(row.object_key);
    await db.prepare('DELETE FROM evidence_files WHERE id = ? AND user_id = ?')
      .bind(id, user.userId).run();
  } catch (error) {
    console.error('evidence deletion incomplete', error);
    return jsonError('删除未完成，请刷新查看状态后重试。', 503);
  }
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
