import { createServer } from 'node:http';
import { createServer as createPortProbe } from 'node:net';
import { createHmac, scryptSync, timingSafeEqual } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { loadEnvironment, sessionLifetime, sourceAllowed } from './environment.mjs';

const notice = '仅限合成数据。HTTP 可被抓包或篡改，请勿输入真实资料或复用真实密码。';
function equal(left, right) {
  const a = Buffer.from(left ?? ''), b = Buffer.from(right ?? '');
  return a.length === b.length && timingSafeEqual(a, b);
}
function reply(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
  res.end(body);
}
async function body(req, limit) {
  const parts = []; let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > limit) throw Object.assign(new Error('Synthetic request limit'), { status: 413 });
    parts.push(part);
  }
  return Buffer.concat(parts);
}
export function requestSource(req, config) {
  const peer = req.socket.remoteAddress?.replace(/^::ffff:/, '');
  if (!config.proxyMode) return peer;
  if (peer !== '127.0.0.1' || !equal(req.headers['x-anxin-synthetic-proxy'], config.proxyKey)) return null;
  const forwarded = req.headers['x-anxin-synthetic-source'];
  return typeof forwarded === 'string' ? forwarded : null;
}
export function createGateway(config, workerBase, { now = Date.now } = {}) {
  const origin = new URL(config.origin);
  const expiresAt = Date.parse(config.expiresAt);
  const directEntry = config.directEntry === true;
  const guest = directEntry ? { ...config.users.find((user) => user.username === 'synthetic-a'), displayName: '林晓', email: 'lin.xiao@example.com' } : null;
  const sign = (value) => createHmac('sha256', config.sessionKey).update(value).digest('base64url');
  const attempts = new Map();
  const loginPage = (failed = false) => `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>合成验收登录 · 安薪乐业</title><style>body{font:16px system-ui;background:#fff4cf;color:#624515}main{max-width:420px;margin:6vh auto;padding:24px;background:white;border-radius:12px}label{display:grid;gap:6px;margin:20px 0}input,button{font:inherit;padding:10px}p{line-height:1.6}</style><main><h1>合成 HTTP 验收环境</h1><p role="note">${notice}</p><p>截止：${config.expiresAt}。短期合成账户与真实工作台无关。</p>${failed ? '<p role="alert">合成账户或密码不正确。</p>' : ''}<form method="post" action="/auth/login"><label>合成账号<input name="username" autocomplete="off" required maxlength="80"></label><label>合成密码<input type="password" name="password" autocomplete="off" required maxlength="256"></label><button>进入合成验收</button></form></main></html>`;
  function sessionUser(req) {
    const cookie = (req.headers.cookie ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith(config.cookieName + '='));
    if (!cookie) return null;
    const [value, signature, extra] = cookie.slice(config.cookieName.length + 1).split('.');
    if (!value || !signature || extra || !equal(sign(value), signature)) return null;
    try {
      const session = JSON.parse(Buffer.from(value, 'base64url'));
      if (session.environmentId !== config.environmentId || !Number.isFinite(session.expires) || session.expires <= now() || session.expires > expiresAt) return null;
      return config.users.find((user) => user.id === session.id) ?? null;
    } catch { return null; }
  }
  const server = createServer(async (req, res) => {
    try {
      const source = requestSource(req, config);
      if (!source || !sourceAllowed(source, config.allowCidrs)) return reply(res, 403, '{"error":"合成环境来源未授权。"}');
      if (req.headers.host !== origin.host) return reply(res, 400, '{"error":"合成环境访问地址不正确。"}');
      if (now() >= expiresAt) return reply(res, 410, '{"error":"合成环境已过期。"}');
      const url = new URL(req.url, origin);
      const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
      if (mutation && req.headers.origin !== config.origin) return reply(res, 403, '{"error":"合成环境请求来源不正确。"}');
      if (url.pathname.startsWith('/cdn-cgi/') || url.pathname === '/api/synthetic-ready') return reply(res, 404, '{}');
      if (url.pathname === '/api/ready' && req.method === 'GET') return reply(res, 200, JSON.stringify({ status: 'ok', environmentId: config.environmentId, release: config.release, pid: process.pid, expiresAt: config.expiresAt }));
      if (['/auth/login', '/signin-with-chatgpt'].includes(url.pathname)) {
        if (directEntry) { res.writeHead(303, { Location: '/', 'Cache-Control': 'no-store' }); return res.end(); }
        if (req.method === 'GET') return reply(res, 200, loginPage(), 'text/html; charset=utf-8');
        if (url.pathname !== '/auth/login' || req.method !== 'POST') return reply(res, 405, '{}');
        const recent = (attempts.get(source) ?? []).filter((time) => now() - time < 60_000);
        if (recent.length >= 10) return reply(res, 429, '{}');
        recent.push(now()); attempts.set(source, recent);
        const form = new URLSearchParams((await body(req, 4096)).toString('utf8'));
        const user = config.users.find((item) => item.username === form.get('username'));
        const digest = scryptSync(form.get('password') ?? '', user?.salt ?? config.sessionKey, 64).toString('hex');
        if (!user || !equal(digest, user.passwordHash)) return reply(res, 401, loginPage(true), 'text/html; charset=utf-8');
        attempts.delete(source);
        const expires = Math.min(now() + sessionLifetime, expiresAt);
        const value = Buffer.from(JSON.stringify({ id: user.id, environmentId: config.environmentId, expires })).toString('base64url');
        res.writeHead(303, { Location: '/', 'Cache-Control': 'no-store', 'Set-Cookie': `${config.cookieName}=${value}.${sign(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor((expires - now()) / 1000)}` });
        return res.end();
      }
      if (url.pathname === '/signout-with-chatgpt') {
        res.writeHead(303, { Location: directEntry ? '/' : '/auth/login', 'Cache-Control': 'no-store', 'Set-Cookie': `${config.cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` }); return res.end();
      }
      const user = directEntry ? guest : sessionUser(req);
      if (!user) {
        if (url.pathname.startsWith('/api/')) return reply(res, 401, '{"error":"需要合成账户登录。"}');
        res.writeHead(303, { Location: '/auth/login', 'Cache-Control': 'no-store' }); return res.end();
      }
      if (url.pathname === '/api/health') return reply(res, 200, JSON.stringify({ status: 'ok', environmentId: config.environmentId, release: config.release }));
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (['host', 'cookie', 'authorization', 'connection', 'content-length', 'transfer-encoding', 'accept-encoding', 'forwarded', 'x-real-ip'].includes(name) || /^(oai-|x-forwarded-|x-anxin-synthetic-|cf-)/.test(name)) continue;
        if (typeof value === 'string') headers.set(name, value);
      }
      headers.set('oai-authenticated-user-id', user.id);
      headers.set('oai-authenticated-user-email', user.email);
      headers.set('oai-authenticated-user-full-name', encodeURIComponent(user.displayName));
      headers.set('oai-authenticated-user-full-name-encoding', 'percent-encoded-utf-8');
      const response = await fetch(`${workerBase}${url.pathname}${url.search}`, { method: req.method, headers, body: mutation ? await body(req, 11 * 1024 * 1024) : undefined, redirect: 'manual', signal: AbortSignal.timeout(60_000) });
      const outputHeaders = Object.fromEntries(response.headers);
      for (const name of ['content-length', 'content-encoding', 'transfer-encoding']) delete outputHeaders[name];
      if (url.pathname.startsWith('/api/')) outputHeaders['cache-control'] = 'private, no-store';
      if (url.pathname === '/api/bootstrap' && response.ok) {
        const data = await response.json();
        data.synthetic = { environmentId: config.environmentId, expiresAt: config.expiresAt, directEntry };
        return reply(res, response.status, JSON.stringify(data));
      }
      res.writeHead(response.status, outputHeaders);
      if (response.body) Readable.fromWeb(response.body).pipe(res); else res.end();
    } catch (error) {
      if (!res.headersSent) reply(res, error.status ?? 502, '{"error":"合成请求未完成。"}'); else res.destroy();
    }
  });
  server.requestTimeout = 65_000;
  server.headersTimeout = 15_000;
  return server;
}
export async function assertPortFree(host, port) {
  const probe = createPortProbe();
  await new Promise((done, fail) => { probe.once('error', fail); probe.listen({ host, port, exclusive: true }, done); });
  await new Promise((done) => probe.close(done));
}
export async function waitForWorker(worker, workerBase, environmentId, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!Number.isInteger(worker.pid) || worker.startupError || worker.exitCode !== null || worker.signalCode !== null) throw new Error('Synthetic Worker exited.');
    try {
      const response = await fetch(`${workerBase}/api/synthetic-ready`, { signal: AbortSignal.timeout(Math.min(1000, deadline - Date.now())) });
      if (response.ok && (await response.json()).environmentId === environmentId && worker.exitCode === null && worker.signalCode === null) return;
    } catch { /* bounded startup */ }
    await new Promise((done) => setTimeout(done, Math.min(100, Math.max(0, deadline - Date.now()))));
  }
  throw new Error('Synthetic Worker identity did not become ready.');
}
export async function startEnvironment(root) {
  const config = loadEnvironment(root);
  const runtime = join(config.root, '.runtime.json');
  if (existsSync(runtime)) throw new Error('Synthetic instance already marked live.');
  await assertPortFree(config.bindIp, config.port);
  await assertPortFree('127.0.0.1', config.workerPort);
  const wrangler = resolve('node_modules/wrangler/bin/wrangler.js');
  const compiled = JSON.parse(readFileSync(resolve('dist/server/wrangler.json'), 'utf8'));
  // The runtime config/cache is in the synthetic root, so the release can be
  // mounted read-only. New D1/R2 names and IDs never reference real resources.
  const workerConfig = join(config.root, 'worker.json');
  const settings = {
    name: `anxin-synthetic-${config.environmentId}`, main: resolve('dist/server/index.js'),
    compatibility_date: compiled.compatibility_date, compatibility_flags: compiled.compatibility_flags,
    no_bundle: true, rules: compiled.rules, assets: { directory: resolve('dist/client') },
    vars: { ANXIN_SYNTHETIC_ENV_ID: config.environmentId },
    d1_databases: [{ binding: 'DB', database_name: `synthetic-${config.environmentId}`, database_id: config.environmentId, migrations_dir: resolve('drizzle') }],
    r2_buckets: [{ binding: 'FILES', bucket_name: `synthetic-${config.environmentId}` }],
  };
  const serialized = JSON.stringify(settings);
  if (existsSync(workerConfig)) {
    if (readFileSync(workerConfig, 'utf8') !== serialized) throw new Error('Synthetic Worker configuration changed.');
  } else writeFileSync(workerConfig, serialized, { mode: 0o600, flag: 'wx' });
  const workerBase = `http://127.0.0.1:${config.workerPort}`;
  writeFileSync(runtime, JSON.stringify({ environmentId: config.environmentId, pid: process.pid }), { mode: 0o600, flag: 'wx' });
  let worker, server, lifetime, shutdown, closing = false;
  const stop = async () => {
    if (closing) return; closing = true;
    clearTimeout(lifetime);
    if (shutdown) { process.removeListener('SIGTERM', shutdown); process.removeListener('SIGINT', shutdown); }
    if (server) { server.closeAllConnections(); await new Promise((done) => server.close(done)); }
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      worker.kill('SIGTERM');
      const force = setTimeout(() => worker.kill('SIGKILL'), 3000);
      await new Promise((done) => worker.once('exit', done)); clearTimeout(force);
    }
    if (worker) {
      const deadline = Date.now() + 5000;
      for (;;) {
        try { await assertPortFree('127.0.0.1', config.workerPort); break; }
        catch (error) { if (Date.now() >= deadline) throw error; await new Promise((done) => setTimeout(done, 50)); }
      }
    }
    if (existsSync(runtime) && JSON.parse(readFileSync(runtime)).pid === process.pid) unlinkSync(runtime);
  };
  try {
    const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false' };
    await promisify(execFile)(process.execPath, [wrangler, 'd1', 'migrations', 'apply', 'DB', '--local', '--config', workerConfig, '--persist-to', config.stateDir], { cwd: config.root, env, timeout: 60_000 });
    worker = spawn(process.execPath, [wrangler, 'dev', '--local', '--config', workerConfig, '--ip', '127.0.0.1', '--port', String(config.workerPort), '--persist-to', config.stateDir], { cwd: config.root, env, stdio: ['ignore', 'inherit', 'inherit'] });
    worker.once('error', () => { worker.startupError = true; });
    await waitForWorker(worker, workerBase, config.environmentId);
    server = createGateway(config, workerBase);
    await new Promise((done, fail) => { server.once('error', fail); server.listen(config.port, config.bindIp, done); });
    worker.once('exit', () => { if (!closing) void stop().finally(() => { process.exitCode = 1; }).catch(() => undefined); });
    lifetime = setTimeout(() => { void stop().catch(() => { process.exitCode = 1; }); }, Date.parse(config.expiresAt) - Date.now());
    shutdown = () => { void stop().catch(() => { process.exitCode = 1; }); };
    process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
    console.log(JSON.stringify({ synthetic: true, environmentId: config.environmentId, origin: config.origin, listener: `http://${config.bindIp}:${config.port}`, expiresAt: config.expiresAt, worker: worker.pid, notice }));
    return { config, server, worker, stop: async () => { clearTimeout(lifetime); process.removeListener('SIGTERM', shutdown); process.removeListener('SIGINT', shutdown); await stop(); } };
  } catch (error) { await stop(); throw error; }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  startEnvironment(process.argv[2]).catch(() => { console.error('Synthetic startup refused or failed; no fallback and no private configuration output.'); process.exitCode = 1; });
}
