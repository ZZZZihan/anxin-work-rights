import { getRequestUser, unauthorized } from '@/lib/auth';
import { jsonError, loadBootstrap } from '@/lib/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = getRequestUser(request);
  if (!user) return unauthorized();

  try {
    return Response.json(await loadBootstrap(user));
  } catch (error) {
    console.error('bootstrap failed', error);
    return jsonError('暂时无法读取案件资料，请稍后重试。', 500);
  }
}
