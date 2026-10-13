import { getRequestUser, unauthorized } from '@/lib/auth';
import { searchPublicKnowledge } from '@/lib/public-retrieval';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!getRequestUser(request)) return unauthorized();
  const query = new URL(request.url).searchParams.get('query') ?? '';
  if (query.length > 2000) return Response.json({ error: '检索内容不能超过 2000 字。' }, { status: 400 });
  return Response.json(searchPublicKnowledge(query), { headers: { 'Cache-Control': 'private, no-store' } });
}
