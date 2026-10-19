import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.env.MATERIAL_FACTS_V7_ENGINEERING_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const E = 'experiments/material-facts-v7';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const put = async (root, path, bytes, options) => { const target = resolve(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes, options); return target; };

// The unchanged runner and real lock run in an owned tree. Only dataset/hash
// preflight, prompt construction, memory probes and the byte-producing worker
// are synthetic. No model, network, scorer or historical verifier is executed.
async function fixture(t, scenario) {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), 'anxin-r43-run-independent-'))), children = [];
  t.after(async () => {
    await writeFile(resolve(root, 'release-worker'), 'release');
    for (const item of children) if (item.child.exitCode === null && item.child.signalCode === null) item.child.kill('SIGKILL');
    await Promise.allSettled(children.map(item => item.closed)); await rm(root, { recursive: true, force: true });
  });
  await put(root, 'package.json', '{"type":"module"}\n');
  for (const name of ['run.mjs', 'experiment-lock.mjs']) {
    await mkdir(resolve(root, E), { recursive: true }); await copyFile(resolve(ROOT, E, name), resolve(root, E, name));
  }
  const records = [1, 2].map(n => ({ id: `isolated-${n}`, source: { text: `Owned synthetic case ${n}` } }));
  const inputBytes = records.map(row => JSON.stringify(row)).join('\n') + '\n';
  const messages = records.map(row => ({ id: row.id, messages: [{ role: 'user', content: row.source.text }] }));
  const freeze = { input_sha256: hash(inputBytes), messages_sha256: hash(messages.map(row => JSON.stringify(row)).join('\n') + '\n'), deepseek_egress: 'direct' };
  await put(root, 'inputs.jsonl', inputBytes); await put(root, `${E}/freeze.json`, JSON.stringify(freeze));
  await put(root, `${E}/freeze.mjs`, `export const EXPERIMENT=${JSON.stringify(E)},RUN_HASH_FILES=[],QWEN_MEMORY={};export const loadPolicy=async()=>({deepseek:{egress:'direct'}});export const deepseekReservation=()=>0,priorDeepseekReservation=async()=>0;`);
  await put(root, `${E}/verify.mjs`, `import{readFile}from'node:fs/promises';export async function verifyPreflight(root){return{freeze:JSON.parse(await readFile(root+'/${E}/freeze.json','utf8'))};}`);
  await put(root, 'lib/material-facts-v3.ts', 'export function extractRuleCandidates(){throw new Error("No rule backend in this probe");}');
  await put(root, 'lib/material-fact-extraction-v4.ts', 'export function buildExtractionMessagesV4(source){return[{role:"user",content:source.text}];}');
  for (const path of ['model/config.json', 'integrity/source-manifest.json', 'integrity/weights-verification.json']) await put(root, path, '{}');
  await put(root, 'scripts/fact-runtime-v2.py', '# Placeholder, never executed.\n');
  const worker = await put(root, 'isolated-worker', `#!${process.execPath}
import fs from 'node:fs';import{setTimeout as delay}from'node:timers/promises';
if(process.argv[2]==='-c'){console.log('anxin-v7-python-ready');}
else{let text='';for await(const bytes of process.stdin)text+=bytes;const row=JSON.parse(text.trim());
if(process.env.ISOLATED_SCENARIO==='bad-line'){process.stdout.write(JSON.stringify({type:'telemetry',id:row.id,marker:'kept'})+'\\nnot-json-record\\nUNTRUSTED-TAIL');}
else{if(process.env.ISOLATED_SCENARIO==='hold'&&row.id==='isolated-2'){fs.writeFileSync(process.env.ISOLATED_READY,'waiting');const end=Date.now()+7000;while(!fs.existsSync(process.env.ISOLATED_RELEASE)){if(Date.now()>end)throw Error('Synthetic worker barrier timeout');await delay(10);}}
console.log(JSON.stringify({type:'result',id:row.id,backend:'qwen',raw_output:'',finish_reason:'isolated_fixture_failure'}));}}
`, { mode: 0o700 });
  await put(root, 'bin/sysctl', `#!${process.execPath}\nconsole.log(process.argv[3]==='kern.memorystatus_vm_pressure_level'?'1':'total = 1024M used = 0M free = 1024M');\n`, { mode: 0o700 });
  await mkdir(resolve(root, E, 'results'));
  const out = resolve(root, E, 'results/holdout-qwen-1'), lock = resolve(root, E, '.experiment.lock');
  const cli = (file, args = [], extra = [], env = {}) => {
    const child = spawn(process.execPath, [...extra, file, ...args], { cwd: root, env: { ...process.env, PATH: resolve(root, 'bin') + ':' + process.env.PATH, ISOLATED_SCENARIO: scenario, ISOLATED_READY: resolve(root, 'worker-ready'), ISOLATED_RELEASE: resolve(root, 'release-worker'), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 12000);
    const closed = new Promise((resolveClose, reject) => { child.once('error', error => { clearTimeout(timer); reject(error); }); child.once('close', (code, signal) => { clearTimeout(timer); resolveClose({ code, signal, stdout, stderr }); }); });
    const item = { child, closed }; children.push(item); return item;
  };
  const run = (extra = [], env = {}) => cli(resolve(root, E, 'run.mjs'), ['--mode', 'holdout', '--backend', 'qwen', '--inputs', resolve(root, 'inputs.jsonl'), '--out', out, '--python', worker, '--model-path', resolve(root, 'model'), '--integrity-dir', resolve(root, 'integrity')], extra, env);
  return { root, out, lock, run, cli };
}

async function waitFor(path, running) {
  const deadline = Date.now() + 7000;
  while (!await exists(path)) {
    if (running.child.exitCode !== null || running.child.signalCode !== null) assert.fail(`Runner exited before barrier: ${JSON.stringify(await running.closed)}`);
    assert(Date.now() < deadline, `Timed out waiting for ${path}`); await delay(10);
  }
}

test('newline-terminated invalid worker bytes and buffered tail remain outside the JSON event protocol', async t => {
  const f = await fixture(t, 'bad-line'), result = await f.run().closed;
  assert.equal(result.code, 1); assert.equal(result.signal, null);
  const events = (await readFile(resolve(f.out, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(events.length, 1); assert.equal(events[0].marker, 'kept');
  assert.equal(await readFile(resolve(f.out, 'malformed-stdout-1.txt'), 'utf8'), 'not-json-record\nUNTRUSTED-TAIL');
  const outcome = JSON.parse(await readFile(resolve(f.out, 'outcome.json')));
  assert.equal(outcome.attempts[0].stop_reason, 'worker_output_error'); assert.equal(outcome.attempts[0].incomplete_stdout, false);
  assert.equal(await readFile(resolve(f.out, 'results.jsonl'), 'utf8'), ''); assert.equal(await exists(f.lock), false);
});

test('a real partial replacement write cannot truncate the previous complete outcome checkpoint', async t => {
  const f = await fixture(t, 'checkpoint'), snapshot = resolve(f.root, 'previous-outcome.snapshot');
  const preload = await put(f.root, 'fault-second-checkpoint.mjs', `
import fs from 'node:fs/promises';import{basename}from'node:path';import{syncBuiltinESMExports}from'node:module';
const native=fs.writeFile;let checkpoints=0;
fs.writeFile=async(path,data,options)=>{const name=basename(String(path));if((name==='outcome.json'||name.startsWith('.outcome.json.'))&&++checkpoints===2){await native(${JSON.stringify(snapshot)},await fs.readFile(${JSON.stringify(resolve(f.out, 'outcome.json'))}));await native(path,String(data).slice(0,11),options);throw Object.assign(Error('Isolated partial checkpoint fault'),{code:'EIO'});}return native(path,data,options);};syncBuiltinESMExports();
`);
  const result = await f.run(['--import', preload]).closed;
  assert.equal(result.code, 1); assert.match(result.stderr, /Isolated partial checkpoint fault/u);
  const previous = await readFile(snapshot), current = await readFile(resolve(f.out, 'outcome.json'));
  assert.deepEqual(current, previous); assert.equal(JSON.parse(current).attempts.length, 1);
  const stages = (await readdir(f.out)).filter(name => name.startsWith('.outcome.json.') && name.endsWith('.stage'));
  assert.equal(stages.length, 1); assert.equal((await readFile(resolve(f.out, stages[0]))).length, 11);
  assert.equal(await exists(f.lock), false);
});

test('the actual holdout CLI owns the lifecycle lock while its second worker is active and releases it at terminal checkpoint', async t => {
  const f = await fixture(t, 'hold'), running = f.run();
  await waitFor(resolve(f.root, 'worker-ready'), running);
  try {
    const prefix = JSON.parse(await readFile(resolve(f.out, 'outcome.json'))); assert.equal(prefix.attempts.length, 1);
    assert.equal(JSON.parse(await readFile(resolve(f.lock, 'owner.json'))).operation, 'holdout');
    const finalizer = await put(f.root, 'competing-finalizer.mjs', `import{withExperimentLock}from'./${E}/experiment-lock.mjs';import{writeFile}from'node:fs/promises';await withExperimentLock(${JSON.stringify(f.root)},'freeze',()=>writeFile(${JSON.stringify(resolve(f.root, 'forbidden-prefix-manifest.json'))},'must-not-seal'));`);
    const blocked = await f.cli(finalizer).closed; assert.equal(blocked.code, 1); assert.match(blocked.stderr, /Experiment lock already exists/u);
    assert.equal(await exists(resolve(f.root, 'forbidden-prefix-manifest.json')), false);
  } finally { await writeFile(resolve(f.root, 'release-worker'), 'release'); await running.closed; }
  const finished = await running.closed; assert.equal(finished.code, 1, 'Synthetic non-stop finish reason is deliberately a failed attempt'); assert.equal(finished.signal, null);
  assert.equal(JSON.parse(await readFile(resolve(f.out, 'outcome.json'))).attempts.length, 2); assert.equal(await exists(f.lock), false);
});
