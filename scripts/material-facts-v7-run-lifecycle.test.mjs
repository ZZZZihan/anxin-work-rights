import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, readdir, rm, chmod, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SOURCE = resolve(process.env.MATERIAL_FACTS_V7_SOURCE_ROOT || ROOT);
const ENGINE = resolve(process.env.MATERIAL_FACTS_V7_ENGINEERING_ROOT || ROOT);
const E = 'experiments/material-facts-v7';
const { RUN_HASH_FILES, messageBytes, loadPolicy } = await import(pathToFileURL(resolve(SOURCE, E, 'freeze.mjs')));
const { withExperimentLock } = await import(pathToFileURL(resolve(ENGINE, E, 'experiment-lock.mjs')));
const execute = promisify(execFile);
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const write = async (root, file, value) => { await mkdir(dirname(resolve(root, file)), { recursive: true }); await writeFile(resolve(root, file), value); };

// This process is a finite local byte producer. It never imports the model
// worker, reads a key or opens a network connection.
const WORKER = String.raw`
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
await writeFile(process.env.LIFECYCLE_WORKER_PID,String(process.pid));
let input = ''; for await (const chunk of process.stdin) input += chunk;
const rows = input.trim().split('\n').map(JSON.parse);
const send = async (stream, bytes) => { if (!stream.write(bytes)) await once(stream, 'drain'); };
const event = value => send(process.stdout, JSON.stringify(value) + '\n');
const complete = async () => { for (const row of rows) {
  await event({type:'requesting',id:row.id});
  await event({type:'result',id:row.id,backend:'deepseek',raw_output:'{"schemaVersion":3,"candidates":[]}',finish_reason:'stop'});
} };
if (process.env.LIFECYCLE_SCENARIO === 'exit-during-log') {
  await event({type:'requesting',id:rows[0].id}); process.exitCode = 7;
} else if (process.env.LIFECYCLE_SCENARIO === 'trailing-fragment') {
  await complete(); await send(process.stdout, '{\"type\":\"telemetry\"');
} else if (process.env.LIFECYCLE_SCENARIO === 'queued-success') {
  await complete();
} else if (process.env.LIFECYCLE_SCENARIO === 'hold') {
  while(true){try{await readFile(process.env.LIFECYCLE_RELEASE);break;}catch(error){if(error.code!=='ENOENT')throw error;}
    await new Promise(done=>setTimeout(done,10));}
  await complete();
} else if (['stderr-overflow','stderr-stubborn'].includes(process.env.LIFECYCLE_SCENARIO)) {
  if(process.env.LIFECYCLE_SCENARIO==='stderr-stubborn')process.on('SIGTERM',()=>{});
  for (let i=0;i<32;i++) await send(process.stderr,Buffer.alloc(1024*1024,101));
  if(process.env.LIFECYCLE_SCENARIO==='stderr-stubborn')setInterval(()=>{},1000);
  else await complete();
} else if (process.env.LIFECYCLE_SCENARIO === 'stdout-overflow') {
  for (let i=0;i<32;i++) await event({type:'telemetry',payload:'s'.repeat(1024*1024)});
  await complete();
} else if (process.env.LIFECYCLE_SCENARIO === 'independent-limits') {
  for (let i=0;i<12;i++) {
    await event({type:'telemetry',payload:'s'.repeat(1024*1024)});
    await send(process.stderr,Buffer.alloc(1024*1024,101));
  }
  await complete();
} else if (process.env.LIFECYCLE_SCENARIO === 'backpressure') {
  for (let i=0;i<4000;i++) {
    await event({type:'telemetry',payload:'finite-local-event'});
    await send(process.stderr,Buffer.alloc(512,101));
  }
  await complete();
} else if (process.env.LIFECYCLE_SCENARIO === 'utf8') {
  for (const row of rows) {
    await event({type:'requesting',id:row.id});
    const line=Buffer.from(JSON.stringify({type:'result',id:row.id,backend:'deepseek',raw_output:'中文金额四万元',finish_reason:'stop'})+'\n');
    const split=line.indexOf(Buffer.from('中'))+1;
    await send(process.stdout,line.subarray(0,split));
    await new Promise(done=>setTimeout(done,10));
    await send(process.stdout,line.subarray(split));
  }
} else throw new Error('Unknown synthetic scenario');
`;

