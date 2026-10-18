import { env } from 'cloudflare:workers';
import { MaterialServiceHttpError } from './material-service-errors';

export function materialServiceConfigured(): boolean {
  return Boolean(env.ANXIN_MATERIAL_SERVICE_URL && env.ANXIN_MATERIAL_SERVICE_TOKEN);
}

export async function callMaterialService(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  if (!materialServiceConfigured()) throw new Error('本地识别服务尚未启动，请按样例说明运行 npm run dev:materials。原文件已保留。');
  const url = new URL(env.ANXIN_MATERIAL_SERVICE_URL!);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('识别服务配置无效：样例仅连接本机服务。');
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${env.ANXIN_MATERIAL_SERVICE_TOKEN}`);
  const response = await fetch(new URL(path, url), { ...init, headers, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  if (response.status >= 300 && response.status < 400) throw new Error('识别服务返回了不允许的跳转。');
  if (!response.ok) {
    // The HTTP status is already known even if an error body is HTML,
    // truncated or unreadable. Do not let parsing mask that distinction.
    try { void response.body?.cancel().catch(() => {}); }
    catch { /* A stream cleanup failure must not mask the known HTTP status. */ }
    const message = response.status === 404 ? '识别任务已失效，可能是服务重启；请重试，原文件仍在。'
      : response.status === 429 ? '本机识别服务正在处理其他材料，请稍后重试。'
      : response.status >= 400 && response.status < 500 ? '识别服务未接受本次请求，请核对材料或服务配置后重试。'
      : '识别服务暂时不可用，请确认服务状态后重试。';
    throw new MaterialServiceHttpError(response.status, message);
  }
  const text = await response.text();
  if (text.length > 500000) throw new Error('识别服务返回的内容过长。');
  return JSON.parse(text) as Record<string, unknown>;
}
