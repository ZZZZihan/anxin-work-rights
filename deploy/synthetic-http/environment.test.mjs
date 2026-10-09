import { createServer, request as rawRequest } from 'node:http';
import { existsSync, mkdirSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createEnvironment, loadEnvironment, maxLifetime, parseCidr, removeEnvironment, sourceAllowed, validateNetwork } from './environment.mjs';
import { assertPortFree, createGateway, requestSource, waitForWorker } from './server.mjs';
import { isolationArgs } from './isolated.mjs';
import { renderNginx } from './nginx-config.mjs';

const environments = [], servers = [];
function environment(options) { const item = createEnvironment(options); environments.push(item); return { ...item, config: loadEnvironment(item.root), access: JSON.parse(readFileSync(join(item.root, 'access.json'))) }; }
async function listen(server) { servers.push(server); await new Promise((done) => server.listen(0, '127.0.0.1', done)); return `http://127.0.0.1:${server.address().port}`; }
function request(url, { method = 'GET', headers, body } = {}) {
  return new Promise((done, fail) => {
    const req = rawRequest(url, { method, headers }, (res) => {
      const parts = []; res.on('data', (part) => parts.push(part)); res.once('error', fail);
      res.once('end', () => done(new Response(Buffer.concat(parts), { status: res.statusCode, headers: res.headers })));
    });
    req.once('error', fail); req.end(body?.toString());
  });
}
afterEach(async () => {
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise((done) => server.close(done)); }
  for (const item of environments.splice(0)) if (existsSync(item.root)) removeEnvironment(item.root, item.environmentId);
});
describe('fresh synthetic environment boundaries', () => {
  it('defaults to loopback, loads the maximum TTL, and generates distinct identities and keys', () => {
    const a = environment(), b = environment();
    expect(a.config.bindIp).toBe('127.0.0.1');
    expect(a.config.allowCidrs).toEqual(['127.0.0.1/32']);
    expect(a.config.directEntry).toBe(false);
    expect(Date.parse(a.config.expiresAt) - Date.parse(a.config.createdAt)).toBe(maxLifetime);
    expect(a.config.sessionKey !== b.config.sessionKey && a.config.cookieName !== b.config.cookieName && a.config.users[0].id !== b.config.users[0].id).toBe(true);
    expect(a.config.stateDir !== b.config.stateDir).toBe(true);
  });
  it('requires an explicit boolean for direct entry and accepts older default configurations', () => {
    expect(() => createEnvironment({ directEntry: 'true' })).toThrow('boolean');
    const a = environment({ directEntry: true });
    expect(a.config.directEntry).toBe(true);
    const path = join(a.root, 'config.json');
    const config = { ...a.config }; delete config.stateDir; delete config.directEntry;
    writeFileSync(path, JSON.stringify(config));
    expect(loadEnvironment(a.root).directEntry).toBeUndefined();
    config.directEntry = 'true'; writeFileSync(path, JSON.stringify(config));
    expect(() => loadEnvironment(a.root)).toThrow('direct-entry');
    config.directEntry = false; writeFileSync(path, JSON.stringify(config));
  });
  it('requires one private bind IP and explicit canonical sources, with public sources restricted to /32', () => {
    for (const bindIp of ['0.0.0.0', '::', '219.243.58.55']) expect(() => validateNetwork({ bindIp })).toThrow();
    expect(() => validateNetwork({ bindIp: '172.23.1.127' })).toThrow('explicit');
    for (const cidr of ['0.0.0.0/0', '219.243.58.0/24', '172.23.1.4/24']) expect(() => parseCidr(cidr)).toThrow();
    const scope = validateNetwork({ bindIp: '172.23.1.127', allowCidrs: ['172.23.1.0/24', '172.31.125.123/32', '219.243.58.55/32'] });
    expect(sourceAllowed('172.23.1.20', scope.allowCidrs)).toBe(true);
    expect(sourceAllowed('::ffff:219.243.58.55', scope.allowCidrs)).toBe(true);
    expect(sourceAllowed('219.243.58.56', scope.allowCidrs)).toBe(false);
    expect(sourceAllowed('172.31.125.124', scope.allowCidrs)).toBe(false);
    for (const workerPort of [18797, 8444, 80]) expect(() => validateNetwork({ workerPort })).toThrow();
  });
  it('refuses real paths, redirects, wrong markers and live cleanup', () => {
    expect(() => createEnvironment({ baseDirectory: '/home/carryz/.local/share/anxin/state' })).toThrow('Synthetic base');
    expect(() => loadEnvironment('/home/carryz/.config/anxin')).toThrow('generated');
    const a = environment();
    expect(() => removeEnvironment(a.root, 'wrong-marker')).toThrow();
    writeFileSync(join(a.root, '.runtime.json'), '{}', { mode: 0o600 });
    expect(() => removeEnvironment(a.root, a.environmentId)).toThrow('live');
    unlinkSync(join(a.root, '.runtime.json'));
    const config = join(a.root, 'config.json');
    renameSync(config, join(a.root, 'saved.json'));
    symlinkSync(join(a.root, 'saved.json'), config);
    expect(() => loadEnvironment(a.root)).toThrow('symlinks');
    expect(() => removeEnvironment(a.root, a.environmentId)).toThrow('symlinks');
    unlinkSync(config); renameSync(join(a.root, 'saved.json'), config);
    const state = join(a.root, 'state');
    renameSync(state, join(a.root, 'saved-state')); symlinkSync(join(a.root, 'saved-state'), state);
    expect(() => loadEnvironment(a.root)).toThrow('symlinks');
    unlinkSync(state); renameSync(join(a.root, 'saved-state'), state);
  });
  it('prepares readonly-release isolation with no real home bind, clearenv and no fallback', () => {
    const a = environment();
    // Only argv preparation is proven here; Linux namespace behavior is checked
    // inside the actual sandbox on the authorized target before it serves.
    const release = join(a.root, 'offline-release');
    mkdirSync(join(release, 'dist/server'), { recursive: true, mode: 0o700 });
    mkdirSync(join(release, 'deploy/synthetic-http'), { recursive: true, mode: 0o700 });
    writeFileSync(join(release, 'dist/server/index.js'), '');
    writeFileSync(join(release, 'deploy/synthetic-http/sandbox-entry.mjs'), '');
    const args = isolationArgs(release, a.root);
    expect(args.includes('--clearenv') && args.includes('--unshare-all') && args.includes('--share-net') && args.includes('--die-with-parent')).toBe(true);
    const releaseBind = args.indexOf(release);
    expect(args.slice(releaseBind - 1, releaseBind + 2)).toEqual(['--ro-bind', release, '/app']);
    expect(args.includes('/runtime/node') && !args.includes('/opt')).toBe(true);
    expect(args.some((item) => item === '/home/carryz/.config/anxin' || item === '/home/carryz/.local/share/anxin')).toBe(false);
    const link = join(a.root, 'redirected-release'); symlinkSync(release, link);
    expect(() => isolationArgs(link, a.root)).toThrow();
    unlinkSync(link);
  });
});
describe('proxy authentication and precise sources', () => {
  it('trusts proxy headers only with a loopback peer and this environment key', () => {
    const a = environment({ publicOrigin: 'http://172.23.1.127', allowCidrs: ['172.23.1.0/24'] });
    const req = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-anxin-synthetic-proxy': a.config.proxyKey, 'x-anxin-synthetic-source': '172.23.1.4' } };
    expect(requestSource(req, a.config)).toBe('172.23.1.4');
    expect(requestSource({ ...req, socket: { remoteAddress: '172.23.1.4' } }, a.config)).toBe(null);
    expect(requestSource({ ...req, headers: { ...req.headers, 'x-anxin-synthetic-proxy': 'forged' } }, a.config)).toBe(null);
    const nginx = renderNginx(a.config);
    expect(nginx.includes('listen 172.23.1.127:80;') && nginx.includes('deny all;') && !nginx.includes('include ') && nginx.includes('user www-data;')).toBe(true);
    expect(nginx.includes('proxy_set_header X-Anxin-Synthetic-Proxy ' + a.config.proxyKey) && nginx.includes('proxy_set_header X-Anxin-Synthetic-Source $remote_addr')).toBe(true);
  });
  it('rejects forged keys and excluded sources before allowing the public origin', async () => {
    const a = environment({ publicOrigin: 'http://172.23.1.127', allowCidrs: ['172.23.1.0/24'] });
    const base = await listen(createGateway(a.config, 'http://127.0.0.1:1'));
    const headers = { Host: '172.23.1.127', 'x-anxin-synthetic-proxy': a.config.proxyKey, 'x-anxin-synthetic-source': '172.23.1.4' };
    expect((await request(base + '/api/ready', { headers })).status).toBe(200);
    expect((await request(base + '/api/ready', { headers: { ...headers, 'x-anxin-synthetic-proxy': 'forged' } })).status).toBe(403);
    expect((await request(base + '/api/ready', { headers: { ...headers, 'x-anxin-synthetic-source': '219.243.58.55', 'x-forwarded-for': '172.23.1.4' } })).status).toBe(403);
    expect((await request(base + '/api/ready', { headers: { ...headers, Host: 'wrong.invalid' } })).status).toBe(400);
  });
});
describe('session boundaries and worker identity', () => {
  it('direct entry fixes the shared identity and redirects authentication without weakening request boundaries', async () => {
    const a = environment({ directEntry: true }); let clock = Date.now(), forwarded;
    const worker = await listen(createServer((req, res) => { forwarded = req.headers; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ cases: [] })); }));
    const base = await listen(createGateway(a.config, worker, { now: () => clock }));
    const headers = { Host: new URL(a.origin).host, Cookie: `${a.config.cookieName}=stale-b-cookie`, 'oai-authenticated-user-id': a.config.users[1].id, 'x-forwarded-for': 'forged' };
    const loaded = await request(base + '/api/bootstrap', { headers });
    expect(loaded.status).toBe(200);
    expect((await loaded.json()).synthetic.directEntry).toBe(true);
    expect(forwarded['oai-authenticated-user-id']).toBe(a.config.users[0].id);
    expect(decodeURIComponent(forwarded['oai-authenticated-user-full-name'])).toBe('访客');
    expect(forwarded.cookie === undefined && forwarded['x-forwarded-for'] === undefined).toBe(true);
    for (const path of ['/auth/login', '/signin-with-chatgpt', '/signout-with-chatgpt']) {
      const response = await request(base + path, { headers });
      expect(response.status).toBe(303); expect(response.headers.get('location')).toBe('/');
    }
    expect((await request(base + '/', { headers: { ...headers, Host: 'wrong.invalid' } })).status).toBe(400);
    expect((await request(base + '/api/cases', { method: 'POST', headers, body: '{}' })).status).toBe(403);
    clock = Date.parse(a.expiresAt) + 1;
    expect((await request(base + '/', { headers })).status).toBe(410);
  });
  it('caps synthetic sessions, strips forged identity/proxy headers and expires timely', async () => {
    const a = environment(); let clock = Date.now(), forwarded;
    const worker = await listen(createServer((req, res) => { forwarded = req.headers; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ cases: [], archivedCases: [], documents: [], evidence: [], messages: [] })); }));
    const base = await listen(createGateway(a.config, worker, { now: () => clock }));
    const headers = { Host: new URL(a.origin).host };
    expect((await request(base + '/api/bootstrap', { headers: { ...headers, 'oai-authenticated-user-id': a.config.users[0].id } })).status).toBe(401);
    const loginBody = new URLSearchParams(a.access.accounts[0]);
    expect((await request(base + '/auth/login', { method: 'POST', headers, body: loginBody })).status).toBe(403);
    const login = await request(base + '/auth/login', { method: 'POST', headers: { ...headers, Origin: a.origin }, body: loginBody });
    const session = login.headers.get('set-cookie');
    expect(login.status).toBe(303);
    expect(/HttpOnly; SameSite=Strict; Max-Age=1800$/.test(session) && !session.startsWith('__Host-')).toBe(true);
    const authenticated = { ...headers, Cookie: session.split(';')[0], 'oai-authenticated-user-id': 'forged', 'x-forwarded-for': 'forged', 'x-anxin-synthetic-proxy': 'forged' };
    const loaded = await request(base + '/api/bootstrap', { headers: authenticated });
    expect((await loaded.json()).synthetic.environmentId).toBe(a.environmentId);
    expect(forwarded['oai-authenticated-user-id']).toBe(a.config.users[0].id);
    expect(forwarded.cookie === undefined && forwarded['x-forwarded-for'] === undefined && forwarded['x-anxin-synthetic-proxy'] === undefined).toBe(true);
    clock += 30 * 60_000 + 1;
    expect((await request(base + '/api/health', { headers: authenticated })).status).toBe(401);
    clock = Date.parse(a.expiresAt) + 1;
    expect((await request(base + '/api/ready', { headers })).status).toBe(410);
  });
  it('refuses occupied Worker ports and unrelated 401/other-instance readiness', async () => {
    const base = await listen(createServer((_req, res) => { res.statusCode = 401; res.end('{}'); }));
    await expect(assertPortFree('127.0.0.1', Number(new URL(base).port))).rejects.toThrow();
    const child = { pid: 123, exitCode: null, signalCode: null };
    await expect(waitForWorker(child, base, 'expected-instance', 150)).rejects.toThrow('identity');
    const ready = await listen(createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end('{"environmentId":"other-instance"}'); }));
    await expect(waitForWorker(child, ready, 'expected-instance', 150)).rejects.toThrow('identity');
    await waitForWorker(child, ready, 'other-instance', 500);
    await expect(waitForWorker({ ...child, exitCode: 1 }, ready, 'other-instance', 500)).rejects.toThrow('exited');
  });
});
