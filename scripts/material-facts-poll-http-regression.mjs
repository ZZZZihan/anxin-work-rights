// Run after npm run build, from the project root:
// node scripts/material-facts-poll-http-regression.mjs [OUTPUT.json]
// ANXIN_MATERIAL_POLL_REPORT also selects the report path. This runner creates
// its own loopback Worker, D1/R2 and rules service; it never accepts a live URL.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnOwnedChild, stopChild } from './owned-http-process-group.mjs';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
const { createMaterialService } = await import(pathToFileURL(resolve(process.cwd(), 'scripts/material-service.mjs')));

if (process.argv.length > 3) throw new Error('Usage: node scripts/material-facts-poll-http-regression.mjs [OUTPUT.json]');
const root = process.cwd();
const output = resolve(process.argv[2] || process.env.ANXIN_MATERIAL_POLL_REPORT || 'output/materials/http-fact-poll.json');
await mkdir(dirname(output), { recursive: true });
await rm(output, { force: true }); // A failed run must not leave an older PASS.

const owner = 'fact-poll-http-owner';
const token = randomBytes(32).toString('hex');
const observations = [];
const calls = [];
const cleanupFailures = [];
const workerEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false' };
const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
let temp, worker, workerError, service, proxy, db, configPath, base;
let failure, phase = 'setup';
let holdGetJob, pollEntered, pendingPoll;
let expectedPolls = 2;
const heldPolls = [];
const releaseHeldPolls = () => { for (const release of heldPolls.splice(0)) release(); };
// Capture errors immediately: a blocked poll can fail while another operation
// is still being checked, and finally must be able to settle it safely.
const trackPoll = promise => promise.then(value => ({ value }), error => ({ error }));
const pollResult = async promise => {
  const result = await promise;
  if (result.error) throw result.error;
  return result.value;
};

const sanitize = value => String(value).replaceAll(token, '[redacted]');
const errorRecord = error => ({ name: sanitize(error?.name || 'Error'), message: sanitize(error?.message || String(error)) });
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
const request = (path, user = owner) => jsonRequest(`${base}${path}`, { headers: headers(user) });
const row = id => db.prepare('SELECT state_json FROM case_material_facts WHERE case_id=?').get(id);

async function createCase(company) {
  const response = await jsonRequest(`${base}/api/cases`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ company, type: '欠薪争议' }),
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.case.id;
}

async function uploadEvidence(caseId, text = '合成轮询回归新增材料：本期工资1000元。') {
  const form = new FormData();
  form.set('caseId', caseId);
  form.set('operationId', randomUUID());
  form.set('file', new File([text], 'synthetic-poll.txt', { type: 'text/plain' }));
  const response = await jsonRequest(`${base}/api/evidence`, { method: 'POST', headers: headers(), body: form });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.evidence.id;
}

