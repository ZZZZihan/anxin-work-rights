import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { createHmac, scryptSync, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { resolve } from 'node:path';

const root = process.cwd();
const config = JSON.parse(readFileSync(process.env.ANXIN_CONFIG, 'utf8'));
const origin = new URL(config.origin);
const workerPort = config.workerPort ?? 18797;
const workerBase = `http://127.0.0.1:${workerPort}`;
const worker = spawn(process.execPath, [
  resolve('node_modules/wrangler/bin/wrangler.js'), 'dev', '--local',
  '--config', 'dist/server/wrangler.json', '--ip', '127.0.0.1',
  '--port', String(workerPort), '--persist-to', config.stateDir,
], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false' } });
let ready = false;
let stopping = false;
worker.on('exit', (code) => { if (!stopping) { console.error('Worker exited:', code); process.exit(1); } });
for (let attempt = 0; attempt < 120; attempt++) {
  try { if ((await fetch(`${workerBase}/api/bootstrap`)).status === 401) { ready = true; break; } } catch { /* startup */ }
  await new Promise((done) => setTimeout(done, 500));
}
if (!ready) { worker.kill(); throw new Error('Worker did not become ready.'); }

const cookieName = '__Host-anxin-session';
function sign(value) { return createHmac('sha256', config.sessionKey).update(value).digest('base64url'); }
function equal(a, b) { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
function sessionUser(req) {
  const cookie = (req.headers.cookie ?? '').split(';').map((item) => item.trim()).find((item) => item.startsWith(`${cookieName}=`));
  if (!cookie) return null;
  const [value, signature, extra] = cookie.slice(cookieName.length + 1).split('.');
  if (!value || !signature || extra || !equal(sign(value), signature)) return null;
  try {
    const session = JSON.parse(Buffer.from(value, 'base64url'));
    if (!Number.isFinite(session.expires) || session.expires <= Date.now()) return null;
    return config.users.find((user) => user.id === session.id) ?? null;
  } catch { return null; }
}
function reply(res, status, body, type = 'text/html; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
  res.end(body);
}
async function body(req, limit) {
  let size = 0;
  const parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > limit) throw Object.assign(new Error('请求内容过大。'), { status: 413 });
    parts.push(part);
  }
  return Buffer.concat(parts);
}
const loginPage = (failed = false) => `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登录 · 安薪乐业</title><style>body{font:16px system-ui;background:#f0f4f7;color:#183348;margin:0}main{max-width:360px;margin:10vh auto;padding:30px;background:white;border-radius:18px}label{display:grid;gap:8px;margin:20px 0}input,button{font:inherit;padding:12px;border-radius:8px;border:1px solid #bdcbd5}button{width:100%;background:#183348;color:white}p{line-height:1.6}small{color:#53677a}</style><main><h1>安薪乐业</h1><p>登录你的劳动权益工作台</p>${failed ? '<p role="alert">账号或密码不正确，请重试。</p>' : ''}<form method="post" action="/auth/login"><label>账号<input name="username" autocomplete="username" required maxlength="80"></label><label>密码<input type="password" name="password" autocomplete="current-password" required maxlength="256"></label><button>登录</button></form><small>资料按账户隔离，仅供本地云试用。</small></main></html>`;
const attempts = new Map();
const server = createServer({ key: readFileSync(config.tlsKey), cert: readFileSync(config.tlsCert) }, async (req, res) => {
  try {
    if (req.headers.host !== origin.host) return reply(res, 400, '访问地址不正确。');
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith('/cdn-cgi/')) return reply(res, 404, '未找到页面。');
    const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (isMutation && req.headers.origin !== origin.origin) return reply(res, 403, JSON.stringify({ error: '请求来源不正确。' }), 'application/json');
    if (url.pathname === '/api/ready' && req.method === 'GET') {
      return reply(res, 200, JSON.stringify({ status: 'ok', release: config.release, pid: process.pid }), 'application/json');
    }
    if (url.pathname === '/signin-with-chatgpt' || url.pathname === '/auth/login') {
      if (req.method === 'GET') return reply(res, 200, loginPage());
      if (req.method !== 'POST' || url.pathname !== '/auth/login') return reply(res, 405, '请求方法不支持。');
      const ip = req.socket.remoteAddress;
      const recent = (attempts.get(ip) ?? []).filter((time) => Date.now() - time < 60_000);
      if (recent.length >= 10) return reply(res, 429, '登录尝试过多，请一分钟后再试。');
      recent.push(Date.now()); attempts.set(ip, recent);
      const form = new URLSearchParams((await body(req, 4096)).toString('utf8'));
      const user = config.users.find((item) => item.username === form.get('username'));
      const hash = scryptSync(form.get('password') ?? '', user?.salt ?? config.sessionKey, 64).toString('hex');
      if (!user || !equal(hash, user.passwordHash)) return reply(res, 401, loginPage(true));
      attempts.delete(ip);
      const value = Buffer.from(JSON.stringify({ id: user.id, expires: Date.now() + 8 * 3600_000 })).toString('base64url');
      res.writeHead(303, { Location: '/', 'Set-Cookie': `${cookieName}=${value}.${sign(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`, 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (url.pathname === '/signout-with-chatgpt') {
      res.writeHead(303, { Location: '/auth/login', 'Set-Cookie': `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`, 'Cache-Control': 'no-store' });
      return res.end();
    }
    const user = sessionUser(req);
    if (!user) {
      if (url.pathname.startsWith('/api/')) return reply(res, 401, JSON.stringify({ error: '需要登录后才能访问你的案件资料。' }), 'application/json');
      res.writeHead(303, { Location: '/auth/login', 'Cache-Control': 'no-store' }); return res.end();
    }
    if (url.pathname === '/api/health') return reply(res, 200, JSON.stringify({ status: 'ok', release: config.release }), 'application/json');
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (['host', 'cookie', 'authorization', 'connection', 'content-length', 'transfer-encoding', 'accept-encoding'].includes(name) || name.startsWith('oai-') || name.startsWith('x-forwarded-')) continue;
      if (typeof value === 'string') headers.set(name, value);
    }
    headers.set('oai-authenticated-user-id', user.id);
    headers.set('oai-authenticated-user-email', user.email);
    headers.set('oai-authenticated-user-full-name', encodeURIComponent(user.displayName));
    headers.set('oai-authenticated-user-full-name-encoding', 'percent-encoded-utf-8');
    const response = await fetch(`${workerBase}${url.pathname}${url.search}`, {
      method: req.method, headers, body: isMutation ? await body(req, 11 * 1024 * 1024) : undefined, redirect: 'manual', signal: AbortSignal.timeout(60_000),
    });
    const responseHeaders = Object.fromEntries(response.headers);
    delete responseHeaders['transfer-encoding']; delete responseHeaders['content-encoding']; delete responseHeaders['content-length'];
    if (url.pathname.startsWith('/api/')) responseHeaders['cache-control'] = 'private, no-store';
    res.writeHead(response.status, responseHeaders);
    if (response.body) Readable.fromWeb(response.body).pipe(res); else res.end();
  } catch (error) {
    console.error('Gateway request failed:', error.message);
    if (!res.headersSent) reply(res, error.status ?? 502, JSON.stringify({ error: '请求暂时未完成，请稍后重试。' }), 'application/json'); else res.destroy();
  }
});
server.requestTimeout = 65_000;
server.listen(Number(origin.port || 443), origin.hostname, () => console.log(`Anxin local-cloud ready: ${origin.origin}, release ${config.release}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopping = true; server.close(); worker.kill('SIGTERM'); setTimeout(() => process.exit(0), 3000).unref(); });