// Delay just the first write on each stream so a worker can exit or fill a pipe
// before the disk operation completes. Observations measure bytes received but
// not yet persisted; this catches eager promise queues, not just final log size.
const PRELOAD = String.raw`
import io from 'node:fs/promises';
import cp from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
if (process.argv[1]?.endsWith('/run.mjs')) {
  const metrics={stdout:{received:0,persisted:0,peak_unwritten:0,pauses:0},stderr:{received:0,persisted:0,peak_unwritten:0,pauses:0}};
  const nativeSpawn=cp.spawn, append=io.appendFile, delayed=new Set();
  cp.spawn=(...args)=>{
    const child=nativeSpawn(...args);
    for(const name of ['stdout','stderr']) {
      const stream=child[name], pause=stream.pause;
      stream.pause=function(...args){metrics[name].pauses++;return pause.apply(this,args);};
      stream.on('data',chunk=>{const m=metrics[name];m.received+=chunk.length;m.peak_unwritten=Math.max(m.peak_unwritten,m.received-m.persisted);});
    }
    return child;
  };
  io.appendFile=async(path,data,...args)=>{
    const name=String(path).endsWith('/events.jsonl')?'stdout':String(path).endsWith('/worker.log')?'stderr':null;
    if(name&&!delayed.has(name)){delayed.add(name);await new Promise(done=>setTimeout(done,150));}
    const value=await append(path,data,...args);
    if(name)metrics[name].persisted+=Buffer.byteLength(data);
    return value;
  };
  syncBuiltinESMExports();
  process.on('exit',()=>writeFileSync(process.env.LIFECYCLE_METRICS,JSON.stringify(metrics)));
}
`;

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'anxin-v7-lifecycle-'));
  t.after(async () => {
    try { process.kill(Number(await readFile(resolve(root, 'worker.pid'), 'utf8')), 'SIGKILL'); }
    catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error; }
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
  // The runner gate is stubbed only in this temporary synthetic tree. No real
  // holdout inputs/results or old freeze are read, modified or regenerated.
  await write(root, `${E}/verify.mjs`, `import {readFile} from 'node:fs/promises';
export async function verifyPreflight(root){return {freeze:JSON.parse(await readFile(root+'/${E}/freeze.json','utf8'))};}
`);
  const inputs = await readFile(resolve(root, E, 'data/dev.inputs.jsonl'));
  const rows = inputs.toString().trim().split('\n').map(JSON.parse);
  const policy = await loadPolicy(root);
  await write(root, `${E}/freeze.json`, json({ input_sha256: sha(inputs), messages_sha256: sha(await messageBytes(rows, root)), deepseek_egress: policy.deepseek.egress }));
  const python = resolve(root, 'synthetic-python.mjs');
  await writeFile(python, `#!${process.execPath}\nif(process.argv[2]==='-c')console.log('anxin-v7-python-ready');else await import('./synthetic-worker.mjs');\n`, { mode: 0o700 });
  await chmod(python, 0o700);
  await write(root, 'synthetic-worker.mjs', WORKER);
  await write(root, 'preload.mjs', PRELOAD);
  await writeFile(resolve(root, 'synthetic-key'), 'synthetic-not-a-real-key\n', { mode: 0o600 });
  return { root, rows, python, policy };
}

async function run(f, scenario, mode = 'holdout', name = 'holdout-deepseek-1') {
  const out = resolve(f.root, E, 'results', name);
  const args = ['--import', resolve(f.root, 'preload.mjs'), resolve(f.root, E, 'run.mjs'), '--mode', mode, '--backend', 'deepseek', '--inputs', resolve(f.root, E, 'data/dev.inputs.jsonl'), '--out', out, '--python', f.python, '--key-file', resolve(f.root, 'synthetic-key')];
  if (f.policy.deepseek.egress === 'temporary_loopback_ssh_test_host') args.push('--connect-port', '443');
  const started = Date.now();
  const env = { ...process.env, LIFECYCLE_SCENARIO: scenario, LIFECYCLE_METRICS: resolve(f.root, 'lifecycle-metrics.json'), LIFECYCLE_WORKER_PID: resolve(f.root, 'worker.pid'), LIFECYCLE_RELEASE: resolve(f.root, 'release-worker') };
  try { const result = await execute(process.execPath, args, { cwd: f.root, env, timeout: 6000, killSignal: 'SIGKILL', maxBuffer: 128 * 1024 }); return { code: 0, out, elapsed: Date.now() - started, ...result }; }
  catch (error) { return { code: error.code, signal: error.signal, killed: error.killed, out, elapsed: Date.now() - started, stdout: error.stdout, stderr: error.stderr }; }
}

