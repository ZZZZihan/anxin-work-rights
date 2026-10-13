import { getRequestUser, unauthorized } from '@/lib/auth';
import { ensureUserSeed } from '@/lib/server';
import { AnalysisError, readAnalysis, reviewAnalysis, startAnalysis } from '@/lib/material-analysis';
import { materialServiceConfigured } from '@/lib/material-service-client';
import { documentKindLabels, type DocumentKind } from '@/lib/material-types';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
async function handle(request: Request, context: Context, method: string) {
  const user = getRequestUser(request);
  if (!user) return unauthorized();
  try {
    await ensureUserSeed(user);
    const { id } = await context.params;
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new AnalysisError('材料编号格式不正确。');
    let analysis;
    if (method === 'GET') analysis = await readAnalysis(user, id);
    else {
      const raw = await request.text();
      if (raw.length > 40000) throw new AnalysisError('请求内容过长。', 413);
      let body: Record<string, unknown>;
      try { body = JSON.parse(raw); } catch { throw new AnalysisError('请求格式不正确。'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AnalysisError('请求格式不正确。');
      if (method === 'POST') {
        if (typeof body.documentKind !== 'string' || !Object.hasOwn(documentKindLabels, body.documentKind)) throw new AnalysisError('请选择材料类型。');
        if (body.retry !== undefined && typeof body.retry !== 'boolean') throw new AnalysisError('重试参数格式不正确。');
        analysis = await startAnalysis(user, id, body.documentKind as DocumentKind, body.retry === true);
      } else analysis = await reviewAnalysis(user, id, body.revision as number, body.fields);
    }
    return respond({ analysis, configured: materialServiceConfigured() }, method === 'POST' && analysis?.status === 'running' ? 202 : 200);
  } catch (error) {
    if (error instanceof AnalysisError) return respond({ error: error.message }, error.status);
    console.error('material analysis request failed', error instanceof Error ? error.name : 'unknown');
    return respond({ error: '材料处理暂时未完成，请刷新状态后重试。原文件不会因识别失败被删除。' }, 503);
  }
}
export const GET = (request: Request, context: Context) => handle(request, context, 'GET');
export const POST = (request: Request, context: Context) => handle(request, context, 'POST');
export const PUT = (request: Request, context: Context) => handle(request, context, 'PUT');
