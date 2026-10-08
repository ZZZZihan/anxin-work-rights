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
     SELECT ?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM evidence_upload_cancellations WHERE id = ?)`,
  ).bind(id, user.userId, caseId, safeName, category, upload.size, upload.type, note, objectKey, now, hash, id).run();
  const intent = await db.prepare('SELECT * FROM evidence_files WHERE id = ? AND user_id = ?')
    .bind(id, user.userId).first<Record<string, unknown>>();
  if (!intent) {
    const cancelled = await db.prepare('SELECT id FROM evidence_upload_cancellations WHERE id = ? AND user_id = ?')
      .bind(id, user.userId).first();
    return jsonError(cancelled ? '上传已取消，请使用新的上传操作编号重新选择文件。' : '上传操作编号已用于其他文件。', 409);
  }
  if (intent.content_hash !== hash || intent.case_id !== caseId || intent.name !== safeName || intent.category !== category || intent.note !== note || intent.mime_type !== upload.type) return jsonError('上传操作编号已用于其他文件。', 409);
  if (intent.status === 'uploaded') return Response.json({ evidence: rowToEvidence(intent) });
  if (!['uploading', 'upload_failed'].includes(String(intent.status))) return jsonError('文件正在删除，不能重复上传。', 409);
  let cancelledDuringUpload = false;
  try {
    await getFilesBucket().put(objectKey, bytes, {
      httpMetadata: { contentType: upload.type },
      customMetadata: { originalName: safeName, userId: user.userId, caseId },
    });
    const finalized = await db.prepare(
      `UPDATE evidence_files SET status = 'uploaded'
       WHERE id = ? AND user_id = ? AND status IN ('uploading', 'upload_failed')
       AND NOT EXISTS (SELECT 1 FROM evidence_upload_cancellations WHERE id = ?)`,
    ).bind(id, user.userId, id).run();
    const current = await db.prepare('SELECT * FROM evidence_files WHERE id = ? AND user_id = ?')
      .bind(id, user.userId).first<Record<string, unknown>>();
    // Another identical request can finish first. Its object is also ours;
    // deleting it here would turn a successful upload into a missing file.
    if (current?.status === 'uploaded') {
      return Response.json({ evidence: rowToEvidence(current) }, { status: (finalized.meta.changes ?? 0) === 0 ? 200 : 201 });
    }
    const cancelled = await db.prepare('SELECT object_key FROM evidence_upload_cancellations WHERE id = ? AND user_id = ?')
      .bind(id, user.userId).first<{ object_key: string | null }>();
    if (cancelled) {
      cancelledDuringUpload = true;
      // DELETE may have completed before this put. The durable cancellation
      // prevents a retry from reusing this key, so late cleanup cannot remove
      // a newer upload. Keep the cancellation even after cleanup succeeds.
      if (cancelled.object_key === objectKey) await getFilesBucket().delete(objectKey);
      return jsonError('上传已取消，请使用新的上传操作编号重新选择文件。', 409);
    }
    return jsonError('上传状态未能确认，文件未删除；请刷新后重试。', 503);
  } catch (error) {
    console.error('evidence upload incomplete', error);
    // Keep the key and intent even if recording the failure itself is unavailable.
    await db.prepare("UPDATE evidence_files SET status = 'upload_failed' WHERE id = ? AND user_id = ? AND status = 'uploading'")
      .bind(id, user.userId).run().catch(() => undefined);
    if (cancelledDuringUpload) return jsonError('上传已取消，文件清理未完成；取消记录已保留，可重试删除。', 503);
    return jsonError('上传未完成，记录已保留；可重试相同文件或删除记录。', 503);
  }
}

export async function DELETE(request: Request) {
  const user = getRequestUser(request);
  if (!user) return unauthorized();
  await ensureUserSeed(user);

  const id = cleanText(new URL(request.url).searchParams.get('id'), 80);
  if (!id) return jsonError('缺少证据编号。');

  const db = getDatabase();
  try {
    // Persist cancellation and block downloads in one database transaction.
    // Removing the visible record must not forget the operation UUID: an
    // in-flight put or delayed retry may still arrive after DELETE succeeds.
    await db.batch([
      db.prepare(
        `INSERT OR IGNORE INTO evidence_upload_cancellations (id, user_id, object_key, cancelled_at)
         SELECT id, user_id, object_key, ? FROM evidence_files WHERE id = ? AND user_id = ?`,
      ).bind(new Date().toISOString(), id, user.userId),
      db.prepare("UPDATE evidence_files SET status = 'deleting' WHERE id = ? AND user_id = ?")
        .bind(id, user.userId),
    ]);
    const cancellation = await db.prepare('SELECT object_key FROM evidence_upload_cancellations WHERE id = ? AND user_id = ?')
      .bind(id, user.userId).first<{ object_key: string | null }>();
    if (!cancellation) return jsonError('未找到这个证据记录。', 404);
    if (cancellation.object_key) await getFilesBucket().delete(cancellation.object_key);
    await db.prepare("DELETE FROM evidence_files WHERE id = ? AND user_id = ? AND status = 'deleting'")
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
