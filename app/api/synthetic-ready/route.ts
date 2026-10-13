import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

// This binding is supplied only to the disposable synthetic Worker. A generic
// 401 from another process on the requested port is not startup proof.
export async function GET() {
  if (!env.ANXIN_SYNTHETIC_ENV_ID) return new Response(null, { status: 404 });
  return Response.json({ environmentId: env.ANXIN_SYNTHETIC_ENV_ID }, { headers: { 'Cache-Control': 'no-store' } });
}