test('a requesting event queued behind disk I/O cannot keep an exited worker parent alive', async t => {
  const f = await fixture(t), result = await run(f, 'exit-during-log');
  assert.equal(result.code, 1, `The runner must exit on its own rather than hit the fixture deadline: ${JSON.stringify(result)}`);
  assert.equal(result.killed, false);
  const outcome = JSON.parse(await readFile(resolve(result.out, 'outcome.json')));
  assert.equal(outcome.completed, false); assert.equal(outcome.attempts[0].code, 7);
  assert.equal(JSON.parse((await readFile(resolve(result.out, 'events.jsonl'), 'utf8')).trim()).type, 'requesting');
  assert.equal(await readFile(resolve(result.out, 'results.jsonl'), 'utf8'), '');
});

test('stderr overflow stops the finite worker and preserves a bounded failed attempt', async t => {
  const f = await fixture(t), result = await run(f, 'stderr-overflow');
  assert.equal(result.code, 1, result.stderr);
  const outcome = JSON.parse(await readFile(resolve(result.out, 'outcome.json')));
  assert.equal(outcome.completed, false);
  assert.equal(outcome.attempts[0].stop_reason, 'stderr_output_limit');
  assert((await stat(resolve(result.out, 'worker.log'))).size <= 20_000_000);
  const before = await readFile(resolve(result.out, 'outcome.json'));
  const retry = await run(f, 'stderr-overflow');
  assert.equal(retry.code, 1); assert.match(retry.stderr, /EEXIST/);
  assert.deepEqual(await readFile(resolve(result.out, 'outcome.json')), before);
});

