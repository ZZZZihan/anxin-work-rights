// Run after npm run build. No live URL is accepted: this starts its own loopback
// Worker, disposable D1/R2 and real rules service. All documents are synthetic.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnOwnedChild, signalOwnedChild, stopChild } from './owned-http-process-group.mjs';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createMaterialService } from './material-service.mjs';

if (process.argv.length > 3 || process.argv[2]?.includes('://')) throw new Error('Usage: node scripts/material-facts-recovery-http-regression.mjs [OUTPUT.json]; no live URL accepted.');
const root = process.cwd();
const output = resolve(process.argv[2] || process.env.ANXIN_FACT_RECOVERY_REPORT || 'output/materials/http-fact-recovery.json');
await mkdir(dirname(output), { recursive: true });
await rm(output, { force: true }); // Never leave an older PASS after a failed run.
const token = randomBytes(32).toString('hex');
const owner = 'fact-recovery-synthetic-owner';
const observations = [], calls = [], cleanupFailures = [], ownedJobIds = new Set();
const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
const workerEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
let temp, worker, migrationChild, service, proxy, db, configPath, base, setupFailure;
let nextPostFault, nextGetFault, heldPost, heldGet;
const shutdown = new AbortController();
const interrupt = signal => {
  shutdown.abort(new Error(`Regression interrupted by ${signal}.`));
  heldPost?.release(); heldGet?.release();
  for (const child of [worker, migrationChild]) {
    try { signalOwnedChild(child, 'SIGTERM'); }
    catch (error) { cleanupFailures.push({ operation: 'interrupt_owned_processes', ...errorRecord(error) }); }
  }
};
const onInterrupt = () => interrupt('SIGINT');
const onTerminate = () => interrupt('SIGTERM');
process.once('SIGINT', onInterrupt); process.once('SIGTERM', onTerminate);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const sanitize = value => String(value).replaceAll(token, '[redacted]');
const errorRecord = error => ({ name: sanitize(error?.name || 'Error'), message: sanitize(error?.message || String(error)) });
const bounded = async (promise, milliseconds, message) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]); }
  finally { clearTimeout(timer); }
};
function loopback(value) {
  const url = new URL(value);
  assert(url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'Only a runner-created loopback server is allowed.');
  return url;
}
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(`http://127.0.0.1:${server.address().port}`); });
});
const headers = (user = owner) => ({ 'oai-authenticated-user-id': user, 'oai-authenticated-user-email': `${user}@synthetic.test` });
async function jsonRequest(url, init = {}) {
  assert.equal(new URL(url).hostname, '127.0.0.1');
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(25_000)]) });
  return { status: response.status, body: await response.json() };
}
const request = (path, method = 'GET', body, user = owner) => jsonRequest(`${base}${path}`, { method, headers: headers(user), ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) });
const remote = (path, method = 'GET', body) => jsonRequest(`${service.url}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const stored = id => { const row = db.prepare('SELECT revision,state_json FROM case_material_facts WHERE case_id=? AND user_id=?').get(id, owner); return row ? { revision: row.revision, state: JSON.parse(row.state_json) } : null; };
const audits = state => state.history.filter(item => item.type === 'candidates_extracted').length;
const faultGate = () => { let release, entered; const ready = new Promise(resolve => { entered = resolve; }); const blocked = new Promise(resolve => { release = resolve; }); return { ready, blocked, release, entered }; };

async function upload(caseId, suffix = '') {
  const form = new FormData(); form.set('caseId', caseId); form.set('operationId', randomUUID());
  form.set('file', new File([`合成软件恢复回归（非真实案件）${suffix}。劳动者：测试张甲。本期完整应付工资1000元。`], `synthetic-recovery${suffix}.txt`, { type: 'text/plain' }));
  const result = await request('/api/evidence', 'POST', form); assert.equal(result.status, 201);
  return result.body.evidence.id;
}
async function fixture(name) {
  const created = await request('/api/cases', 'POST', { company: `合成恢复回归-${name}`, type: '欠薪争议', description: '隔离软件回归，非真实案件。' });
  assert.equal(created.status, 201); const caseId = created.body.case.id;
  const evidenceId = await upload(caseId);
  const began = await request(`/api/evidence/${evidenceId}/analysis`, 'POST', { documentKind: 'other' }); assert.equal(began.status, 202);
  for (let attempt = 0; ; attempt++) {
    const result = await request(`/api/evidence/${evidenceId}/analysis`); assert.equal(result.status, 200);
    if (result.body.analysis.status === 'ready') break;
    assert.equal(result.body.analysis.status, 'running'); assert(attempt < 100, 'Synthetic text analysis timed out.'); await wait(50);
  }
  const path = `/api/cases/${caseId}/facts`; const initial = await request(path); assert.equal(initial.status, 200);
  return { caseId, evidenceId, path, initial: initial.body };
}
const extract = (item, current = item.initial) => request(item.path, 'POST', { action: 'extract', evidenceId: item.evidenceId, revision: current.revision, generation: current.generation });
async function complete(item) {
  let latest;
  for (let attempt = 0; attempt < 60; attempt++) {
    latest = await request(item.path);
    if (latest.status !== 200 || latest.body.state.job?.status !== 'running') return latest;
    await wait(50);
  }
  throw new Error('Recovery did not reach a terminal state.');
}
async function runScenario(name, operation) {
  shutdown.signal.throwIfAborted();
  const detail = {};
  try { await operation(detail); observations.push({ name, status: 'PASS', ...detail }); }
  catch (error) { observations.push({ name, status: 'FAIL', ...detail, failure: errorRecord(error) }); }
  finally { nextPostFault = undefined; nextGetFault = undefined; heldPost?.release(); heldGet?.release(); heldPost = undefined; heldGet = undefined; }
}
async function cleanup(name, operation) { try { await operation(); } catch (error) { cleanupFailures.push({ operation: name, ...errorRecord(error) }); } }
async function migrations() {
  shutdown.signal.throwIfAborted();
  const child = spawnOwnedChild(process.execPath, [wrangler, 'd1', 'migrations', 'apply', 'DB', '--local', '--config', configPath, '--persist-to', join(temp, 'state')], { cwd: root, env: workerEnv, stdio: 'ignore' });
  migrationChild = child;
  let migrationFailure;
  try { await bounded(new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Isolated migrations exited ${code}.`))); }), 60_000, 'Isolated migrations timed out.'); }
  catch (error) { migrationFailure = error; throw error; }
  finally {
    try { await stopChild(child, 'Migration'); migrationChild = undefined; }
    catch (error) {
      cleanupFailures.push({ operation: 'stop_migration', ...errorRecord(error) });
      if (!migrationFailure) throw error;
    }
  }
}
async function startWorker() {
  shutdown.signal.throwIfAborted();
  const probe = createServer(); base = await listen(probe); const port = new URL(base).port; await new Promise(resolve => probe.close(resolve)); loopback(base);
  shutdown.signal.throwIfAborted();
  worker = spawnOwnedChild(process.execPath, [wrangler, 'dev', '--local', '--config', configPath, '--persist-to', join(temp, 'state'), '--ip', '127.0.0.1', '--port', port], { cwd: root, env: workerEnv, stdio: 'ignore' });
  let startError; worker.once('error', error => { startError = error; });
  for (let attempt = 0; attempt < 100; attempt++) {
    shutdown.signal.throwIfAborted();
    if (startError) throw startError;
    if (worker.exitCode !== null || worker.signalCode !== null) throw new Error('Isolated Worker stopped before readiness.');
    try { const response = await fetch(`${base}/api/bootstrap`, { signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(1000)]) }); await response.arrayBuffer(); if (response.status === 401) return; } catch { /* Bounded startup of the runner-owned server. */ }
    await wait(200);
  }
  throw new Error('Isolated Worker startup timed out.');
}

