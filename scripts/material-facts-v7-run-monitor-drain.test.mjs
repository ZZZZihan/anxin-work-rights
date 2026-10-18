import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, readdir, rm, chmod, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SOURCE = resolve(process.env.MATERIAL_FACTS_V7_SOURCE_ROOT || ROOT);
const ENGINE = resolve(process.env.MATERIAL_FACTS_V7_ENGINEERING_ROOT || ROOT);
const E = 'experiments/material-facts-v7';
const { RUN_HASH_FILES } = await import(pathToFileURL(resolve(SOURCE, E, 'freeze.mjs')));
const { withExperimentLock } = await import(pathToFileURL(resolve(ENGINE, E, 'experiment-lock.mjs')));
const write = async (root, file, value) => { await mkdir(dirname(resolve(root, file)), { recursive: true }); await writeFile(resolve(root, file), value); };
const delay = milliseconds => new Promise(done => setTimeout(done, milliseconds));

// The worker emits only fixed local results. Fake sysctl output below exercises
// the real Qwen monitor branch without importing MLX or making network calls.
const WORKER = String.raw`
import { readFile, writeFile } from 'node:fs/promises';
let input='';for await(const chunk of process.stdin)input+=chunk;
const rows=input.trim().split('\n').map(JSON.parse);
const parent=process.ppid,deadline=Date.now()+5000;
if(process.env.MONITOR_SCENARIO!=='fast-exit')while(true){
  if(process.ppid!==parent||Date.now()>deadline)throw new Error('Synthetic barrier was not released');
  try{await readFile(process.env.MONITOR_STARTED);break;}catch(error){if(error.code!=='ENOENT')throw error;}
  await new Promise(done=>setTimeout(done,5));
}
for(const row of rows)console.log(JSON.stringify({type:'result',id:row.id,raw_output:'{"schemaVersion":3,"candidates":[]}',finish_reason:'stop'}));
await writeFile(process.env.MONITOR_WORKER_DONE,'done');
`;

// Only the first memory append is delayed. A real async append is then allowed
// to finish or reject after the worker has exited. No runner source is changed
// in the fixture; the synchronous markers expose terminal-write ordering.
const PRELOAD = String.raw`
import io from 'node:fs/promises';
import cp from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
if(process.argv[1]?.endsWith('/run.mjs')){
 const append=io.appendFile,write=io.writeFile,nativeSpawn=cp.spawn,interval=globalThis.setInterval;
 const metrics={memory_started:0,memory_settled:0,terminal_before_monitor_settled:false,worker_closed:0};
 let delayed=false;
 globalThis.setInterval=(callback,ms,...args)=>interval(callback,ms===2000&&process.env.MONITOR_SCENARIO!=='fast-exit'?10:ms,...args);
 cp.spawn=(...args)=>{const child=nativeSpawn(...args);child.once('close',()=>{metrics.worker_closed++;writeFileSync(process.env.MONITOR_CLOSED,String(metrics.worker_closed));});return child;};
 io.appendFile=async(path,data,...args)=>{
  if(String(path).endsWith('/memory.jsonl')){
   metrics.memory_started++;
   try{
    if(!delayed){delayed=true;await write(process.env.MONITOR_STARTED,'started');
     while(true){try{await io.readFile(process.env.MONITOR_RELEASE);break;}catch(error){if(error.code!=='ENOENT')throw error;}await new Promise(done=>setTimeout(done,5));}
     if(process.env.MONITOR_SCENARIO==='late-append-error'){const error=new Error('synthetic private path should not be logged');error.name='SyntheticMonitorAppendError';throw error;}
    }
    return await append(path,data,...args);
   }finally{metrics.memory_settled++;}
  }
  return append(path,data,...args);
 };
 io.writeFile=async(path,...args)=>{
  if(String(path).endsWith('/outcome.json')&&metrics.memory_started!==metrics.memory_settled)metrics.terminal_before_monitor_settled=true;
  return write(path,...args);
 };
 syncBuiltinESMExports();
 process.on('exit',()=>writeFileSync(process.env.MONITOR_METRICS,JSON.stringify(metrics)));
}
`;

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'anxin-v7-monitor-drain-'));
  const f = { root, out: resolve(root, E, 'results/dev-qwen-monitor') };
  t.after(async () => {
    await writeFile(resolve(root, 'release-monitor'), 'release');
    if (f.running) {
      const { child, finished } = f.running;
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await finished;
    }
    await rm(root, { recursive: true, force: true });
  });
  await write(root, 'package.json', '{"type":"module"}\n');
  const files = new Set([...RUN_HASH_FILES, `${E}/experiment-lock.mjs`, `${E}/data/dev.inputs.jsonl`, `${E}/api-models-preflight.json`, 'experiments/material-facts-v6/freeze.mjs']);
  for (const file of await readdir(resolve(SOURCE, 'lib'))) if (file.endsWith('.ts') && !file.endsWith('.test.ts')) files.add(`lib/${file}`);
  for (const file of files) {
    const from = [`${E}/run.mjs`, `${E}/experiment-lock.mjs`].includes(file) ? ENGINE : SOURCE;
    await mkdir(dirname(resolve(root, file)), { recursive: true });
    await copyFile(resolve(from, file), resolve(root, file));
  }
  await write(root, `${E}/verify.mjs`, 'export async function verifyPreflight(){throw new Error("No formal attempt is permitted in this fixture");}\n');
  const python = resolve(root, 'synthetic-python.mjs');
  await writeFile(python, `#!${process.execPath}\nif(process.argv[2]==='-c')console.log('anxin-v7-python-ready');else await import('./synthetic-worker.mjs');\n`, { mode: 0o700 });
  await chmod(python, 0o700);
  await write(root, 'synthetic-worker.mjs', WORKER);
  await write(root, 'preload.mjs', PRELOAD);
  await write(root, 'model/config.json', '{}\n');
  await write(root, 'integrity/source-manifest.json', '{}\n');
  await write(root, 'integrity/weights-verification.json', '{}\n');
  await write(root, 'bin/sysctl', `#!${process.execPath}\nconsole.log(process.argv.includes('vm.swapusage')?'total = 1024M used = 0M free = 1024M':'1');\n`);
  await chmod(resolve(root, 'bin/sysctl'), 0o700);
  return { ...f, python, get running() { return f.running; }, set running(value) { f.running = value; } };
}

