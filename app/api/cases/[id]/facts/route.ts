import { getRequestUser, unauthorized } from '@/lib/auth';
import { ensureUserSeed } from '@/lib/server';
import { actOnMaterialFacts, FactStoreError, parseFactRequest, readMaterialFacts } from '@/lib/material-fact-store';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
async function handle(request: Request, context: Context, method: 'GET' | 'POST') {
  const user = getRequestUser(request);
  if (!user) return unauthorized();
  try {
    await ensureUserSeed(user);
    const { id } = await context.params;
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new FactStoreError('案件编号格式不正确。');
    if (method === 'GET') return respond(await readMaterialFacts(user, id));
    const raw = await request.text();
    if (raw.length > 60_000) throw new FactStoreError('请求内容过长。', 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw new FactStoreError('请求格式不正确。'); }
    const action = parseFactRequest(body);
    const result = await actOnMaterialFacts(user, id, action.revision, action.generation, action.action);
    return respond(result, result.state.job?.status === 'running' ? 202 : 200);
  } catch (error) {
    if (error instanceof FactStoreError) return respond({ error: error.message }, error.status);
    console.error('material facts request failed', error instanceof Error ? error.name : 'unknown');
    return respond({ error: '事实确认暂未完成，当前草稿仍在页面中。请重新读取状态后重试。' }, 503);
  }
}
export const GET = (request: Request, context: Context) => handle(request, context, 'GET');
export const POST = (request: Request, context: Context) => handle(request, context, 'POST');
