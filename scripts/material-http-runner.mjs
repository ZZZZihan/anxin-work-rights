// Runs the production build against isolated local D1/R2 and the real extraction
// service. --images uses Apple Vision on macOS or Tesseract/Poppler on Linux.
// Fixture facts are compared exactly unless --punctuation-equivalence is explicit;
// raw OCR, quotes, field provenance and source hashes always remain exact.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { createMaterialService } from './material-service.mjs';

const output = resolve(process.env.ANXIN_MATERIAL_REPORT || 'output/materials/http-production.json');
await rm(output, { force: true }); // A failed run must not leave an older PASS report at this path.
const mode = process.argv.includes('--images') ? 'images' : 'text';
const temp = await mkdtemp(join(tmpdir(), 'anxin-material-http-'));
const token = randomBytes(32).toString('hex');
const model = process.env.ANXIN_MATERIAL_MODEL || process.env.ANXIN_VISION_MODEL || null;
let service;
const run = (args, options = {}) => new Promise((yes, no) => {
  const child = spawn(process.execPath, args, { stdio: 'inherit', ...options });
  child.once('error', no); child.once('exit', (code) => code === 0 ? yes() : no(new Error(`Child exited ${code}`)));
});
let worker;
try {
  service = await createMaterialService({ token, model });
  const probe = createServer(); await new Promise((yes) => probe.listen(0, '127.0.0.1', yes));
  const port = probe.address().port; await new Promise((yes) => probe.close(yes));
  const baseConfig = resolve('dist/server/wrangler.json');
  const config = JSON.parse(await readFile(baseConfig, 'utf8'));
  config.main = resolve(dirname(baseConfig), config.main);
  if (config.assets?.directory) config.assets.directory = resolve(dirname(baseConfig), config.assets.directory);
  for (const db of config.d1_databases ?? []) db.migrations_dir = resolve('drizzle');
  config.vars = { ...config.vars, ANXIN_MATERIAL_SERVICE_URL: service.url, ANXIN_MATERIAL_SERVICE_TOKEN: token };
  const privateConfig = join(temp, 'wrangler.json');
  await writeFile(privateConfig, JSON.stringify(config), { mode: 0o600 });
  const wrangler = resolve('node_modules/wrangler/bin/wrangler.js');
  const common = ['--local', '--config', privateConfig, '--persist-to', join(temp, 'state')];
  // Suppress Wrangler's binding display so ephemeral credentials are not logged.
  const workerEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false' };
  await run([wrangler, 'd1', 'migrations', 'apply', 'DB', ...common], { stdio: 'ignore', env: workerEnv });
  worker = spawn(process.execPath, [wrangler, 'dev', ...common, '--ip', '127.0.0.1', '--port', String(port)], { stdio: 'ignore', env: workerEnv });
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (worker.exitCode !== null) throw new Error('Isolated Worker stopped before readiness.');
    try { if ((await fetch(`http://127.0.0.1:${port}/api/bootstrap`)).status === 401) { ready = true; break; } } catch { /* bounded startup */ }
    await new Promise((yes) => setTimeout(yes, 500));
  }
  if (!ready) throw new Error('Isolated Worker readiness timed out.');
  const { mkdir } = await import('node:fs/promises'); await mkdir(dirname(output), { recursive: true });
  const regressionArgs = ['scripts/material-http-regression.mjs', `http://127.0.0.1:${port}`, output, mode, '--service-restart'];
  if (process.argv.includes('--punctuation-equivalence')) regressionArgs.push('--punctuation-equivalence');
  const regression = spawn(process.execPath, regressionArgs, { stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
  let restartOperation;
  let restarted = false;
  // Only this isolated child can request a restart. There is no HTTP control
  // route, and the same private token/loopback port remain bound in the Worker.
  regression.on('message', (message) => {
    if (message?.type !== 'restart-material-service' || typeof message.requestId !== 'string') return;
    const reply = (detail) => {
      if (regression.connected) regression.send({ type: 'material-service-restarted', requestId: message.requestId, ...detail });
    };
    if (restarted) { reply({ error: 'Only one service restart is allowed per isolated regression.' }); return; }
    restarted = true;
    restartOperation = (async () => {
      try {
        const servicePort = Number(new URL(service.url).port);
        await service.close();
        service = await createMaterialService({ token, port: servicePort, model });
        reply({ ok: true });
      } catch (error) { reply({ error: error.message }); }
    })();
  });
  try {
    await new Promise((yes, no) => {
      regression.once('error', no);
      regression.once('exit', (code) => code === 0 ? yes() : no(new Error(`Material regression exited ${code}`)));
    });
  } finally { await restartOperation; }
} finally {
  try {
    if (worker && worker.exitCode === null) {
      const done = new Promise((yes) => worker.once('exit', yes)); worker.kill('SIGTERM'); await done;
    }
    await service?.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