try {
  temp = await mkdtemp(join(tmpdir(), 'anxin-fact-recovery-http-'));
  service = await createMaterialService({ token, facts: { backend: 'rules' } }); loopback(service.url);
  proxy = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) { req.resume(); res.writeHead(401); res.end('{}'); return; }
    const target = new URL(req.url, service.url);
    if (target.origin !== new URL(service.url).origin || !req.url.startsWith('/') || req.url.startsWith('//')) { req.resume(); res.writeHead(400); res.end('{}'); return; }
    let entry;
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk); const bytes = Buffer.concat(chunks);
      const isPost = req.method === 'POST' && target.pathname === '/fact-jobs';
      const isGet = req.method === 'GET' && /^\/fact-jobs\//.test(target.pathname);
      const payload = isPost ? JSON.parse(bytes.toString('utf8')) : null;
      if (isPost || isGet || req.method === 'DELETE') { entry = { method: req.method, path: target.pathname, authenticated: true }; calls.push(entry); }
      const postFault = isPost ? nextPostFault : null; if (isPost) nextPostFault = undefined;
      if (isPost) { entry.requestedJobId = payload.jobId ?? null; if (payload.jobId) ownedJobIds.add(payload.jobId); }
      if (postFault === 'hold_before_forward') { const gate = heldPost; gate.payload = payload; gate.entered(); await gate.blocked; }
      const response = await fetch(target, { method: req.method, headers: { Authorization: `Bearer ${token}`, ...(req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {}) }, signal: AbortSignal.timeout(20_000), redirect: 'error', ...(bytes.length ? { body: bytes } : {}) });
      const result = Buffer.from(await response.arrayBuffer()); if (entry) entry.upstreamStatus = response.status;
      if (isPost && response.status === 202) { entry.acceptedJobId = JSON.parse(result.toString('utf8')).jobId; ownedJobIds.add(entry.acceptedJobId); }
      if (postFault === '503_after_accept' || postFault === 'drop_after_accept') {
        assert.equal(response.status, 202, 'A lost reply must follow a genuinely accepted service POST.'); entry.fault = postFault;
        if (postFault === 'drop_after_accept') { res.destroy(); return; }
        res.writeHead(503, { 'Content-Type': 'application/json' }); res.end('{"error":"synthetic lost POST acknowledgement"}'); return;
      }
      if (isGet && nextGetFault?.jobId === target.pathname.split('/').at(-1)) {
        const fault = nextGetFault; nextGetFault = undefined; entry.fault = fault.type;
        if (fault.type === 'hold_ready') { assert.equal(JSON.parse(result).status, 'ready'); const gate = heldGet; gate.entered(); await gate.blocked; }
        else { res.writeHead(fault.type === '503_once' ? 503 : 200, { 'Content-Type': 'application/json' }); res.end(fault.type === '503_once' ? '{"error":"synthetic transient read failure"}' : '{invalid synthetic json'); return; }
      }
      res.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') || 'application/json' }); res.end(result);
    } catch { if (entry) entry.proxyFailure = true; if (!res.destroyed && !res.headersSent) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end('{}'); } else res.destroy(); }
  });
  const proxyUrl = await listen(proxy); loopback(proxyUrl);
  const originalPath = resolve(root, 'dist/server/wrangler.json'); const config = JSON.parse(await readFile(originalPath, 'utf8'));
  config.main = resolve(dirname(originalPath), config.main); if (config.assets?.directory) config.assets.directory = resolve(dirname(originalPath), config.assets.directory);
  for (const item of config.d1_databases ?? []) item.migrations_dir = resolve(root, 'drizzle');
  config.vars = { ...config.vars, ANXIN_MATERIAL_SERVICE_URL: proxyUrl, ANXIN_MATERIAL_SERVICE_TOKEN: token };
  configPath = join(temp, 'wrangler.json'); await writeFile(configPath, JSON.stringify(config), { mode: 0o600 }); await migrations();
  for (const path of (await readdir(join(temp, 'state'), { recursive: true })).filter(path => path.endsWith('.sqlite'))) {
    const candidate = new DatabaseSync(join(temp, 'state', path)); if (candidate.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cases'").get()) { db = candidate; break; } candidate.close();
  }
  assert(db, 'Disposable persistent D1 file must exist.'); db.exec('PRAGMA busy_timeout=5000'); await startWorker();

  await runScenario('definitive_real_service_capacity_rejection_is_terminal_and_explicit_retry_recovers', async detail => {
    const item = await fixture('queue-capacity-rejection'), occupied = [];
    const source = { id: 'synthetic-capacity-source', name: 'synthetic.txt', sha256: 'd'.repeat(64), analysisRevision: 1, ready: true,
      blocks: [{ id: 'b1', page: 1, text: '合成容量回归：本期完整应付工资1000元。' }] };
    try {
      // Fill the actual service's bounded result records. No HTTP status is
      // fabricated: admission itself must return 429 before reserving the UUID.
      for (let index = 0; index < 32; index++) {
        const jobId = randomUUID(); occupied.push(jobId); ownedJobIds.add(jobId);
        const admitted = await remote('/fact-jobs', 'POST', { jobId, source }); assert.equal(admitted.status, 202);
      }
      const start = calls.length, rejected = await extract(item), row = stored(item.caseId);
      const submission = calls.slice(start).find(call => call.method === 'POST');
      const missing = await remote(`/fact-jobs/${submission.requestedJobId}`);
      Object.assign(detail, { admissionStatus: submission.upstreamStatus, extractionHttpStatus: rejected.status,
        rejectedJobId: submission.requestedJobId, remoteLookupStatus: missing.status, storedJob: row.state.job });
      assert.equal(submission.upstreamStatus, 429); assert.equal(missing.status, 404);
      assert.equal(rejected.status, 200, 'A definitive service rejection must return a terminal snapshot, never accepted/running.');
      assert.equal(row.state.job.status, 'failed'); assert.match(row.state.job.error, /稍后|繁忙|其他材料|已满/u);
      assert.equal(row.state.materials.length, 0); assert.equal(audits(row.state), 0); assert.equal(rejected.body.canCalculate, false);
      const reread = await request(item.path); assert.equal(reread.status, 200); assert.equal(reread.body.state.job.status, 'failed');
      detail.nonexistentJobPolls = calls.slice(start).filter(call => call.method === 'GET' && call.path === `/fact-jobs/${submission.requestedJobId}`).length;
      assert.equal(detail.nonexistentJobPolls, 0, 'A known rejected submission must not enter the lost-response recovery window.');
      for (const id of occupied.splice(0)) await remote(`/fact-jobs/${id}`, 'DELETE');
      const retried = await extract(item, reread.body); assert.equal(retried.status, 202);
      assert.notEqual(retried.body.state.job.id, submission.requestedJobId);
      const final = await complete(item); assert.equal(final.status, 200); assert.equal(final.body.state.job, null);
      assert.equal(final.body.state.materials.length, 1); assert.equal(audits(final.body.state), 1);
      detail.explicitRetryStatus = retried.status; detail.finalMaterialCount = final.body.state.materials.length;
      detail.servicePostCount = calls.slice(start).filter(call => call.method === 'POST').length;
      assert.equal(detail.servicePostCount, 2, 'Only the user-requested retry may issue another POST.');
    } finally { for (const id of occupied) await remote(`/fact-jobs/${id}`, 'DELETE'); }
  });

  for (const fault of ['503_after_accept', 'drop_after_accept']) await runScenario(`recover_accepted_POST_${fault}`, async detail => {
    const item = await fixture(fault); const start = calls.length; nextPostFault = fault;
    const began = await extract(item); const persisted = stored(item.caseId); const submission = calls.slice(start).find(call => call.method === 'POST');
    detail.startHttpStatus = began.status; detail.startJob = persisted?.state.job; detail.acceptedJobId = submission?.acceptedJobId; detail.requestedJobId = submission?.requestedJobId;
    const final = await complete(item); detail.finalHttpStatus = final.status; detail.finalJob = final.body.state?.job ?? null; detail.materialCount = final.body.state?.materials.length ?? null; detail.extractionAuditCount = final.body.state ? audits(final.body.state) : null;
    detail.servicePostCount = calls.slice(start).filter(call => call.method === 'POST').length;
    assert.equal(submission?.upstreamStatus, 202); assert.match(persisted?.state.job?.id ?? '', uuid, 'Worker must persist the caller UUID before dispatch.');
    assert.equal(persisted.state.job.id, submission.acceptedJobId); assert.equal(persisted.state.job.id, submission.requestedJobId); assert.equal(persisted.state.job.status, 'running');
    assert([200, 202].includes(began.status)); assert.equal(final.status, 200); assert.equal(final.body.state.job, null); assert.equal(final.body.state.materials.length, 1); assert.equal(audits(final.body.state), 1); assert.equal(detail.servicePostCount, 1, 'Read recovery must not create another service job.');
    assert.equal(final.body.canCalculate, false); assert.equal(final.body.state.scope, null); assert.deepEqual(final.body.state.confirmations, { due: null, paid: null });
  });

  for (const type of ['503_once', 'invalid_json_once']) await runScenario(`transient_GET_${type}_does_not_cancel_healthy_job`, async detail => {
    const item = await fixture(type); const began = await extract(item); assert.equal(began.status, 202); const jobId = began.body.state.job.id; const start = calls.length;
    nextGetFault = { jobId, type }; const first = await request(item.path); const afterError = stored(item.caseId); const live = await remote(`/fact-jobs/${jobId}`);
    Object.assign(detail, { firstHttpStatus: first.status, persistedJobAfterError: afterError?.state.job, serviceStatusAfterError: live.status, serviceDeletesBeforeRecovery: calls.slice(start).filter(call => call.method === 'DELETE').length });
    const final = await complete(item); detail.finalJob = final.body.state?.job ?? null; detail.materialCount = final.body.state?.materials.length ?? null; detail.extractionAuditCount = final.body.state ? audits(final.body.state) : null;
    assert([200, 503].includes(first.status)); assert.equal(afterError?.state.job?.status, 'running'); assert.equal(afterError.state.job.id, jobId); assert.equal(live.status, 200); assert.equal(detail.serviceDeletesBeforeRecovery, 0);
    assert.equal(final.status, 200); assert.equal(final.body.state.job, null); assert.equal(final.body.state.materials.length, 1); assert.equal(audits(final.body.state), 1);
  });

  await runScenario('DELETE_unknown_UUID_prevents_delayed_POST_resurrection', async detail => {
    const jobId = randomUUID(); ownedJobIds.add(jobId);
    const source = { id: 'synthetic-tombstone-source', name: 'synthetic.txt', sha256: 'a'.repeat(64), analysisRevision: 1, ready: true, blocks: [{ id: 'b1', page: 1, text: '合成软件回归：本期完整应付工资1000元。' }] };
    const removed = await remote(`/fact-jobs/${jobId}`, 'DELETE'); const late = await remote('/fact-jobs', 'POST', { jobId, source }); const found = await remote(`/fact-jobs/${jobId}`);
    Object.assign(detail, { deleteStatus: removed.status, delayedPostStatus: late.status, lookupStatus: found.status });
    assert.equal(removed.status, 200); assert.equal(late.status, 410, 'A valid delayed submission must be rejected by a cancellation tombstone, not generic payload validation.'); assert.equal(found.status, 404);
  });

  await runScenario('same_UUID_is_idempotent_but_cannot_be_rebound_to_another_source', async detail => {
    const jobId = randomUUID(); ownedJobIds.add(jobId);
    const source = { id: 'synthetic-idempotent-source', name: 'synthetic.txt', sha256: 'b'.repeat(64), analysisRevision: 1, ready: true, blocks: [{ id: 'b1', page: 1, text: '合成软件回归：本期完整应付工资1000元。' }] };
    const first = await remote('/fact-jobs', 'POST', { jobId, source }); const second = await remote('/fact-jobs', 'POST', { jobId, source }); const changed = await remote('/fact-jobs', 'POST', { jobId, source: { ...source, sha256: 'c'.repeat(64) } }); const found = await remote(`/fact-jobs/${jobId}`);
    Object.assign(detail, { firstStatus: first.status, retryStatus: second.status, reboundStatus: changed.status, firstJobId: first.body.jobId ?? null, retryJobId: second.body.jobId ?? null, lookupStatus: found.status });
    assert.equal(first.status, 202); assert.equal(second.status, 202); assert.equal(first.body.jobId, jobId); assert.equal(second.body.jobId, jobId); assert.equal(changed.status, 409); assert.equal(found.status, 200);
  });

  await runScenario('source_change_while_POST_is_in_flight_cannot_restore_old_job', async detail => {
    const item = await fixture('source-change-submit'); heldPost = faultGate(); const gate = heldPost; nextPostFault = 'hold_before_forward';
    const pending = extract(item);
    void pending.catch(() => undefined); // Hold ownership without an unhandled rejection before the finally await.
    try {
      await bounded(gate.ready, 8000, 'Submission did not reach the proxy.'); const before = stored(item.caseId); detail.claimedJobId = before?.state.job?.id ?? null;
      await upload(item.caseId, '-changed-before-submit'); const refreshed = await request(item.path); assert.equal(refreshed.status, 200); detail.newGeneration = refreshed.body.generation;
      gate.release(); const late = await pending; const current = await request(item.path); const active = stored(item.caseId); const id = gate.payload.jobId; const remoteState = id ? await remote(`/fact-jobs/${id}`) : null;
      Object.assign(detail, { latePostHttpStatus: late.status, currentGeneration: current.body.generation, currentJob: active?.state.job ?? null, currentMaterials: active?.state.materials.length ?? null, extractionAuditCount: active ? audits(active.state) : null, oldRemoteStatus: remoteState?.status ?? null });
      assert.match(detail.claimedJobId ?? '', uuid); assert.equal(late.status, 409); assert.equal(current.status, 200); assert(current.body.generation > item.initial.generation); assert.equal(current.body.state.job, null); assert.equal(current.body.state.materials.length, 0); assert.equal(audits(current.body.state), 0); assert.equal(remoteState.status, 404);
    } finally { gate.release(); await bounded(pending, 25_000, 'Delayed POST did not settle.'); }
  });

  await runScenario('old_ready_GET_cannot_restore_results_after_source_change', async detail => {
    const item = await fixture('source-change-poll'); const began = await extract(item); assert.equal(began.status, 202); const jobId = began.body.state.job.id;
    heldGet = faultGate(); const gate = heldGet; nextGetFault = { jobId, type: 'hold_ready' }; const pending = request(item.path);
    void pending.catch(() => undefined);
    try {
      await bounded(gate.ready, 8000, 'Ready result did not reach the proxy.'); await upload(item.caseId, '-changed-before-read'); const refreshed = await request(item.path); assert.equal(refreshed.status, 200);
      gate.release(); const late = await pending; const current = await request(item.path);
      Object.assign(detail, { lateReadHttpStatus: late.status, newGeneration: current.body.generation, currentJob: current.body.state?.job ?? null, materialCount: current.body.state?.materials.length ?? null, extractionAuditCount: current.body.state ? audits(current.body.state) : null });
      assert.equal(late.status, 409); assert.equal(current.status, 200); assert(current.body.generation > item.initial.generation); assert.equal(current.body.state.job, null); assert.equal(current.body.state.materials.length, 0); assert.equal(audits(current.body.state), 0);
    } finally { gate.release(); await bounded(pending, 25_000, 'Delayed GET did not settle.'); }
  });

  await runScenario('owner_and_unauthenticated_boundaries_remain_enforced', async detail => {
    const item = await fixture('isolation'); const foreign = await request(item.path, 'GET', undefined, 'foreign-synthetic-user'); const anonymous = await jsonRequest(`${base}${item.path}`);
    Object.assign(detail, { foreignStatus: foreign.status, anonymousStatus: anonymous.status }); assert.equal(foreign.status, 404); assert.equal(anonymous.status, 401);
  });
} catch (error) { setupFailure = errorRecord(error); }
finally {
  heldPost?.release(); heldGet?.release();
  await cleanup('stop_worker', () => stopChild(worker, 'Worker'));
  await cleanup('close_database', () => db?.close());
  await cleanup('close_fault_proxy', async () => { if (!proxy) return; proxy.closeAllConnections(); await bounded(new Promise(resolve => proxy.close(resolve)), 5000, 'Fault proxy did not close.'); });
  await cleanup('cancel_owned_service_jobs', async () => { if (service && !shutdown.signal.aborted) for (const id of ownedJobIds) await remote(`/fact-jobs/${id}`, 'DELETE'); });
  await cleanup('close_real_rules_service', async () => { if (service) await bounded(service.close(), 10_000, 'Real rules service did not close.'); });
  await cleanup('remove_temporary_D1_R2_and_private_configuration', async () => {
    if (temp && cleanupFailures.some(item => ['stop_worker', 'stop_migration'].includes(item.operation))) {
      throw new Error(`Owned process shutdown was not confirmed; isolated resources retained at ${temp}.`);
    }
    if (temp) await rm(temp, { recursive: true, force: true });
  });
  process.removeListener('SIGINT', onInterrupt); process.removeListener('SIGTERM', onTerminate);
  const failed = !!setupFailure || !!cleanupFailures.length || observations.length !== 10 || observations.some(item => item.status !== 'PASS');
  await writeFile(output, JSON.stringify({ status: failed ? 'FAIL' : 'PASS', mode: 'fact-network-recovery', boundary: 'production Worker HTTP + disposable persistent D1/R2 + real rules service + controlled authenticated loopback fault proxy', actualModelInference: false, syntheticInputs: true, recordedAt: new Date().toISOString(), observations, setupFailure, cleanup: { status: cleanupFailures.length ? 'FAIL' : 'PASS', failures: cleanupFailures }, calls, limitation: 'Service caller-ID idempotency and cancellation tombstones are process-local and bounded by their configured TTL/capacity; this runner does not claim persistence across service restart or actual model inference.' }, null, 2) + '\n');
  console[failed ? 'error' : 'log'](JSON.stringify({ status: failed ? 'FAIL' : 'PASS', mode: 'fact-network-recovery', passed: observations.filter(item => item.status === 'PASS').length, failed: observations.filter(item => item.status === 'FAIL').length, output }));
  if (failed) process.exitCode = 1;
}
