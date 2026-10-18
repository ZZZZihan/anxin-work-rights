// Run after npm run build, from the project root:
// node scripts/material-facts-cancel-http-regression.mjs [OUTPUT.json]
// ANXIN_MATERIAL_CANCEL_REPORT also selects the report path. This runner creates
// its own loopback Worker, D1/R2 and rules service; it never accepts a live URL.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnOwnedChild, stopChild } from './owned-http-process-group.mjs';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createMaterialService } from './material-service.mjs';

if (process.argv.length > 3) throw new Error('Usage: node scripts/material-facts-cancel-http-regression.mjs [OUTPUT.json]');
const root = process.cwd();
const output = resolve(process.argv[2] || process.env.ANXIN_MATERIAL_CANCEL_REPORT || 'output/materials/http-fact-cancel.json');
await mkdir(dirname(output), { recursive: true });
await rm(output, { force: true }); // A failed run must not leave an older PASS.

const owner = 'fact-cancel-http-owner';
const token = randomBytes(32).toString('hex');
const observations = [];
const calls = [];
const cleanupFailures = [];
const workerRuns = [];
const workerEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false' };
const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
let temp, worker, workerError, migrationChild, service, proxy, db, configPath, base;
let failure, phase = 'setup', mode = 'normal';
let holdGetJob, pollEntered, releaseHeldPoll, pendingPoll;

const sanitize = value => {
  let text = String(value).replaceAll(token, '[redacted]');
  // Wrangler abbreviates long bindings (for example, a token prefix + "...").
  // Redact known-token fragments too, rather than assuming complete printing.
  for (let length = token.length - 1; length >= 8; length--) {
    text = text.replaceAll(token.slice(0, length), '[redacted]').replaceAll(token.slice(-length), '[redacted]');
  }
  return text;
};
const errorRecord = error => ({ name: sanitize(error?.name || 'Error'), message: sanitize(error?.message || String(error)) });
const workerLogLimit = 32_000;
const capturedLog = () => ({ text: '', truncated: false });
const appendLog = (log, chunk) => {
  const text = log.text + chunk;
  log.truncated ||= text.length > workerLogLimit;
  log.text = text.slice(0, workerLogLimit);
};
const safeLog = log => {
  let text = sanitize(log.text);
  // Truncation or early process exit can end inside the private token. Remove
  // a trailing partial token after whole-token replacement, even on short logs.
  for (let length = token.length - 1; length > 0; length--) {
    if (text.endsWith(token.slice(0, length))) { text = text.slice(0, -length) + '[redacted]'; break; }
  }
  return { text, truncated: log.truncated };
};
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const bounded = async (promise, milliseconds, message) => {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
};
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    server.removeListener('error', reject);
    resolve(`http://127.0.0.1:${server.address().port}`);
  });
});
const observe = (name, detail = {}) => observations.push({ name, status: 'PASS', ...detail });
const headers = (user = owner) => ({ 'oai-authenticated-user-id': user, 'oai-authenticated-user-email': `${user}@synthetic.test` });
const jsonRequest = async (url, init = {}) => {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  return { status: response.status, body: await response.json() };
};
const request = (path, body, user) => jsonRequest(`${base}${path}`, {
  method: body === undefined ? 'GET' : 'PATCH', headers: headers(user),
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const row = id => db.prepare('SELECT state_json FROM case_material_facts WHERE case_id=?').get(id);
const queue = () => db.prepare('SELECT user_id,case_id,job_id FROM case_material_fact_cleanup ORDER BY user_id,case_id,job_id').all();
const caseQueue = id => queue().filter(item => item.case_id === id && item.user_id === owner);
const generation = id => db.prepare('SELECT generation FROM case_material_generations WHERE case_id=?').get(id).generation;

function seed(id, jobId, privateMarker = false) {
  const state = {
    version: 1, generation: generation(id), scope: null, scopeReview: null,
    confirmations: { due: null, paid: null }, materials: [], history: [], calculation: null,
    job: { id: jobId, evidenceId: 'synthetic-source', generation: generation(id), status: 'running', error: null },
  };
  if (privateMarker) state.materials = [{ raw: 'synthetic private text must be erased on invalidation' }];
  db.prepare(`INSERT INTO case_material_facts(case_id,user_id,revision,state_json,updated_at)
    VALUES (?, ?, 1, ?, ?) ON CONFLICT(case_id) DO UPDATE SET state_json=excluded.state_json,revision=revision+1`)
    .run(id, owner, JSON.stringify(state), new Date().toISOString());
}

async function createCase(company) {
  const response = await jsonRequest(`${base}/api/cases`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ company, type: '欠薪争议' }),
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.case.id;
}

async function uploadEvidence(caseId) {
  const form = new FormData();
  form.set('caseId', caseId);
  form.set('operationId', randomUUID());
  form.set('file', new File(['合成删除回归材料：本期工资1000元。'], 'synthetic-delete.txt', { type: 'text/plain' }));
  const response = await jsonRequest(`${base}/api/evidence`, { method: 'POST', headers: headers(), body: form });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.evidence.id;
}

const deleteEvidence = (id, user) => jsonRequest(`${base}/api/evidence?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: headers(user) });

async function createJob() {
  const source = {
    id: 'synthetic-source', name: 'synthetic.txt', sha256: 'a'.repeat(64), analysisRevision: 1, ready: true,
    blocks: [{ id: 'b1', page: 1, text: '合成软件测试：本期完整应付工资1000元。' }],
  };
  const response = await jsonRequest(`${service.url}/fact-jobs`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ source }),
  });
  assert.equal(response.status, 202);
  return response.body.jobId;
}

async function remoteStatus(id) {
  const response = await fetch(`${service.url}/fact-jobs/${id}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000),
  });
  await response.arrayBuffer();
  return response.status;
}

