import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
const root = process.cwd();
const temp = await mkdtemp(join(tmpdir(), 'anxin-cases-ui-'));
const ready = '/tmp/anxin-cases-ui-isolation.json';
const owner = 'cases-step-ui-owner';
const headers = { 'oai-authenticated-user-id': owner, 'oai-authenticated-user-email': 'owner@synthetic.test' };
const workerEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false' };
const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
let worker, db, release;
const close = () => release?.();
process.once('SIGTERM', close); process.once('SIGINT', close);
try {
  const originalPath = resolve(root, 'dist/server/wrangler.json');
  const config = JSON.parse(await readFile(originalPath, 'utf8'));
  config.main = resolve(dirname(originalPath), config.main);
  if (config.assets?.directory) config.assets.directory = resolve(dirname(originalPath), config.assets.directory);
  for (const item of config.d1_databases ?? []) item.migrations_dir = resolve(root, 'drizzle');
  config.vars = {}; // An unavailable material service makes cleanup pending without changing production.
  const privateConfig = join(temp, 'wrangler.json');
  await writeFile(privateConfig, JSON.stringify(config), { mode: 0o600 });
  const common = ['--local', '--config', privateConfig, '--persist-to', join(temp, 'state')];
  await new Promise((yes, no) => {
    const child = spawn(process.execPath, [wrangler, 'd1', 'migrations', 'apply', 'DB', ...common], { cwd: root, stdio: 'ignore', env: workerEnv });
    child.once('error', no); child.once('exit', code => code === 0 ? yes() : no(new Error(`migration failed ${code}`)));
  });
  let databasePath;
  for (const file of (await readdir(join(temp, 'state'), { recursive: true })).filter(file => file.endsWith('.sqlite'))) {
    const candidate = new DatabaseSync(join(temp, 'state', file));
    if (candidate.prepare("SELECT name FROM sqlite_master WHERE name='cases'").get()) { db = candidate; databasePath = join(temp, 'state', file); break; }
    candidate.close();
  }
  if (!db) throw new Error('no isolated DB');
  db.exec('PRAGMA busy_timeout=5000');
  const probe = createServer(); await new Promise(yes => probe.listen(0, '127.0.0.1', yes));
  const port = probe.address().port; await new Promise(yes => probe.close(yes));
  const base = `http://127.0.0.1:${port}`;
  worker = spawn(process.execPath, [wrangler, 'dev', ...common, '--ip', '127.0.0.1', '--port', String(port)], { cwd: root, stdio: 'ignore', env: workerEnv });
  for (let attempt = 0; ; attempt++) {
    if (worker.exitCode !== null) throw new Error('Worker exited');
    try { if ((await fetch(`${base}/api/bootstrap`, { signal: AbortSignal.timeout(1000) })).status === 401) break; } catch {}
    if (attempt >= 90) throw new Error('Worker readiness failed');
    await new Promise(yes => setTimeout(yes, 250));
  }
  const createCase = async company => {
    const res = await fetch(`${base}/api/cases`, { method: 'POST', headers, body: JSON.stringify({ company, type: '欠薪争议', description: '隔离UI回归合成数据，非真实案件。' }) });
    const body = await res.json(); if (res.status !== 201) throw new Error('create synthetic case failed'); return body.case.id;
  };
  const caseId = await createCase('合成推进提醒案件');
  const jobId = randomUUID();
  db.prepare('INSERT INTO case_material_fact_cleanup(user_id,case_id,job_id,queued_at) VALUES (?,?,?,?)').run(owner, caseId, jobId, new Date().toISOString());
  await writeFile(ready, JSON.stringify({ launcherPid: process.pid, base, databasePath, owner, caseId, jobId, isolated: true }), { mode: 0o600 });
  console.log(JSON.stringify({ status: 'ready', base, readyFile: ready, isolated: true }));
  await new Promise(yes => { release = yes; });
} finally {
  if (worker && worker.exitCode === null) {
    const done = new Promise(yes => worker.once('exit', yes)); worker.kill('SIGTERM'); await done;
  }
  db?.close(); await rm(ready, { force: true }); await rm(temp, { recursive: true, force: true });
  console.log('isolated UI resources removed');
}
