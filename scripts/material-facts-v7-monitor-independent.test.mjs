import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCE = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const ENGINE = resolve(process.env.V7_RUNNER_ROOT ?? SOURCE);
const E = 'experiments/material-facts-v7';
const { RUN_HASH_FILES } = await import(pathToFileURL(resolve(SOURCE, E, 'freeze.mjs')));
const { withExperimentLock } = await import(pathToFileURL(resolve(SOURCE, E, 'experiment-lock.mjs')));
console.log(JSON.stringify({ evidence: 'reviewed_runner_sha256', sha256: createHash('sha256').update(await readFile(resolve(ENGINE, E, 'run.mjs'))).digest('hex') }));
const delay = ms => new Promise(done => setTimeout(done, ms));
async function write(root, path, bytes, options) {
  await mkdir(dirname(resolve(root, path)), { recursive: true });
  await writeFile(resolve(root, path), bytes, options);
}
async function waitFor(path) {
  const deadline = Date.now() + 6000;
  while (true) {
    try { return await readFile(path); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    assert(Date.now() < deadline, 'Synthetic process did not reach its controlled barrier.');
    await delay(5);
  }
}

// Unlike the author's append barrier, hold a real execFile memory query open.
// The worker finishes before that query settles; no append is monkeypatched.
const SYSCTL = String.raw`
import {readFile,writeFile} from 'node:fs/promises';
const root=process.env.INDEPENDENT_MONITOR_ROOT;
if(process.argv.includes('vm.swapusage'))console.log('total = 1024M used = 0M free = 1024M');
else {
 let count=0;try{count=Number(await readFile(root+'/pressure-count','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 await writeFile(root+'/pressure-count',String(++count));
 if(count===2){
  await writeFile(root+'/measurement-pending','pending');
  const deadline=Date.now()+6000;
  while(true){try{await readFile(root+'/release-query');break;}catch(error){if(error.code!=='ENOENT')throw error;}
   if(Date.now()>deadline)throw new Error('Synthetic query barrier expired');
   await new Promise(done=>setTimeout(done,5));}
  if(process.env.INDEPENDENT_MONITOR_FAILURE==='yes')process.exit(23);
 }
 console.log('1');
}
`;
const WORKER = String.raw`
import {readFile} from 'node:fs/promises';
let text='';for await(const chunk of process.stdin)text+=chunk;
const deadline=Date.now()+6000;
while(true){try{await readFile(process.env.INDEPENDENT_MONITOR_ROOT+'/measurement-pending');break;}
 catch(error){if(error.code!=='ENOENT')throw error;}
 if(Date.now()>deadline)throw new Error('Synthetic worker barrier expired');
 await new Promise(done=>setTimeout(done,5));}
for(const row of text.trim().split('\n').map(JSON.parse))console.log(JSON.stringify({type:'result',id:row.id,backend:'qwen',raw_output:'{"schemaVersion":3,"candidates":[]}',finish_reason:'stop'}));
`;
const PRELOAD = String.raw`
import cp from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
if(process.argv[1]?.endsWith('/run.mjs')){
 const interval=globalThis.setInterval,nativeSpawn=cp.spawn;
 globalThis.setInterval=(callback,ms,...args)=>interval(callback,ms===2000?15:ms,...args);
 cp.spawn=(...args)=>{const child=nativeSpawn(...args);child.once('close',()=>writeFileSync(process.env.INDEPENDENT_MONITOR_ROOT+'/worker-closed','closed'));return child;};
 syncBuiltinESMExports();
}
`;

for (const fail of [false, true]) test('a pending memory query retains the lock and settles before terminal evidence: ' + (fail ? 'late failure' : 'late success'), { timeout: 20000 }, async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'anxin-independent-monitor-query-'));
  let running;
  try {
    const files = new Set([...RUN_HASH_FILES, `${E}/data/dev.inputs.jsonl`, `${E}/api-models-preflight.json`,
      `${E}/experiment-lock.mjs`, 'experiments/material-facts-v6/freeze.mjs']);
    for (const name of await readdir(resolve(SOURCE, 'lib')))
      if (name.endsWith('.ts') && !name.endsWith('.test.ts')) files.add('lib/' + name);
    for (const path of files) {
      await mkdir(dirname(resolve(root, path)), { recursive: true });
      await copyFile(resolve(path === `${E}/run.mjs` ? ENGINE : SOURCE, path), resolve(root, path));
    }
    await write(root, 'package.json', '{"type":"module"}\n');
    await write(root, `${E}/verify.mjs`, 'export async function verifyPreflight(){throw new Error("Formal model attempts are forbidden in the synthetic fixture");}\n');
    await write(root, 'model/config.json', '{}\n');
    await write(root, 'integrity/source-manifest.json', '{}\n');
    await write(root, 'integrity/weights-verification.json', '{}\n');
    await write(root, 'worker.mjs', WORKER);
    await write(root, 'preload.mjs', PRELOAD);
    await write(root, 'synthetic-python.mjs', `#!${process.execPath}\nif(process.argv[2]==='-c')console.log('anxin-v7-python-ready');else await import('./worker.mjs');\n`, { mode: 0o700 });
    await write(root, 'bin/sysctl', `#!${process.execPath}\n${SYSCTL}`, { mode: 0o700 });
    const out = resolve(root, E, 'results/dev-qwen-query');
    const child = spawn(process.execPath, ['--import', resolve(root, 'preload.mjs'), resolve(root, E, 'run.mjs'),
      '--mode', 'diagnostic', '--backend', 'qwen', '--inputs', resolve(root, E, 'data/dev.inputs.jsonl'),
      '--out', out, '--python', resolve(root, 'synthetic-python.mjs'), '--model-path', resolve(root, 'model'), '--integrity-dir', resolve(root, 'integrity')], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
        PATH: `${resolve(root, 'bin')}:${process.env.PATH}`, INDEPENDENT_MONITOR_ROOT: root,
        INDEPENDENT_MONITOR_FAILURE: fail ? 'yes' : 'no' },
    });
    let stderr = '';
    child.stdout.resume(); child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    running = { child, done: new Promise((done, reject) => {
      child.once('error', reject); child.once('close', (code, signal) => { clearTimeout(timer); done({ code, signal }); });
    }) };
    await waitFor(resolve(root, 'measurement-pending'));
    await waitFor(resolve(root, 'worker-closed'));
    await delay(150);
    try {
      await assert.rejects(stat(resolve(out, 'outcome.json')), { code: 'ENOENT' });
      await assert.rejects(withExperimentLock(root, 'freeze', async () => assert.fail('Freeze entered while memory evidence was pending.')), { code: 'EEXIST' });
      assert.equal(await readFile(resolve(out, 'results.jsonl'), 'utf8'), '');
    } finally { await write(root, 'release-query', 'release'); }
    const result = await running.done;
    assert.equal(result.signal, null, stderr);
    assert.equal(result.code, fail ? 1 : 0, stderr);
    const outcome = JSON.parse(await readFile(resolve(out, 'outcome.json')));
    assert.equal(outcome.completed, !fail);
    if (fail) {
      assert.equal(outcome.attempts.length, 1);
      assert.equal(outcome.attempts[0].stop_reason, 'monitor_error');
      assert.equal(outcome.attempts[0].monitor_error_type, 'Error');
      const rows = (await readFile(resolve(out, 'results.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
      assert.equal(rows[0].finish_reason, 'monitor_error');
      assert.equal(rows[0].original_finish_reason, 'stop');
    } else assert.equal(outcome.attempts.length, 3);
    await assert.rejects(stat(resolve(root, E, '.experiment.lock')), { code: 'ENOENT' });
  } finally {
    await write(root, 'release-query', 'release');
    if (running) {
      if (running.child.exitCode === null && running.child.signalCode === null) running.child.kill('SIGTERM');
      await running.done;
    }
    await rm(root, { recursive: true, force: true });
  }
});