test('a stderr producer ignoring SIGTERM is killed within the grace period and leaves no live worker', async t => {
  const f = await fixture(t), result = await run(f, 'stderr-stubborn');
  assert.equal(result.code, 1, JSON.stringify(result)); assert.equal(result.killed, false);
  const outcome = JSON.parse(await readFile(resolve(result.out, 'outcome.json')));
  assert.equal(outcome.completed, false); assert.equal(outcome.attempts[0].stop_reason, 'stderr_output_limit');
  assert.equal(outcome.attempts[0].signal, 'SIGKILL');
  const pid = Number(await readFile(resolve(f.root, 'worker.pid'), 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  assert((await stat(resolve(result.out, 'worker.log'))).size <= 20_000_000);
});

test('stdout and stderr pause independently while writes are pending rather than accumulating promises', async t => {
  const f = await fixture(t), result = await run(f, 'backpressure');
  assert.equal(result.code, 0, result.stderr);
  const metrics = JSON.parse(await readFile(resolve(f.root, 'lifecycle-metrics.json')));
  for (const name of ['stdout', 'stderr']) {
    assert(metrics[name].pauses > 0, `${name} must apply readable backpressure`);
    assert(metrics[name].peak_unwritten <= 256 * 1024, `${name} queued ${metrics[name].peak_unwritten} bytes before persistence`);
    assert.equal(metrics[name].received, metrics[name].persisted);
  }
});

test('complete requesting/result events queued past process exit remain successful and drain before parent exit', async t => {
  const f = await fixture(t), result = await run(f, 'queued-success');
  assert.equal(result.code, 0, result.stderr);
  const outcome = JSON.parse(await readFile(resolve(result.out, 'outcome.json')));
  assert.equal(outcome.completed, true);
  assert.equal((await readFile(resolve(result.out, 'results.jsonl'), 'utf8')).trim().split('\n').length, f.rows.length);
});

test('stdout retains its own byte cap and failure receipt', async t => {
  const f = await fixture(t), result = await run(f, 'stdout-overflow');
  assert.equal(result.code, 1, result.stderr);
  const outcome = JSON.parse(await readFile(resolve(result.out, 'outcome.json')));
  assert.equal(outcome.completed, false); assert.equal(outcome.attempts[0].stop_reason, 'output_limit');
  assert((await stat(resolve(result.out, 'events.jsonl'))).size <= 20_000_000);
});

test('the stdout cap and stderr cap are independent rather than a shared total', async t => {
  const f = await fixture(t), result = await run(f, 'independent-limits');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(await readFile(resolve(result.out, 'outcome.json'))).completed, true);
  assert((await stat(resolve(result.out, 'events.jsonl'))).size > 12_000_000);
  assert((await stat(resolve(result.out, 'worker.log'))).size > 12_000_000);
});

test('backpressure preserves UTF-8 split across stdout chunks', async t => {
  const f = await fixture(t), result = await run(f, 'utf8');
  assert.equal(result.code, 0, result.stderr);
  const rows = (await readFile(resolve(result.out, 'results.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert(rows.every(row => row.raw_output === '中文金额四万元'));
});

test('the actual diagnostic runner holds the freeze lock until terminal output is saved', async t => {
  const f = await fixture(t); await rm(resolve(f.root, E, 'freeze.json'));
  const running = run(f, 'hold', 'diagnostic', 'dev-deepseek-owner');
  const deadline = Date.now() + 4000;
  while(true) {
    try { await stat(resolve(f.root, 'worker.pid')); break; }
    catch(error) { if(error.code!=='ENOENT')throw error; }
    assert(Date.now() < deadline, 'Synthetic diagnostic must reach its worker barrier');
    await new Promise(done => setTimeout(done, 10));
  }
  const owner = JSON.parse(await readFile(resolve(f.root, E, '.experiment.lock/owner.json')));
  assert.equal(owner.operation, 'diagnostic');
  await assert.rejects(withExperimentLock(f.root, 'freeze', async () => assert.fail('Freeze entered an active diagnostic')), { code: 'EEXIST' });
  const contender = await run(f, 'queued-success', 'diagnostic', 'dev-deepseek-contender');
  assert.equal(contender.code, 1); assert.match(contender.stderr, /EEXIST/);
  await assert.rejects(stat(contender.out), { code: 'ENOENT' });
  await writeFile(resolve(f.root, 'release-worker'), 'release');
  const result = await running; assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(await readFile(resolve(result.out, 'outcome.json'))).completed, true);
  await assert.rejects(stat(resolve(f.root, E, '.experiment.lock')), { code: 'ENOENT' });
});

test('the actual diagnostic runner cannot allocate during or after freeze publication', async t => {
  const f = await fixture(t); await rm(resolve(f.root, E, 'freeze.json'));
  await withExperimentLock(f.root, 'freeze', async () => {
    const result = await run(f, 'queued-success', 'diagnostic', 'dev-deepseek-during-freeze');
    assert.equal(result.code, 1); assert.match(result.stderr, /EEXIST/);
    await assert.rejects(stat(result.out), { code: 'ENOENT' });
    await writeFile(resolve(f.root, E, 'freeze.json'), '{"synthetic_freeze":true}\n');
  });
  const after = await run(f, 'queued-success', 'diagnostic', 'dev-deepseek-after-freeze');
  assert.equal(after.code, 1); assert.match(after.stderr, /Diagnostic attempts are closed/);
  await assert.rejects(stat(after.out), { code: 'ENOENT' });
  await assert.rejects(stat(resolve(f.root, E, '.experiment.lock')), { code: 'ENOENT' });
});

// A complete set of result lines does not complete a truncated event stream.
test('all stop results followed by an unterminated stdout fragment remain a preserved failed attempt', async t => {
  const f = await fixture(t), result = await run(f, 'trailing-fragment');
  assert.equal(result.code, 1, result.stderr);
  const outcome = JSON.parse(await readFile(resolve(result.out, 'outcome.json')));
  assert.equal(outcome.completed, false);
  assert.equal(outcome.attempts[0].completed, false);
  assert.equal(outcome.attempts[0].incomplete_stdout, true);
  assert.equal(outcome.attempts[0].stop_reason, 'incomplete_stdout');
  assert.equal(await readFile(resolve(result.out, 'partial-stdout-1.txt'), 'utf8'), '{"type":"telemetry"');
  assert.equal((await readFile(resolve(result.out, 'results.jsonl'), 'utf8')).trim().split('\n').length, f.rows.length);
});
