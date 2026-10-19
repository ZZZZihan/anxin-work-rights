import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ENGINE = resolve(process.env.MATERIAL_FACTS_V7_ENGINEERING_ROOT || ROOT);
const E = 'experiments/material-facts-v7';
const helper = resolve(ENGINE, E, 'experiment-lock.mjs');
const freezeSource = await readFile(resolve(ENGINE, E, 'freeze.mjs'), 'utf8');
const freezeStart = freezeSource.indexOf('export async function createFreeze(');
const freezeEnd = freezeSource.indexOf('\nif (await isMainModule', freezeStart);
assert(freezeStart >= 0 && freezeEnd > freezeStart, 'Locate the production createFreeze body without rewriting its critical section');
const createFreeze = freezeSource.slice(freezeStart, freezeEnd);
const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const write = async (root, file, bytes) => { const path = resolve(root, file); await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); };

async function waitFor(path, child) {
  const deadline = Date.now() + 5000;
  while (!await exists(path)) {
    if (child && child.process.exitCode !== null) assert.fail(`Child exited before barrier: ${JSON.stringify(await child.closed)}`);
    assert(Date.now() < deadline, `Timed out waiting for ${path}`);
    await delay(10);
  }
}

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'anxin-v7-freeze-lock-'));
  const children = [];
  t.after(async () => {
    for (const child of children) if (child.process.exitCode === null && child.process.signalCode === null) child.process.kill('SIGKILL');
    await Promise.all(children.map(child => child.closed));
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(resolve(root, E), { recursive: true });
  await copyFile(helper, resolve(root, E, 'experiment-lock.mjs'));
  for (const [file, bytes] of Object.entries({ 'SOURCE_REVIEW.md': 'synthetic review\n', 'REVIEW.md': 'synthetic review\n', 'DEVELOPMENT.md': 'synthetic review\n',
    'technical-review.json': '{"status":"passed_independent_pre_run_technical_review","blocking_findings":[],"reviewed_sha256":{}}',
    'benchmark-review.independent.json': '{"status":"passed_independent_pre_run_benchmark_review","blocking_findings":[],"reviewed_sha256":{}}',
    'data/dev.inputs.jsonl': '{"id":"synthetic-dev"}\n', 'data/holdout.inputs.jsonl': '{"id":"synthetic-holdout"}\n',
    'review-evidence/receipt.json': '{"synthetic":true}\n', 'fixture-required.txt': 'synthetic required bytes\n',
    'results/dev-prior-failure/protocol.json': '{"synthetic":true}\n', 'results/dev-prior-failure/results.jsonl': '{"raw_output":"original failed output"}\n',
    'results/dev-prior-failure/outcome.json': '{"completed":false}\n' })) await write(root, `${E}/${file}`, bytes);
  // Keep createFreeze's actual absence check, enumeration, hashing and exclusive
  // publication unchanged. These explicit synthetic stubs replace unrelated
  // dataset/review/model-identity/legacy gates, never a model or real acceptance.
  await write(root, `${E}/fixture-freeze.mjs`, `
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { withExperimentLock } from './experiment-lock.mjs';
const ROOT = ${JSON.stringify(root)}, EXPERIMENT = ${JSON.stringify(E)}, REQUIRED_FILES = [EXPERIMENT + '/fixture-required.txt'];
const sha = value => createHash('sha256').update(value).digest('hex');
const safePath = (root, path) => resolve(root, path);
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const inputs = [{id:'synthetic-case'}];
const validateData = async () => ({sets:{dev:{inputs},holdout:{inputs}},summary:{synthetic_fixture:true}});
const verifyLegacy = () => ({status:'SYNTHETIC_STUB'});
const loadPolicy = async () => ({deepseek:{egress:'direct',reserved_upper_usd:2}});
const validateDevelopment = async () => ({synthetic_fixture:true});
const messageBytes = async () => JSON.stringify({messages:[]})+'\\n';
const deepseekReservation = () => 0, priorDeepseekReservation = async () => 0;
const validateQwenIdentity = async () => ({synthetic_fixture:true});
const checkFileHashes = async () => {};
async function filesUnder(root, relative) {
  const files = [];
  async function walk(path) { for (const entry of await readdir(resolve(root,path),{withFileTypes:true})) {
    if(entry.isDirectory()) await walk(path+'/'+entry.name); else files.push(path+'/'+entry.name);
  }}
  await walk(relative);
  if (relative === EXPERIMENT+'/results') {
    try {
      await lstat(resolve(root,'pause-freeze'));
      await writeFile(resolve(root,'freeze-enumerated'),'ready');
      const deadline=Date.now()+5000;
      while (true) { try { await lstat(resolve(root,'release-freeze')); break; } catch(error) { if(error.code!=='ENOENT') throw error; }
        if(Date.now()>deadline) throw new Error('Fixture freeze barrier timeout'); await delay(10);
      }
    } catch(error) { if(error.code!=='ENOENT') throw error; }
  }
  return files;
}
${createFreeze}
`);
  await write(root, 'child.mjs', `
import { mkdir, writeFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { withExperimentLock } from './${E}/experiment-lock.mjs';
import { createFreeze } from './${E}/fixture-freeze.mjs';
const root=${JSON.stringify(root)}, action=process.argv[2], out=resolve(root,'${E}/results/dev-new');
try {
  if(action==='freeze') await createFreeze(root);
  else await withExperimentLock(root,'diagnostic',async()=>{
    try { await lstat(resolve(root,'${E}/freeze.json')); throw new Error('Diagnostic attempts are closed after freezing'); }
    catch(error) { if(error.code!=='ENOENT') throw error; }
    if(action==='hold'||action==='throw') {
      await writeFile(resolve(root,'diagnostic-entered'),'ready');
      while(true) { try { await lstat(resolve(root,'release-diagnostic')); break; } catch(error) { if(error.code!=='ENOENT') throw error; } await delay(10); }
    }
    if(action==='throw') throw new Error('synthetic original callback failure');
    await mkdir(out); await writeFile(resolve(out,'protocol.json'),'synthetic protocol');
    await writeFile(resolve(out,'results.jsonl'),'original raw preserved\\n');
    await writeFile(resolve(out,'outcome.json'),'{"completed":true}\\n');
  });
  console.log(JSON.stringify({status:'PASS'}));
} catch(error) { console.error(JSON.stringify({status:'FAIL',code:error.code,message:error.message})); process.exitCode=1; }
`);
  const child = action => {
    const process = spawn(globalThis.process.execPath, [resolve(root, 'child.mjs'), action], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    process.stdout.on('data', bytes => { stdout += bytes; }); process.stderr.on('data', bytes => { stderr += bytes; });
    const closed = new Promise((resolveClose, reject) => { process.once('error', reject); process.once('close', (code, signal) => resolveClose({ code, signal, stdout, stderr })); });
    const record = { process, closed }; children.push(record); return record;
  };
  return { root, child, lock: resolve(root, E, '.experiment.lock') };
}

test('native diagnostic owner prevents freeze until terminal artifacts exist; original failure bytes remain', async t => {
  const f = await fixture(t), prior = resolve(f.root, E, 'results/dev-prior-failure/results.jsonl');
  const bytes = await readFile(prior), diagnostic = f.child('hold');
  await waitFor(resolve(f.root, 'diagnostic-entered'), diagnostic);
  const blocked = await f.child('freeze').closed;
  assert.equal(blocked.code, 1); assert.match(blocked.stderr, /EEXIST/);
  assert.equal(await exists(resolve(f.root, E, 'freeze.json')), false);
  await writeFile(resolve(f.root, 'release-diagnostic'), 'release');
  assert.equal((await diagnostic.closed).code, 0);
  assert.equal(await exists(f.lock), false);
  const frozen = await f.child('freeze').closed; assert.equal(frozen.code, 0, frozen.stderr);
  const receipt = JSON.parse(await readFile(resolve(f.root, E, 'freeze.json')));
  for (const name of ['protocol.json', 'results.jsonl', 'outcome.json']) assert(Object.hasOwn(receipt.files, `${E}/results/dev-new/${name}`));
  assert.deepEqual(await readFile(prior), bytes);
  assert(Object.keys(receipt.files).every(path => !path.includes('.experiment.lock')));
});

test('native freeze enumeration through publication excludes a concurrent diagnostic allocation', async t => {
  const f = await fixture(t); await writeFile(resolve(f.root, 'pause-freeze'), 'pause');
  const freezer = f.child('freeze'); await waitFor(resolve(f.root, 'freeze-enumerated'), freezer);
  const diagnostic = await f.child('allocate').closed;
  await writeFile(resolve(f.root, 'release-freeze'), 'release');
  const frozen = await freezer.closed;
  assert.equal(diagnostic.code, 1, 'A diagnostic cannot appear after freeze enumerates result files');
  assert.match(diagnostic.stderr, /EEXIST/); assert.equal(frozen.code, 0, frozen.stderr);
  assert.equal(await exists(resolve(f.root, E, 'results/dev-new')), false);
  const receipt = JSON.parse(await readFile(resolve(f.root, E, 'freeze.json')));
  const names = (await readdir(resolve(f.root, E, 'results/dev-prior-failure'))).sort();
  assert.deepEqual(Object.keys(receipt.files).filter(path => path.startsWith(`${E}/results/`)).sort(), names.map(name => `${E}/results/dev-prior-failure/${name}`));
  const late = await f.child('allocate').closed;
  assert.equal(late.code, 1); assert.match(late.stderr, /closed after freezing/);
  assert.equal(await exists(f.lock), false);
});

test('native concurrent diagnostic contenders fail closed and only the owner releases the lock', async t => {
  const f = await fixture(t), owner = f.child('hold'); await waitFor(resolve(f.root, 'diagnostic-entered'), owner);
  const bytes = await readFile(resolve(f.lock, 'owner.json'));
  const contenders = await Promise.all(Array.from({ length: 4 }, () => f.child('allocate').closed));
  for (const result of contenders) { assert.equal(result.code, 1); assert.match(result.stderr, /EEXIST/); }
  assert.deepEqual(await readFile(resolve(f.lock, 'owner.json')), bytes);
  await writeFile(resolve(f.root, 'release-diagnostic'), 'release'); assert.equal((await owner.closed).code, 0);
  assert.equal(await exists(f.lock), false);
});

test('callback failure preserves its error and releases the owned lock', async t => {
  const f = await fixture(t), owner = f.child('throw'); await waitFor(resolve(f.root, 'diagnostic-entered'), owner);
  await writeFile(resolve(f.root, 'release-diagnostic'), 'release');
  const failed = await owner.closed; assert.equal(failed.code, 1); assert.match(failed.stderr, /synthetic original callback failure/);
  assert.equal(await exists(f.lock), false); assert.equal((await f.child('allocate').closed).code, 0);
});

test('killed owner leaves its lock and evidence for explicit reconciliation instead of automatic stale removal', async t => {
  const f = await fixture(t), owner = f.child('hold'); await waitFor(resolve(f.root, 'diagnostic-entered'), owner);
  const bytes = await readFile(resolve(f.lock, 'owner.json')); owner.process.kill('SIGKILL');
  assert.equal((await owner.closed).signal, 'SIGKILL');
  const blocked = await f.child('allocate').closed; assert.equal(blocked.code, 1); assert.match(blocked.stderr, /EEXIST/);
  assert.deepEqual(await readFile(resolve(f.lock, 'owner.json')), bytes);
  // Explicit fixture-only recovery, after this test has observed owner close.
  await rm(f.lock, { recursive: true }); assert.equal((await f.child('allocate').closed).code, 0);
});

test('preexisting unrecognized and symlink locks are never automatically removed', async t => {
  const f = await fixture(t); await mkdir(f.lock); await writeFile(resolve(f.lock, 'prior-failure.txt'), 'unreconciled\n');
  assert.equal((await f.child('allocate').closed).code, 1);
  assert.equal(await readFile(resolve(f.lock, 'prior-failure.txt'), 'utf8'), 'unreconciled\n');
  await rm(f.lock, { recursive: true });
  const external = resolve(f.root, 'external-lock'); await mkdir(external); await writeFile(resolve(external, 'sentinel'), 'other owner');
  await symlink(external, f.lock, 'dir'); assert.equal((await f.child('allocate').closed).code, 1);
  assert.equal((await lstat(f.lock)).isSymbolicLink(), true); assert.equal(await readFile(resolve(external, 'sentinel'), 'utf8'), 'other owner');
});

test('changed owner token and unexpected lock files prevent cleanup without swallowing the callback failure', async t => {
  const f = await fixture(t), { withExperimentLock } = await import(pathToFileURL(helper));
  await assert.rejects(withExperimentLock(f.root, 'diagnostic', async () => {
    await writeFile(resolve(f.lock, 'owner.json'), 'replacement owner\n'); throw new Error('original callback failure');
  }), error => error instanceof AggregateError && error.errors.some(item => item.message === 'original callback failure')
    && error.errors.some(item => /ownership changed/.test(item.message)));
  assert.equal(await readFile(resolve(f.lock, 'owner.json'), 'utf8'), 'replacement owner\n');
  await rm(f.lock, { recursive: true });
  await assert.rejects(withExperimentLock(f.root, 'diagnostic', async () => { await writeFile(resolve(f.lock, 'unexpected'), 'retain'); }), /unexpected files/);
  assert.equal(await exists(resolve(f.lock, 'owner.json')), true); assert.equal(await readFile(resolve(f.lock, 'unexpected'), 'utf8'), 'retain');
});

test('freeze preserves an existing freeze byte for byte and releases its own lock', async t => {
  const f = await fixture(t), path = resolve(f.root, E, 'freeze.json'), bytes = Buffer.from('{"prior_frozen":true}\n');
  await writeFile(path, bytes); const result = await f.child('freeze').closed;
  assert.equal(result.code, 1); assert.match(result.stderr, /already exists/);
  assert.deepEqual(await readFile(path), bytes); assert.equal(await exists(f.lock), false);
});

test('current run hashes bind the shared helper while its live directory stays outside results', () => {
  assert.match(freezeSource, /RUN_HASH_FILES[\s\S]*?`\$\{EXPERIMENT\}\/experiment-lock\.mjs`/);
});