async function waitFor(path) {
  const deadline = Date.now() + 5000;
  while (true) {
    try { return await readFile(path, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    assert(Date.now() < deadline, `Synthetic barrier was not reached: ${path}`);
    await delay(5);
  }
}

function start(f, scenario) {
  const args = ['--import', resolve(f.root, 'preload.mjs'), resolve(f.root, E, 'run.mjs'), '--mode', 'diagnostic', '--backend', 'qwen', '--inputs', resolve(f.root, E, 'data/dev.inputs.jsonl'), '--out', f.out, '--python', f.python, '--model-path', resolve(f.root, 'model'), '--integrity-dir', resolve(f.root, 'integrity')];
  const child = spawn(process.execPath, args, { cwd: f.root, env: { ...process.env, PATH: `${resolve(f.root, 'bin')}:${process.env.PATH}`, MONITOR_SCENARIO: scenario, MONITOR_STARTED: resolve(f.root, 'monitor-started'), MONITOR_RELEASE: resolve(f.root, 'release-monitor'), MONITOR_WORKER_DONE: resolve(f.root, 'worker-done'), MONITOR_CLOSED: resolve(f.root, 'worker-closed'), MONITOR_METRICS: resolve(f.root, 'monitor-metrics.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 7000);
  const finished = new Promise((done, reject) => { child.once('error', reject); child.once('close', (code, signal) => { clearTimeout(timer); done({ code, signal, stdout, stderr }); }); });
  f.running = { child, finished };
  return f.running;
}

for (const scenario of ['delayed-success', 'late-append-error']) test(`pending memory append drains before diagnostic terminal files and unlock: ${scenario}`, async t => {
  const f = await fixture(t), running = start(f, scenario);
  await waitFor(resolve(f.root, 'monitor-started'));
  await waitFor(resolve(f.root, 'worker-closed'));
  // Wait past the old close continuation, while the controlled write remains
  // pending. The lock must still reject a real freeze contender.
  await delay(150);
  try {
    await assert.rejects(stat(resolve(f.out, 'outcome.json')), { code: 'ENOENT' });
    await assert.rejects(withExperimentLock(f.root, 'freeze', async () => assert.fail('Freeze entered before monitor drain')), { code: 'EEXIST' });
    assert.equal(await readFile(resolve(f.out, 'results.jsonl'), 'utf8'), '');
  } finally { await writeFile(resolve(f.root, 'release-monitor'), 'release'); }
  const result = await running.finished;
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.code, scenario === 'delayed-success' ? 0 : 1, result.stderr);
  const outcome = JSON.parse(await readFile(resolve(f.out, 'outcome.json')));
  const metrics = JSON.parse(await readFile(resolve(f.root, 'monitor-metrics.json')));
  assert.equal(metrics.memory_started, metrics.memory_settled);
  assert.equal(metrics.terminal_before_monitor_settled, false);
  await assert.rejects(stat(resolve(f.root, E, '.experiment.lock')), { code: 'ENOENT' });
  if (scenario === 'delayed-success') {
    assert.equal(outcome.completed, true);
    assert((await readFile(resolve(f.out, 'memory.jsonl'), 'utf8')).trim());
    assert.equal(outcome.attempts.length, 3);
  } else {
    assert.equal(outcome.completed, false);
    assert.equal(outcome.attempts.length, 1);
    assert.equal(outcome.attempts[0].stop_reason, 'monitor_error');
    assert.equal(outcome.attempts[0].monitor_error_type, 'SyntheticMonitorAppendError');
    assert(!JSON.stringify(outcome).includes('synthetic private path'));
    const rows = (await readFile(resolve(f.out, 'results.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(rows[0].finish_reason, 'monitor_error');
    assert.equal(rows[0].original_finish_reason, 'stop');
  }
  const before = createHash('sha256').update(await readFile(resolve(f.out, 'outcome.json'))).digest('hex');
  await delay(50);
  assert.equal(createHash('sha256').update(await readFile(resolve(f.out, 'outcome.json'))).digest('hex'), before);
});

test('an exited worker with no pending sample finishes without new monitor work or leaked timers', async t => {
  const f = await fixture(t), result = await start(f, 'fast-exit').finished;
  assert.equal(result.code, 0, result.stderr); assert.equal(result.signal, null);
  assert.equal(JSON.parse(await readFile(resolve(f.out, 'outcome.json'))).completed, true);
  const metrics = JSON.parse(await readFile(resolve(f.root, 'monitor-metrics.json')));
  assert.equal(metrics.memory_started, metrics.memory_settled);
  assert.equal(metrics.terminal_before_monitor_settled, false);
  await assert.rejects(stat(resolve(f.root, E, '.experiment.lock')), { code: 'ENOENT' });
});
