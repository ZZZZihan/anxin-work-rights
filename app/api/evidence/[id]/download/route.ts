import { getRequestUser, unauthorized } from '@/lib/auth';
import { cleanText, ensureUserSeed, getDatabase, getFilesBucket, jsonError } from '@/lib/server';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = getRequestUser(request);
  if (!user) return unauthorized();
  await ensureUserSeed(user);

  const { id: rawId } = await context.params;
  const id = cleanText(rawId, 80);
  const row = await getDatabase()
    .prepare('SELECT name, mime_type, object_key FROM evidence_files WHERE id = ? AND user_id = ?')
    .bind(id, user.userId)
    .first<{ name: string; mime_type: string; object_key: string | null }>();
  if (!row || !row.object_key) return jsonError('这个记录没有可下载的真实文件。', 404);

  const object = await getFilesBucket().get(row.object_key);
  if (!object) return jsonError('文件对象已不存在，请删除记录后重新上传。', 404);

  const encodedName = encodeURIComponent(row.name).replace(/'/g, '%27');
  return new Response(object.body, {
    headers: {
      'Content-Type': row.mime_type || object.httpMetadata?.contentType || 'application/octet-stream',
      'Content-Length': String(object.size),
      'Content-Disposition': `attachment; filename="evidence"; filename*=UTF-8''${encodedName}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
