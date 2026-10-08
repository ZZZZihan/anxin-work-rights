// This creates and removes only its own marked, disposable loopback environment.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { request as rawRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createEnvironment, loadEnvironment, removeEnvironment } from '../deploy/synthetic-http/environment.mjs';
import { assertPortFree } from '../deploy/synthetic-http/server.mjs';

const output = process.argv[2];
const observations = [];
const observe = (check, detail = {}) => observations.push({ check, ...detail });
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function freePort() {
  const server = createServer();
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}
const item = createEnvironment({ port: await freePort(), workerPort: await freePort(), ttlMinutes: 30 });
const config = loadEnvironment(item.root);
const access = JSON.parse(readFileSync(join(item.root, 'access.json')));
for (const directory of ['home', 'cache']) mkdirSync(join(item.root, directory), { mode: 0o700 });
let child, workerPid, log = '', exit;
function launch() {
  workerPid = undefined; log = ''; exit = undefined;
  child = spawn(process.execPath, [resolve('deploy/synthetic-http/server.mjs'), item.root], {
    cwd: process.cwd(), env: { ...process.env, HOME: join(item.root, 'home'), XDG_CACHE_HOME: join(item.root, 'cache'), WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
    log += chunk.toString();
    for (const line of log.split('\n')) {
      try { const record = JSON.parse(line); if (record.synthetic === true && record.environmentId === item.environmentId) workerPid = record.worker; } catch { /* Wrangler progress */ }
    }
  });
  child.once('exit', (code, signal) => { exit = { code, signal }; });
  child.once('error', () => { exit = { code: 1, signal: null }; });
}
async function waitReady() {
  const deadline = Date.now() + 80_000;
  while (Date.now() < deadline && !exit) {
    try {
      const ready = await fetch(item.origin + '/api/ready', { signal: AbortSignal.timeout(500) });
      if (ready.ok && (await ready.json()).environmentId === item.environmentId && workerPid) return;
    } catch { /* bounded startup */ }
    await pause(100);
  }
  throw new Error('Disposable synthetic startup failed; inspect its private fixture/log.');
}
async function waitExit(expected) {
  const deadline = Date.now() + 8_000;
  while (!exit && Date.now() < deadline) await pause(50);
  assert.equal(exit?.code, expected, 'Synthetic parent should terminate promptly.');
  assert.equal(existsSync(join(item.root, '.runtime.json')), false);
  await assertPortFree('127.0.0.1', config.port);
  await assertPortFree('127.0.0.1', config.workerPort);
}
const cookies = {};
const cookieLifetimes = [];
async function request(path, user = 'a', method = 'GET', value, extra = {}) {
  const headers = { ...(cookies[user] ? { Cookie: cookies[user] } : {}), ...(method !== 'GET' ? { Origin: item.origin } : {}), ...extra };
  if (value && !(value instanceof FormData)) headers['Content-Type'] = 'application/json';
  return fetch(item.origin + path, { method, headers, body: value instanceof FormData ? value : value === undefined ? undefined : JSON.stringify(value), redirect: 'manual', signal: AbortSignal.timeout(15_000) });
}
async function login(key, index) {
  const began = Date.now();
  const response = await fetch(item.origin + '/auth/login', { method: 'POST', headers: { Origin: item.origin }, body: new URLSearchParams(access.accounts[index]), redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, 303);
  const cookie = response.headers.get('set-cookie');
  const age = Number(cookie.match(/Max-Age=(\d+)$/)?.[1]);
  const remainingBefore = Math.min(1800, Math.floor((Date.parse(item.expiresAt) - began) / 1000));
  const remainingAfter = Math.min(1800, Math.floor((Date.parse(item.expiresAt) - Date.now()) / 1000));
  assert.equal(cookie.startsWith(config.cookieName + '=') && cookie.includes('HttpOnly; SameSite=Strict;') && age > 0 && age <= remainingBefore + 1 && age >= remainingAfter - 2, true);
  cookieLifetimes.push({ age, remainingBefore, remainingAfter });
  cookies[key] = cookie.split(';')[0];
}
async function upload(caseId, operationId, bytes = 'synthetic HTTP evidence') {
  const form = new FormData(); form.append('caseId', caseId); form.append('operationId', operationId);
  form.append('file', new File([bytes], 'synthetic.txt', { type: 'text/plain' }));
  return request('/api/evidence', 'a', 'POST', form);
}
try {
  launch(); await waitReady(); observe('own_worker_identity_ready');
  assert.throws(() => removeEnvironment(item.root, item.environmentId)); observe('live_cleanup_refused');
  assert.equal((await request('/api/bootstrap', null, 'GET', undefined, { 'oai-authenticated-user-id': config.users[0].id })).status, 401); observe('forged_identity_cannot_login');
  const wrongHostStatus = await new Promise((done, fail) => {
    const req = rawRequest(item.origin + '/api/ready', { headers: { Host: 'other.invalid' } }, (res) => { res.resume(); res.once('end', () => done(res.statusCode)); });
    req.once('error', fail); req.end();
  });
  assert.equal(wrongHostStatus, 400); observe('host_boundary');
  assert.equal((await request('/api/cases', null, 'POST', {}, { Origin: 'http://other.invalid' })).status, 403); observe('origin_boundary');
  assert.equal((await request('/api/synthetic-ready', null)).status, 404); observe('worker_identity_endpoint_not_proxied');
  await login('a', 0); await login('b', 1); observe('separate_synthetic_logins_cookie_policy', { cookieLifetimes });
  const bootstrap = await (await request('/api/bootstrap')).json();
  assert.equal(bootstrap.synthetic.environmentId, item.environmentId);
  assert.equal(bootstrap.cases.length + bootstrap.evidence.length + bootstrap.documents.length, 0); observe('fresh_marked_d1_r2');
  const created = await request('/api/cases', 'a', 'POST', { company: 'SYNTHETIC HTTP 专用单位', type: '欠薪争议', amount: '3000' });
  assert.equal(created.status, 201); const workCase = (await created.json()).case; observe('create_case');
  const b = await (await request('/api/bootstrap', 'b', 'GET', undefined, { 'oai-authenticated-user-id': config.users[0].id })).json();
  assert.equal(b.cases.length, 0);
  assert.equal((await request('/api/cases', 'b', 'PATCH', { id: workCase.id, currentStep: 1 })).status, 404); observe('identity_stripping_and_user_isolation');
  const draftBody = { caseId: workCase.id, type: 'fact-timeline', fields: { title: '合成记录' }, revision: 0 };
  const saved = await request('/api/documents', 'a', 'PUT', draftBody); assert.equal(saved.status, 200);
  assert.equal((await saved.json()).document.revision, 1);
  assert.equal((await request('/api/documents', 'a', 'PUT', draftBody)).status, 409); observe('draft_save_revision_conflict');
  const operationId = randomUUID();
  const uploaded = await upload(workCase.id, operationId); assert.equal(uploaded.status, 201);
  assert.equal((await upload(workCase.id, operationId)).status, 200);
  assert.equal((await upload(workCase.id, operationId, 'changed')).status, 409); observe('upload_operation_idempotency');
  const download = await request(`/api/evidence/${operationId}/download`);
  assert.equal(download.status, 200); assert.equal(await download.text(), 'synthetic HTTP evidence'); observe('download_exact_bytes');
  assert.equal((await request(`/api/evidence/${operationId}/download`, 'b')).status, 404); observe('cross_user_download_refused');
  assert.equal((await request('/api/chat', 'a', 'POST', { caseId: workCase.id, message: '合成工资材料如何整理？' })).status, 201); observe('synthetic_chat_saved');
  assert.equal((await request('/api/cases', 'a', 'PATCH', { id: workCase.id, status: 'archived' })).status, 200);
  assert.equal((await request('/api/cases', 'a', 'PATCH', { id: workCase.id, status: 'collecting' })).status, 200);
  const restored = await (await request('/api/bootstrap')).json();
  assert.equal(restored.cases.length, 1); assert.equal(restored.evidence.length, 1); assert.equal(restored.documents.length, 1); assert.equal(restored.messages.length, 2); observe('archive_restore_children_preserved');
  assert.equal(Number.isInteger(workerPid) && workerPid !== child.pid, true);
  process.kill(workerPid, 'SIGTERM'); await waitExit(1); observe('worker_exit_parent_ends_and_marker_clears');
  launch(); await waitReady();
  const reopened = await (await request('/api/bootstrap')).json();
  assert.equal(reopened.cases[0].id, workCase.id); assert.equal(reopened.evidence[0].id, operationId); observe('restart_preserves_own_state');
  child.kill('SIGTERM'); await waitExit(0); observe('graceful_stop_ports_and_marker_clear');
  removeEnvironment(item.root, item.environmentId); assert.equal(existsSync(item.root), false); observe('exact_marked_stopped_cleanup');
  console.log(JSON.stringify({ passed: observations.length, observations }, null, 2));
} catch (error) {
  process.exitCode = 1;
  console.error(error.message);
} finally {
  if (child && !exit) {
    child.kill('SIGTERM');
    const deadline = Date.now() + 8_000;
    while (!exit && Date.now() < deadline) await pause(50);
  }
  if (existsSync(item.root) && !existsSync(join(item.root, '.runtime.json'))) removeEnvironment(item.root, item.environmentId);
  if (output) {
    writeFileSync(output, JSON.stringify({ passed: observations.length, complete: observations.length === 20, observations, fixtureRoot: item.root, fixtureRemoved: !existsSync(item.root) }, null, 2));
    writeFileSync(output.replace(/\.json$/, '.worker.log'), log);
  }
}
