// Real LangGraph in an isolated workerd process + disk-backed local D1.
// No model/API calls. The probe is not part of the application deployment.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const output = resolve(process.env.ANXIN_HARNESS_REPORT || 'output/harness/persistence.json');
const temp = await mkdtemp(join(tmpdir(), 'anxin-harness-d1-'));
const token = randomBytes(32).toString('hex');
const wrangler = resolve('node_modules/wrangler/bin/wrangler.js');
const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const checks = [];
const report = { passed: false, startedAt: new Date().toISOString(), node: process.version,
  dependencies: Object.fromEntries(Object.entries(packageJson.dependencies).filter(([key]) => key.startsWith('@langchain/') || key === 'zod')),
  scope: 'Local isolated workerd + persistent D1; synthetic tools; no production deployment or model evaluation.', checks };
let worker, workerLog = '', baseUrl;
const sanitize = text => String(text).replaceAll(token, '[redacted]')
  .replace(/env\.PROBE_TOKEN[^\n]*/g, 'env.PROBE_TOKEN [redacted]');
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false',
  WRANGLER_LOG_PATH: join(temp, 'logs'), WRANGLER_LOG: 'error', CI: '1', LANGSMITH_TRACING: 'false', LANGCHAIN_TRACING_V2: 'false' };
// A caller's tracing or provider secrets are unnecessary for this synthetic test.
for (const key of Object.keys(env)) if (/^(LANGSMITH|LANGCHAIN|OPENAI|ANTHROPIC|DEEPSEEK)_.*(KEY|TOKEN)$/i.test(key)) delete env[key];
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
const exitOf = child => new Promise(resolveExit => child.once('close', resolveExit));
async function command(args) {
  const child = spawn(process.execPath, [wrangler, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', data => { log = (log + data).slice(-20000); });
  child.stderr.on('data', data => { log = (log + data).slice(-20000); });
  child.on('error', error => { log += error.message; });
  const deadline = setTimeout(() => child.kill('SIGKILL'), 60_000);
  const code = await exitOf(child); clearTimeout(deadline);
  if (code !== 0) throw new Error(`Wrangler command failed: ${sanitize(log)}`);
}
async function freePort() {
  const server = createServer(); await new Promise(yes => server.listen(0, '127.0.0.1', yes));
  const port = server.address().port; await new Promise(yes => server.close(yes)); return port;
}
async function stop(signal = 'SIGTERM') {
  if (!worker || worker.exitCode !== null || worker.signalCode !== null) return;
  const child = worker, done = exitOf(child);
  const kill = value => { try { process.kill(-child.pid, value); } catch { child.kill(value); } };
  kill(signal);
  const deadline = setTimeout(() => kill('SIGKILL'), 5000);
  await done; clearTimeout(deadline); worker = undefined;
}
async function start(configPath, persistPath, port) {
  workerLog = '';
  worker = spawn(process.execPath, [wrangler, 'dev', '--local', '--config', configPath, '--persist-to', persistPath,
    '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', '0'],
  { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  worker.stdout.on('data', data => { workerLog = (workerLog + data).slice(-30000); });
  worker.stderr.on('data', data => { workerLog = (workerLog + data).slice(-30000); });
  worker.on('error', error => { workerLog += error.message; });
  for (let attempt = 0; attempt < 80; attempt++) {
    if (worker.exitCode !== null || worker.signalCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return { pid: worker.pid, ...(await response.json()) };
    } catch { /* bounded local startup */ }
    await delay(500);
  }
  throw new Error(`Worker startup failed: ${sanitize(workerLog)}`);
}
async function request(body, fixture = 'alice', expectedStatus = 200) {
  const response = await fetch(`${baseUrl}/probe`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-probe-fixture': fixture,
  }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const value = await response.json();
  assert.equal(response.status, expectedStatus, `${body.operation}: ${sanitize(JSON.stringify(value))}\n${sanitize(workerLog)}`);
  return value;
}
function checked(name, verify) { verify(); checks.push({ name, passed: true }); console.log(`PASS ${name}`); }
try {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
  const port = await freePort(); baseUrl = `http://127.0.0.1:${port}`;
  const configPath = join(temp, 'wrangler.json'), persistPath = join(temp, 'state');
  await writeFile(configPath, JSON.stringify({ name: 'anxin-harness-persistence-probe',
    main: resolve('scripts/harness-persistence-worker.ts'), compatibility_date: '2026-09-11',
    compatibility_flags: ['nodejs_compat'], vars: { PROBE_TOKEN: token },
    d1_databases: [{ binding: 'DB', database_name: 'anxin-harness-probe',
      database_id: '00000000-0000-4000-8000-000000000047', migrations_dir: resolve('drizzle') }],
  }), { mode: 0o600 });
  await command(['d1', 'migrations', 'apply', 'DB', '--local', '--config', configPath, '--persist-to', persistPath]);
  const first = await start(configPath, persistPath, port);
  report.firstProcess = first;
  const unauthenticated = await fetch(`${baseUrl}/probe`, { method: 'POST' });
  checked('probe requires ephemeral local authorization', () => assert.equal(unauthenticated.status, 401));
  const paused = await request({ operation: 'start', runId: 'restart' });
  checked('LangGraph interrupt stores the validated harness state', () => {
    assert.equal(paused.harness.status, 'waiting_user'); assert.equal(paused.interrupts.length, 1);
    assert.equal(paused.harness.budget.remainingSteps, 7); assert.equal(paused.run.prepared, 1);
  });
  await request({ operation: 'start', runId: 'restart' }, 'alice', 409);
  checks.push({ name: 'duplicate start is rejected', passed: true });
  await request({ operation: 'state', runId: 'restart' }, 'bob', 404);
  await request({ operation: 'state', runId: 'restart' }, 'otherCase', 404);
  checks.push({ name: 'other owner and case cannot read an existing run', passed: true });
  await request({ operation: 'start', runId: 'restart' }, 'bob');
  await request({ operation: 'start', runId: 'restart' }, 'otherCase');
  await request({ operation: 'start', runId: 'stale' });
  await request({ operation: 'start', runId: 'parallel', scenario: 'parallel' }, 'alice', 503);
  const failure = await request({ operation: 'state', runId: 'parallel' });
  checked('parallel failure follows one successful sibling execution', () => assert.equal(failure.run.successful, 1));
  const history = await request({ operation: 'history', runId: 'restart' });
  checked('checkpoint history contains a connected parent chain', () => {
    assert.ok(history.history.length >= 3);
    assert.equal(new Set(history.history.map(item => item.id)).size, history.history.length);
    history.history.slice(0, -1).forEach((entry, index) => assert.equal(entry.parentId, history.history[index + 1].id));
  });
  const pending = await request({ operation: 'history', runId: 'parallel' });
  checked('failed superstep persists the successful sibling output', () => assert.ok(pending.history.some(item =>
    item.pendingWrites.some(([, channel, value]) => channel === 'results' && Array.isArray(value) && value.includes('completed-once')))));

  // A hard process stop after a sync checkpoint: no in-memory saver can survive.
  await stop('SIGKILL');
  const second = await start(configPath, persistPath, port);
  report.secondProcess = second;
  checked('restored in a new Worker process', () => { assert.notEqual(first.pid, second.pid); assert.notEqual(first.bootId, second.bootId); });
  const restored = await request({ operation: 'state', runId: 'restart' });
  checked('interrupted state retains identical structure and values after termination', () => assert.deepEqual(restored.harness, paused.harness));
  await request({ operation: 'resume', runId: 'restart', decision: { decision: 'continue', verified: true } }, 'alice', 400);
  checks.push({ name: 'resume payload cannot inject fact confirmation', passed: true });
  const completed = await request({ operation: 'resume', runId: 'restart', decision: { decision: 'continue' } });
  checked('resume completes without re-running the prepared step', () => {
    assert.equal(completed.harness.status, 'completed'); assert.equal(completed.run.prepared, 1);
    assert.equal(completed.run.finished, 1); assert.deepEqual(completed.next, []);
  });
  await request({ operation: 'resume', runId: 'restart', decision: { decision: 'continue' } }, 'alice', 409);
  checks.push({ name: 'a completed run cannot be resumed twice', passed: true });
  await request({ operation: 'bump', runId: 'stale' });
  const stale = await request({ operation: 'resume', runId: 'stale', decision: { decision: 'continue' } }, 'alice', 409);
  const unchanged = await request({ operation: 'state', runId: 'stale' });
  checked('fresh business revision prevents a stale checkpoint from completing', () => {
    assert.equal(stale.error, 'stale_snapshot'); assert.equal(unchanged.run.finished, 0);
  });
  await request({ operation: 'release', runId: 'parallel' });
  const recovered = await request({ operation: 'resume', runId: 'parallel' });
  checked('pending writes recover without re-executing the successful sibling', () => {
    assert.equal(recovered.run.successful, 1); assert.equal(recovered.run.finished, 1);
    assert.deepEqual([...recovered.results].sort(), ['completed-once', 'recovered']); assert.deepEqual(recovered.next, []);
  });
  const removed = await request({ operation: 'delete', runId: 'restart' });
  const bob = await request({ operation: 'state', runId: 'restart' }, 'bob');
  const otherCase = await request({ operation: 'state', runId: 'restart' }, 'otherCase');
  checked('thread deletion is isolated by owner and case', () => {
    assert.equal(removed.harness, null); assert.equal(bob.harness.status, 'waiting_user');
    assert.equal(bob.harness.ownerId, 'synthetic-bob'); assert.equal(otherCase.harness.caseId, 'synthetic-case-b');
  });
  report.passed = true;
} catch (error) {
  report.error = sanitize(error instanceof Error ? error.stack : error);
  report.workerLog = sanitize(workerLog);
  process.exitCode = 1;
  console.error(report.error);
} finally {
  try { await stop(); } finally {
    report.finishedAt = new Date().toISOString();
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    await rm(temp, { recursive: true, force: true });
  }
}