async function applyMigrations() {
  const child = spawnOwnedChild(process.execPath, [wrangler, 'd1', 'migrations', 'apply', 'DB', '--local', '--config', configPath, '--persist-to', join(temp, 'state')], {
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
    try { await stopChild(child, 'Isolated migration'); }
    catch (error) {
      cleanupFailures.push({ operation: 'stop_migration', ...errorRecord(error) });
      if (!migrationFailure) throw error;
    }
  }
}

async function startWorker() {
  const probe = createServer();
  const free = await listen(probe);
  const port = Number(new URL(free).port);
  await new Promise(resolve => probe.close(resolve));
  workerError = undefined;
  worker = spawnOwnedChild(process.execPath, [wrangler, 'dev', '--local', '--config', configPath, '--persist-to', join(temp, 'state'), '--ip', '127.0.0.1', '--port', String(port)], {
    cwd: root, stdio: 'ignore', env: workerEnv,
  });
  worker.once('error', error => { workerError = error; });
  base = free;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (workerError) throw workerError;
    if (worker.exitCode !== null || worker.signalCode !== null) throw new Error('Isolated Worker exited before readiness.');
    try {
      const response = await fetch(`${base}/api/bootstrap`, { signal: AbortSignal.timeout(1000) });
      await response.arrayBuffer();
      if (response.status === 401) return;
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
  temp = await mkdtemp(join(tmpdir(), 'anxin-fact-poll-http-'));
  service = await createMaterialService({ token, facts: { backend: 'rules' } });
  proxy = createServer(async (req, res) => {
    if (req.method === 'DELETE') calls.push({ method: req.method, path: req.url, authenticated: req.headers.authorization === `Bearer ${token}` });
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const response = await fetch(new URL(req.url, service.url), {
        method: req.method, headers: req.headers, signal: AbortSignal.timeout(20_000),
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      });
      const body = Buffer.from(await response.arrayBuffer());
      if (req.method === 'GET' && req.url === `/fact-jobs/${holdGetJob}`) {
        const paused = new Promise(resolve => { heldPolls.push(resolve); });
        if (heldPolls.length === expectedPolls) pollEntered();
        await paused;
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

  // Observe the actual persisted fact row independently of the HTTP replies.
  const files = await readdir(join(temp, 'state'), { recursive: true });
  for (const path of files.filter(path => path.endsWith('.sqlite'))) {
    const candidate = new DatabaseSync(join(temp, 'state', path));
    if (candidate.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cases'").get()) { db = candidate; break; }
    candidate.close();
  }
  assert(db, 'Disposable D1 SQLite file must exist.');
  db.exec('PRAGMA busy_timeout=5000');
  await startWorker();

  phase = 'prepare_material';
  const racingCase = await createCase('合成任务并发轮询案件');
  const evidenceId = await uploadEvidence(racingCase, '合成软件测试材料：本期完整应付工资1000元。');
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
  const waitForReady = async jobId => {
    for (let attempt = 0; ; attempt++) {
      const result = await jsonRequest(`${service.url}/fact-jobs/${jobId}`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      if (result.body.status === 'ready') return;
      assert.equal(result.body.status, 'running', JSON.stringify(result.body));
      assert(attempt < 100, 'Real rules extraction did not finish.');
      await wait(50);
    }
  };
  phase = 'same_ready_job_concurrent_reads';
  const firstExtract = await extract(initialRead.body);
  await waitForReady(firstExtract.state.job.id);
  const deletesBeforePoll = calls.length;
  holdGetJob = firstExtract.state.job.id;
  const bothStarted = new Promise(resolve => { pollEntered = resolve; });
  pendingPoll = trackPoll(Promise.all([request(factPath), request(factPath)]));
  await bounded(bothStarted, 10_000, 'Both fact polls must capture the same ready result.');
  releaseHeldPolls();
  holdGetJob = undefined;
  const both = await pollResult(pendingPoll);
  const stored = JSON.parse(row(racingCase).state_json);
  observations.push({
    name: 'two_real_http_polls_for_same_ready_job',
    status: both.every(response => response.status === 200) ? 'PASS' : 'FAIL',
    responseStatuses: both.map(response => response.status).sort(),
    responseRevisions: both.map(response => response.body.revision ?? null),
    errors: both.filter(response => response.status !== 200).map(response => response.body),
    storedRevision: db.prepare('SELECT revision FROM case_material_facts WHERE case_id=?').get(racingCase).revision,
    extractionAuditCount: stored.history.filter(item => item.type === 'candidates_extracted').length,
    materials: stored.materials.length, generation: stored.generation,
    cancellationCalls: calls.length - deletesBeforePoll,
  });
  assert.equal(stored.history.filter(item => item.type === 'candidates_extracted').length, 1);
  assert.equal(stored.materials.length, 1);
  assert.deepEqual(both.map(response => response.status).sort(), [200, 200]);
  assert.deepEqual(both[0].body, both[1].body);
  assert.equal(both[0].body.revision, firstExtract.revision + 1);
  assert.equal(stored.job, null);
  assert(stored.materials[0].candidates.length > 0, 'A real rules candidate must have been persisted.');
  assert.equal(calls.length - deletesBeforePoll, 1, 'Only the reader that consumes the job should cancel it.');

  phase = 'late_poll_racing_new_extraction';
  expectedPolls = 1;
  const old = await extract(both[0].body);
  await waitForReady(old.state.job.id);
  holdGetJob = old.state.job.id;
  const pollStarted = new Promise(resolve => { pollEntered = resolve; });
  pendingPoll = trackPoll(request(factPath));
  await bounded(pollStarted, 10_000, 'Old poll did not reach loopback proxy.');
  const newer = await extract(old);
  releaseHeldPolls();
  holdGetJob = undefined;
  const stale = await pollResult(pendingPoll);
  assert.equal(stale.status, 409);
  assert.equal(JSON.parse(row(racingCase).state_json).job.id, newer.state.job.id);
  observe('old_poll_does_not_overwrite_new_extraction', { responseStatus: stale.status, newestJobPreserved: true });

  phase = 'generation_change';
  await waitForReady(newer.state.job.id);
  const pollStarted2 = new Promise(resolve => { pollEntered = resolve; });
  holdGetJob = newer.state.job.id;
  pendingPoll = trackPoll(request(factPath));
  await bounded(pollStarted2, 10_000, 'Generation test poll did not reach proxy.');
  await uploadEvidence(racingCase);
  releaseHeldPolls();
  holdGetJob = undefined;
  const changed = await pollResult(pendingPoll);
  assert.equal(changed.status, 409);
  observe('material_generation_change_keeps_conflict', { responseStatus: changed.status });

  phase = 'auth';
  assert.equal((await request(factPath, 'intruder')).status, 404);
  const unauthenticated = await jsonRequest(`${base}${factPath}`);
  assert.equal(unauthenticated.status, 401);
  assert(calls.every(call => call.authenticated), 'Every job cleanup request must use private service authentication.');
  observe('foreign_and_unauthenticated_reads_remain_rejected', { foreign: 404, unauthenticated: 401 });
} catch (error) { failure = { phase, ...errorRecord(error) }; }
finally {
  releaseHeldPolls();
  await cleanup('stop_worker', stopWorker);
  await cleanup('settle_pending_poll', async () => { if (pendingPoll) await pendingPoll; });
  await cleanup('close_database', () => db?.close());
  await cleanup('close_proxy', async () => {
    if (!proxy) return;
    proxy.closeAllConnections();
    await bounded(new Promise(resolve => proxy.close(resolve)), 5000, 'Loopback poll barrier did not stop.');
  });
  await cleanup('close_material_service', async () => { await service?.close(); });
  await cleanup('remove_temporary_resources', async () => {
    if (temp && cleanupFailures.some(item => ['stop_worker', 'stop_migration'].includes(item.operation))) {
      throw new Error(`Owned process shutdown was not confirmed; isolated resources retained at ${temp}.`);
    }
    if (temp) await rm(temp, { recursive: true, force: true });
  });
  if (cleanupFailures.length) failure ??= { phase: 'cleanup', message: 'Temporary regression resources did not fully clean up.' };
  await writeFile(output, JSON.stringify({
    status: failure ? 'FAIL' : 'PASS', mode: 'fact-poll',
    boundary: 'production Worker HTTP + disposable on-disk D1 SQLite + real rules jobs + controlled concurrent ready replies',
    actualModelInference: false, syntheticInputs: true, recordedAt: new Date().toISOString(),
    observations, failure, cleanup: { status: cleanupFailures.length ? 'FAIL' : 'PASS', failures: cleanupFailures }, calls,
  }, null, 2) + '\n');
}

if (failure) {
  console.error(JSON.stringify({ status: 'FAIL', mode: 'fact-poll', phase: failure.phase, output }));
  process.exitCode = 1;
} else console.log(JSON.stringify({ status: 'PASS', mode: 'fact-poll', checks: observations.length, output }));