async function applyMigrations() {
  const child = migrationChild = spawnOwnedChild(process.execPath, [wrangler, 'd1', 'migrations', 'apply', 'DB', '--local', '--config', configPath, '--persist-to', join(temp, 'state')], {
    cwd: root, stdio: 'ignore', env: workerEnv,
  });
  let migrationFailure;
  try {
    await bounded(new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Isolated D1 migration failed (${code}).`)));
    }), 60_000, 'Isolated D1 migrations timed out.');
  } catch (error) { migrationFailure = error; throw error; }
  finally {
    try { await stopChild(child, 'Isolated migration'); migrationChild = undefined; }
    catch (error) { cleanupFailures.push({ operation: 'stop_migration', ...errorRecord(error) }); if (!migrationFailure) throw error; }
  }
}

async function startWorker() {
  const probe = createServer();
  const free = await listen(probe);
  const port = Number(new URL(free).port);
  await new Promise(resolve => probe.close(resolve));
  workerError = undefined;
  const run = { index: workerRuns.length + 1, httpPort: port, inspectorPort: 0, startedAt: new Date().toISOString(), ready: false, exitCode: null, signal: null, stdout: capturedLog(), stderr: capturedLog() };
  workerRuns.push(run);
  // Wrangler's supported port 0 lets the OS allocate an inspector socket
  // atomically. A restart must not share the default inspector's port probe.
  worker = spawnOwnedChild(process.execPath, [wrangler, 'dev', '--local', '--config', configPath, '--persist-to', join(temp, 'state'), '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', '0'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: workerEnv, detached: process.platform !== 'win32',
  });
  const child = worker;
  run.pid = child.pid ?? null;
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => appendLog(run.stdout, chunk));
  child.stderr.on('data', chunk => appendLog(run.stderr, chunk));
  child.once('exit', (code, signal) => { run.exitCode = code; run.signal = signal; });
  child.once('close', () => { run.closedAt = new Date().toISOString(); });
  worker.once('error', error => { workerError = error; });
  base = free;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (workerError) throw workerError;
    if (worker.exitCode !== null || worker.signalCode !== null) throw new Error(`Isolated Worker exited before readiness (attempt ${run.index}, exit ${worker.exitCode}, signal ${worker.signalCode}). See workerRuns diagnostics.`);
    try {
      const response = await fetch(`${base}/api/bootstrap`, { signal: AbortSignal.timeout(1000) });
      await response.arrayBuffer();
      if (response.status === 401) { run.ready = true; return; }
    } catch { /* bounded startup; this URL was allocated by the runner */ }
    await wait(250);
  }
  throw new Error('Isolated Worker readiness timed out.');
}

async function stopWorker() {
  if (!worker) return;
  await stopChild(worker, 'Isolated Worker');
  worker = undefined;
}

async function cleanup(name, operation) {
  try { await operation(); }
  catch (error) { cleanupFailures.push({ operation: name, ...errorRecord(error) }); }
}

try {
  // Read only the local build and replace its service binding with this run's
  // private service. The temporary config is mode 0600 inside mkdtemp's 0700 dir.
  const originalPath = resolve(root, 'dist/server/wrangler.json');
  const config = JSON.parse(await readFile(originalPath, 'utf8'));
  temp = await mkdtemp(join(tmpdir(), 'anxin-fact-cancel-http-'));
  service = await createMaterialService({ token });
  proxy = createServer(async (req, res) => {
    if (req.method === 'DELETE') {
      calls.push({ method: req.method, path: req.url, mode, authenticated: req.headers.authorization === `Bearer ${token}` });
      if (mode === 'timeout') { req.resume(); return; }
      if (mode === '503') {
        req.resume();
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'synthetic unavailable' }));
        return;
      }
    }
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const response = await fetch(new URL(req.url, service.url), {
        method: req.method, headers: req.headers, signal: AbortSignal.timeout(20_000),
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      });
      const body = Buffer.from(await response.arrayBuffer());
      if (req.method === 'GET' && req.url === `/fact-jobs/${holdGetJob}`) {
        const held = new Promise(resolve => { releaseHeldPoll = resolve; });
        pollEntered();
        await held;
      }
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(body);
    } catch {
      if (!res.destroyed && !res.headersSent) { res.writeHead(502); res.end('{}'); }
      else res.destroy();
    }
  });
  const proxyUrl = await listen(proxy);
  config.main = resolve(dirname(originalPath), config.main);
  if (config.assets?.directory) config.assets.directory = resolve(dirname(originalPath), config.assets.directory);
  for (const item of config.d1_databases ?? []) item.migrations_dir = resolve(root, 'drizzle');
  config.vars = { ...config.vars, ANXIN_MATERIAL_SERVICE_URL: proxyUrl, ANXIN_MATERIAL_SERVICE_TOKEN: token };
  configPath = join(temp, 'wrangler.json');
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  await applyMigrations();

  // Native SQLite provides independent observations of the real D1 journal,
  // including while no fact row exists and across an entire Worker restart.
  const files = await readdir(join(temp, 'state'), { recursive: true });
  for (const path of files.filter(path => path.endsWith('.sqlite'))) {
    const candidate = new DatabaseSync(join(temp, 'state', path));
    if (candidate.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cases'").get()) { db = candidate; break; }
    candidate.close();
  }
  assert(db, 'Disposable D1 SQLite file must exist.');
  db.exec('PRAGMA busy_timeout=5000');
  await startWorker();

  phase = 'real_delete_timeout';
  const timeoutCase = await createCase('合成取消超时案件');
  const oldJob = await createJob();
  seed(timeoutCase, oldJob, true);
  assert.equal(await remoteStatus(oldJob), 200);
  mode = 'timeout';
  const beganAt = Date.now();
  const first = await request('/api/cases', { id: timeoutCase, company: '合成取消超时案件变更' });
  const duration = Date.now() - beganAt;
  assert.equal(first.status, 200);
  assert.equal(first.body.processingCleanupPending, true);
  assert(duration >= 14_000 && duration < 25_000, `Actual cancellation timeout duration: ${duration}ms`);
  assert.equal(row(timeoutCase), undefined);
  assert.deepEqual(caseQueue(timeoutCase).map(item => item.job_id), [oldJob]);
  assert.equal(await remoteStatus(oldJob), 200);
  observe('real_15s_http_timeout_erases_fact_text_but_retains_job_id', { milliseconds: duration, jobRetained: true, factRowRemoved: true });

  phase = 'retry_after_worker_restart';
  try { await stopWorker(); }
  catch (error) { cleanupFailures.push({ operation: 'stop_worker', ...errorRecord(error) }); throw error; }
  await startWorker();
  assert.deepEqual(caseQueue(timeoutCase).map(item => item.job_id), [oldJob]);
  mode = 'normal';
  const restarted = await request('/api/cases', { id: timeoutCase, company: '合成取消超时案件变更' });
  assert.equal(restarted.status, 200);
  assert.equal(restarted.body.processingCleanupPending, false);
  assert.equal(caseQueue(timeoutCase).length, 0);
  assert.equal(await remoteStatus(oldJob), 404);
  observe('same_owner_noop_after_worker_restart_retries_saved_id_and_deletes_journal');

  phase = 'active_job_noop';
  const activeCase = await createCase('合成活动任务案件');
  const currentJob = await createJob();
  seed(activeCase, currentJob);
  const beforeNoop = calls.length;
  assert.equal((await request('/api/cases', { id: activeCase, company: '合成活动任务案件', status: 'collecting' })).status, 200);
  assert.equal((await request('/api/cases', { id: activeCase, currentStep: 1 })).status, 200);
  assert.equal(calls.length, beforeNoop);
  assert.equal(JSON.parse(row(activeCase).state_json).job.id, currentJob);
  assert.equal(await remoteStatus(currentJob), 200);
  observe('company_status_noop_and_ordinary_step_do_not_cancel_active_job');

  phase = 'unavailable_service_and_owner_isolation';
  mode = '503';
  const unavailable = await request('/api/cases', { id: activeCase, company: '合成活动任务案件已变更' });
  assert.equal(unavailable.status, 200);
  assert.equal(unavailable.body.processingCleanupPending, true);
  assert.equal(row(activeCase), undefined);
  assert.equal(caseQueue(activeCase)[0].job_id, currentJob);
  const foreignOwnerJob = await createJob(), foreignCaseJob = await createJob();
  const insert = db.prepare('INSERT INTO case_material_fact_cleanup(user_id,case_id,job_id,queued_at) VALUES (?,?,?,?)');
  insert.run('different-owner', activeCase, foreignOwnerJob, new Date().toISOString());
  insert.run(owner, 'different-case', foreignCaseJob, new Date().toISOString());
  mode = 'normal';
  const beforeIntruder = calls.length;
  assert.equal((await request('/api/cases', { id: activeCase, nextAction: '越权请求不得重试' }, 'intruder')).status, 404);
  assert.equal((await request(`/api/cases/${activeCase}/facts`, undefined, 'intruder')).status, 404);
  assert.equal(calls.length, beforeIntruder);
  const ownedRetry = await request('/api/cases', { id: activeCase, nextAction: '本人请求重试' });
  assert.equal(ownedRetry.status, 200);
  assert.equal(ownedRetry.body.processingCleanupPending, false);
  assert.equal(await remoteStatus(currentJob), 404);
  assert.equal(await remoteStatus(foreignOwnerJob), 200);
  assert.equal(await remoteStatus(foreignCaseJob), 200);
  assert.deepEqual(queue().map(item => item.job_id).sort(), [foreignOwnerJob, foreignCaseJob].sort());
  observe('real_503_keeps_journal_while_owner_and_case_isolation_preserve_foreign_jobs');

  phase = 'replacement_job_isolation';
  const replacementCase = await createCase('合成任务替换案件');
  const replacedJob = await createJob(), replacementJob = await createJob();
  seed(replacementCase, replacedJob);
  seed(replacementCase, replacementJob);
  assert.deepEqual(caseQueue(replacementCase).map(item => item.job_id), [replacedJob]);
  const replacementResponse = await request('/api/cases', { id: replacementCase, nextAction: '重试旧任务' });
  assert.equal(replacementResponse.status, 200);
  assert.equal(await remoteStatus(replacedJob), 404);
  assert.equal(await remoteStatus(replacementJob), 200);
  assert.equal(JSON.parse(row(replacementCase).state_json).job.id, replacementJob);
  observe('old_job_journal_retry_cannot_cancel_or_overwrite_new_active_job');

  phase = 'late_poll_racing_new_extraction';
  const racingCase = await createCase('合成旧任务晚返回案件');
  const form = new FormData();
  form.set('caseId', racingCase);
  form.set('operationId', randomUUID());
  form.set('file', new File(['合成软件测试材料：本期完整应付工资1000元。'], 'synthetic-old-poll.txt', { type: 'text/plain' }));
  const uploaded = await jsonRequest(`${base}/api/evidence`, { method: 'POST', headers: headers(), body: form });
  assert.equal(uploaded.status, 201);
  const evidenceId = uploaded.body.evidence.id;
  const analyzeStart = await jsonRequest(`${base}/api/evidence/${evidenceId}/analysis`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ documentKind: 'other' }),
  });
  assert.equal(analyzeStart.status, 202);
  for (let attempt = 0; ; attempt++) {
    const analysis = await request(`/api/evidence/${evidenceId}/analysis`);
    assert.equal(analysis.status, 200);
    if (analysis.body.analysis.status === 'ready') break;
    assert.equal(analysis.body.analysis.status, 'running', JSON.stringify(analysis.body));
    assert(attempt < 100, 'Synthetic TXT analysis did not complete.');
    await wait(100);
  }
  const factPath = `/api/cases/${racingCase}/facts`;
  const initialRead = await request(factPath);
  assert.equal(initialRead.status, 200);
  const extract = async current => {
    const response = await jsonRequest(`${base}${factPath}`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ revision: current.revision, generation: current.generation, action: 'extract', evidenceId }),
    });
    assert.equal(response.status, 202, JSON.stringify(response.body));
    return response.body;
  };
  const firstExtract = await extract(initialRead.body);
  holdGetJob = firstExtract.state.job.id;
  const pollStarted = new Promise(resolve => { pollEntered = resolve; });
  // Capture rejection immediately so a failure before releasing the held poll
  // cannot become an unhandled rejection while the runner cleans up resources.
  pendingPoll = request(factPath).then(response => ({ response }), error => ({ error }));
  await bounded(pollStarted, 10_000, 'Old fact poll did not reach the loopback proxy.');
  const secondExtract = await extract(firstExtract);
  assert.notEqual(secondExtract.state.job.id, firstExtract.state.job.id);
  assert.equal(JSON.parse(row(racingCase).state_json).job.id, secondExtract.state.job.id);
  holdGetJob = undefined;
  releaseHeldPoll();
  releaseHeldPoll = undefined;
  const stalePoll = await pendingPoll;
  if (stalePoll.error) throw stalePoll.error;
  assert.equal(stalePoll.response.status, 409);
  assert.equal(JSON.parse(row(racingCase).state_json).job.id, secondExtract.state.job.id);
  assert.equal(JSON.parse(row(racingCase).state_json).materials.length, 0);
  assert.equal(await remoteStatus(firstExtract.state.job.id), 404);
  assert.equal(await remoteStatus(secondExtract.state.job.id), 200);
  observe('late_real_http_ready_poll_loses_revision_cas_and_cannot_overwrite_new_extraction');

  phase = 'atomic_journal_rollback';
  const atomicCase = await createCase('合成原子回滚案件');
  const atomicJob = await createJob();
  seed(atomicCase, atomicJob);
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE cases SET company=? WHERE id=?').run('不会提交的名称', atomicCase);
    assert.equal(row(atomicCase), undefined);
    assert.equal(caseQueue(atomicCase).length, 1);
    assert.equal(caseQueue(atomicCase)[0].job_id, atomicJob);
  } finally { db.exec('ROLLBACK'); }
  assert.equal(JSON.parse(row(atomicCase).state_json).job.id, atomicJob);
  assert.equal(caseQueue(atomicCase).length, 0);
  assert.equal(db.prepare('SELECT company FROM cases WHERE id=?').get(atomicCase).company, '合成原子回滚案件');
  observe('sqlite_transaction_rolls_back_case_invalidation_fact_delete_and_journal_together');

  phase = 'evidence_success_then_service_offline';
  const evidenceCase = await createCase('合成证据删除成功案件');
  const deletedEvidence = await uploadEvidence(evidenceCase);
  const evidenceJob = await createJob();
  seed(evidenceCase, evidenceJob);
  const removedEvidence = await deleteEvidence(deletedEvidence);
  assert.equal(removedEvidence.status, 200);
  assert.equal(removedEvidence.body.processingCleanupPending, false);
  assert.equal(await remoteStatus(evidenceJob), 404);
  assert.equal(row(evidenceCase), undefined);
  assert.equal(db.prepare('SELECT id FROM evidence_files WHERE id=?').get(deletedEvidence), undefined);
  const remainingAfterSuccess = caseQueue(evidenceCase).map(item => item.job_id);
  const beforeOfflineRequest = calls.length;
  mode = '503';
  const offlineAfterSuccess = await request('/api/cases', { id: evidenceCase, nextAction: '成功删除后的后续本人请求' });
  observations.push({
    name: 'evidence_success_acknowledges_journal_so_later_offline_request_has_no_false_pending',
    status: remainingAfterSuccess.length === 0 && offlineAfterSuccess.body.processingCleanupPending === false ? 'PASS' : 'FAIL',
    deleteStatus: removedEvidence.status, deletePending: removedEvidence.body.processingCleanupPending,
    remoteStatusAfterDelete: 404, remainingJournalJobs: remainingAfterSuccess,
    subsequentRequestStatus: offlineAfterSuccess.status, subsequentPending: offlineAfterSuccess.body.processingCleanupPending,
    unnecessaryDeleteCalls: calls.length - beforeOfflineRequest,
  });
  assert.deepEqual(remainingAfterSuccess, []);
  assert.equal(offlineAfterSuccess.status, 200);
  assert.equal(offlineAfterSuccess.body.processingCleanupPending, false);
  assert.equal(calls.length, beforeOfflineRequest);
  mode = 'normal';

  phase = 'evidence_failed_cancellation_retries_after_row_removal';
  const failedEvidenceCase = await createCase('合成证据取消失败案件');
  const failedEvidence = await uploadEvidence(failedEvidenceCase);
  const failedEvidenceJob = await createJob();
  seed(failedEvidenceCase, failedEvidenceJob);
  mode = '503';
  const unavailableEvidence = await deleteEvidence(failedEvidence);
  assert.equal(unavailableEvidence.status, 200);
  assert.equal(unavailableEvidence.body.processingCleanupPending, true);
  assert.equal(db.prepare('SELECT id FROM evidence_files WHERE id=?').get(failedEvidence), undefined);
  assert.deepEqual(caseQueue(failedEvidenceCase).map(item => item.job_id), [failedEvidenceJob]);
  assert.equal(await remoteStatus(failedEvidenceJob), 200);
  mode = 'normal';
  const failedEvidenceRetry = await request('/api/cases', { id: failedEvidenceCase, nextAction: '重试已删除证据的旧任务' });
  assert.equal(failedEvidenceRetry.status, 200);
  assert.equal(failedEvidenceRetry.body.processingCleanupPending, false);
  assert.deepEqual(caseQueue(failedEvidenceCase), []);
  assert.equal(await remoteStatus(failedEvidenceJob), 404);
  observe('evidence_failed_cancel_retains_id_after_evidence_removal_and_owned_request_retries');

  phase = 'evidence_exact_ack_isolation';
  const isolatedCase = await createCase('合成证据精确确认案件');
  const isolatedEvidence = await uploadEvidence(isolatedCase);
  const isolatedJob = await createJob(), queuedOtherJob = await createJob();
  seed(isolatedCase, isolatedJob);
  insert.run('different-owner', isolatedCase, isolatedJob, new Date().toISOString());
  insert.run(owner, 'different-evidence-case', isolatedJob, new Date().toISOString());
  insert.run(owner, isolatedCase, queuedOtherJob, new Date().toISOString());
  assert.equal((await deleteEvidence(isolatedEvidence)).status, 200);
  assert.equal(await remoteStatus(isolatedJob), 404);
  assert.equal(await remoteStatus(queuedOtherJob), 200);
  assert.deepEqual(caseQueue(isolatedCase).map(item => item.job_id), [queuedOtherJob]);
  assert(queue().some(item => item.user_id === 'different-owner' && item.case_id === isolatedCase && item.job_id === isolatedJob));
  assert(queue().some(item => item.user_id === owner && item.case_id === 'different-evidence-case' && item.job_id === isolatedJob));
  observe('evidence_ack_deletes_only_captured_owner_case_job_and_preserves_other_queued_tasks');

  phase = 'evidence_retry_missing_and_owner_isolation';
  const newEvidenceJob = await createJob();
  seed(evidenceCase, newEvidenceJob);
  const beforeEvidenceNoop = calls.length;
  assert.equal((await deleteEvidence('missing-synthetic-evidence')).status, 404);
  assert.equal((await deleteEvidence(deletedEvidence, 'intruder')).status, 404);
  assert.equal((await deleteEvidence(deletedEvidence)).status, 200);
  assert.equal(calls.length, beforeEvidenceNoop);
  assert.equal(JSON.parse(row(evidenceCase).state_json).job.id, newEvidenceJob);
  assert.equal(await remoteStatus(newEvidenceJob), 200);
  assert.deepEqual(caseQueue(evidenceCase), []);
  observe('missing_foreign_and_repeated_evidence_delete_do_not_cancel_new_active_job');

  phase = 'evidence_transaction_rollback';
  const rollbackCase = await createCase('合成证据事务回滚案件');
  const rollbackEvidence = await uploadEvidence(rollbackCase);
  const rollbackJob = await createJob();
  seed(rollbackCase, rollbackJob);
  // AFTER UPDATE executes after the real invalidation trigger or alongside it;
  // the transaction must roll back both trigger writes in either order.
  db.exec(`CREATE TRIGGER synthetic_abort_evidence_status AFTER UPDATE ON evidence_files
    WHEN NEW.status='deleting' BEGIN SELECT RAISE(ABORT,'synthetic evidence rollback'); END`);
  const beforeEvidenceRollback = calls.length;
  const rolledBackEvidence = await deleteEvidence(rollbackEvidence);
  assert.equal(rolledBackEvidence.status, 503);
  assert.equal(calls.length, beforeEvidenceRollback);
  assert.equal(db.prepare('SELECT status FROM evidence_files WHERE id=?').get(rollbackEvidence).status, 'uploaded');
  assert.equal(db.prepare('SELECT id FROM evidence_upload_cancellations WHERE id=?').get(rollbackEvidence), undefined);
  assert.equal(JSON.parse(row(rollbackCase).state_json).job.id, rollbackJob);
  assert.deepEqual(caseQueue(rollbackCase), []);
  assert.equal(await remoteStatus(rollbackJob), 200);
  const preservedDownload = await fetch(`${base}/api/evidence/${rollbackEvidence}/download`, { headers: headers() });
  assert.equal(preservedDownload.status, 200);
  assert((await preservedDownload.text()).includes('合成删除回归材料'));
  db.exec('DROP TRIGGER synthetic_abort_evidence_status');
  observe('evidence_transaction_rollback_preserves_facts_file_and_journal_and_never_cancels_remote_job');

  phase = 'evidence_ack_database_failure';
  db.exec(`CREATE TRIGGER synthetic_abort_evidence_ack BEFORE DELETE ON case_material_fact_cleanup
    BEGIN SELECT RAISE(ABORT,'synthetic journal acknowledgement failure'); END`);
  const ackFailure = await deleteEvidence(rollbackEvidence);
  assert.equal(ackFailure.status, 200);
  assert.equal(ackFailure.body.processingCleanupPending, true);
  assert.equal(await remoteStatus(rollbackJob), 404);
  assert.equal(db.prepare('SELECT id FROM evidence_files WHERE id=?').get(rollbackEvidence), undefined);
  assert.deepEqual(caseQueue(rollbackCase).map(item => item.job_id), [rollbackJob]);
  db.exec('DROP TRIGGER synthetic_abort_evidence_ack');
  const ackRetry = await request('/api/cases', { id: rollbackCase, nextAction: '远端已取消后的幂等确认重试' });
  assert.equal(ackRetry.status, 200);
  assert.equal(ackRetry.body.processingCleanupPending, false);
  assert.deepEqual(caseQueue(rollbackCase), []);
  assert.equal(await remoteStatus(rollbackJob), 404);
  observe('successful_remote_cancel_with_failed_ack_keeps_pending_and_retries_idempotently');

  phase = 'service_authentication';
  assert(calls.length >= 6);
  assert(calls.every(call => call.authenticated));
  observe('all_real_http_deletes_used_private_service_authentication', { deleteCalls: calls.length, noSecretsRecorded: true });
} catch (error) { failure = { phase, ...errorRecord(error) }; }
finally {
  releaseHeldPoll?.();
  await cleanup('stop_worker', stopWorker);
  await cleanup('stop_migration', async () => { await stopChild(migrationChild, 'Isolated migration'); migrationChild = undefined; });
  await cleanup('settle_pending_poll', async () => { if (pendingPoll) await pendingPoll; });
  await cleanup('close_database', () => db?.close());
  await cleanup('close_proxy', async () => {
    if (!proxy) return;
    proxy.closeAllConnections();
    await bounded(new Promise(resolve => proxy.close(resolve)), 5000, 'Loopback fault proxy did not stop.');
  });
  await cleanup('close_material_service', async () => { await service?.close(); });
  await cleanup('remove_temporary_resources', async () => {
    if (temp && cleanupFailures.some(item => ['stop_worker', 'stop_migration'].includes(item.operation))) {
      cleanupFailures.push({ operation: 'retain_temporary_resources', name: 'CleanupIncomplete', message: 'Private temporary resources retained because owned process cleanup failed.', path: temp });
      return;
    }
    if (temp) await rm(temp, { recursive: true, force: true });
  });
  if (cleanupFailures.length) failure ??= { phase: 'cleanup', message: 'Temporary regression resources did not fully clean up.' };
  await writeFile(output, JSON.stringify({
    status: failure ? 'FAIL' : 'PASS', mode: 'fact-cancellation',
    boundary: 'production Worker HTTP + disposable on-disk D1 SQLite + real material service rules jobs + loopback timeout/503 injection',
    actualModelInference: false, syntheticInputs: true, recordedAt: new Date().toISOString(),
    observations, failure, cleanup: { status: cleanupFailures.length ? 'FAIL' : 'PASS', failures: cleanupFailures }, calls,
    workerRuns: workerRuns.map(run => ({ ...run, stdout: safeLog(run.stdout), stderr: safeLog(run.stderr) })),
  }, null, 2) + '\n');
}

if (failure) {
  console.error(JSON.stringify({ status: 'FAIL', mode: 'fact-cancellation', phase: failure.phase, output }));
  process.exitCode = 1;
} else console.log(JSON.stringify({ status: 'PASS', mode: 'fact-cancellation', checks: observations.length, output }));
