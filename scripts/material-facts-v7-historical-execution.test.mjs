import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const OWN = fileURLToPath(new URL('../', import.meta.url));
const SOURCE = resolve(process.env.MATERIAL_FACT_TEST_ROOT ?? OWN);
const E = 'experiments/material-facts-v7';
const policyPath = resolve(OWN, E, 'historical-execution-policy-v1.mjs');
const { runHistoricalCheckSync } = await import(pathToFileURL(resolve(OWN, E, 'historical-execution-v1.mjs')));
const { STATE_ENV, POLICY_ID, POLICY_SHA256, historicalTarget } = await import(pathToFileURL(policyPath));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// Native short timers prove execution behavior without making a model request.
// They are a controlled deadline fixture, not a reproduction of the reviewer's
// machine: the actual unmodified archived v5 chain passed locally in 41.117s.
async function fixture(action) {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), 'anxin history policy spaces-')));
  const base = resolve(root, E);
  try {
    await mkdir(base, { recursive: true });
    for (const name of ['historical-execution-v1.mjs', 'historical-execution-policy-v1.mjs'])
      await cp(resolve(OWN, E, name), resolve(base, name));
    const write = (name, value) => writeFile(resolve(base, name), value);
    await write('verify-correction-v4.mjs', `setTimeout(() => console.log(JSON.stringify({status:'PASS',literal:'unchanged'})),120);`);
    await write('corrective-assessment-v5.mjs', `import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const child=fileURLToPath(new URL('./verify-correction-v4.mjs',import.meta.url));
console.log(execFileSync(process.execPath,[child],{encoding:'utf8',timeout:10}));`);
    await action({ root, base, write });
  } finally { await rm(root, { recursive: true, force: true }); }
}
const run = (base, name = 'corrective-assessment-v5.mjs', args = ['--check'], options = {}) =>
  runHistoricalCheckSync(resolve(base, name), args, { cwd: base, encoding: 'utf8', maxBuffer: 1024 ** 2, timeout: 30, ...options });
const eventsIn = async file => (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));

test('only exact read-only v7 commands are eligible', () => {
  for (const name of ['verify.mjs', 'verify-frozen.mjs', ...Array.from({ length: 7 }, (_, i) => `verify-correction-v${i + 1}.mjs`)])
    assert(historicalTarget(resolve(SOURCE, E, name), []));
  for (const name of ['summarize.mjs', 'corrective-assessment.mjs', ...Array.from({ length: 7 }, (_, i) => `corrective-assessment-v${i + 2}.mjs`)])
    assert(historicalTarget(resolve(SOURCE, E, name), ['--check']));
  for (const [path, args] of [['run.mjs', []], ['freeze.mjs', []], ['corrective-assessment-v5.mjs', ['--write']],
    ['verify-correction-v5.mjs', ['--check']], ['corrective-assessment-v5.mjs', ['--check', '--write']], ['corrective-assessment-v9.mjs', ['--check']]])
    assert.equal(historicalTarget(resolve(SOURCE, E, path), args), null);
  assert.equal(historicalTarget(resolve(SOURCE, 'other/verify-correction-v5.mjs'), []), null);
});

test('native archived-shaped control times out; explicit API lets the unchanged child finish', async () => fixture(async ({ base }) => {
  const script = resolve(base, 'corrective-assessment-v5.mjs');
  let legacy;
  try { execFileSync(process.execPath, [script, '--check'], { encoding: 'utf8', timeout: 3000, stdio: 'pipe' }); }
  catch (error) { legacy = error; }
  assert.equal(legacy?.status, 1); assert.match(String(legacy.stderr), /ETIMEDOUT/u);
  const before = sha(await readFile(script));
  assert.deepEqual(JSON.parse(run(base)), { status: 'PASS', literal: 'unchanged' });
  assert.equal(sha(await readFile(script)), before);
  console.log(JSON.stringify({ evidence: 'controlled_native_timer_red_to_green', original_child_timeout_ms: 10,
    original_failure: 'ETIMEDOUT', policy_result: 'PASS', original_chain_timeout_reproduced: false }));
}));

test('loading the preload with no state leaves the old timeout untouched', async () => fixture(async ({ base }) => {
  assert.throws(() => execFileSync(process.execPath, ['--import', pathToFileURL(policyPath).href,
    resolve(base, 'corrective-assessment-v5.mjs'), '--check'], { encoding: 'utf8', stdio: 'pipe', timeout: 3000 }),
  error => error.status === 1 && /ETIMEDOUT/u.test(String(error.stderr)));
}));

test('the public CLI propagates an absolute preload fileURL from a path containing spaces', async () => fixture(async ({ base }) => {
  const result = execFileSync(process.execPath, [resolve(base, 'historical-execution-v1.mjs'),
    resolve(base, 'corrective-assessment-v5.mjs'), '--check'], { encoding: 'utf8', stdio: 'pipe', timeout: 5000 });
  assert.deepEqual(JSON.parse(result), { status: 'PASS', literal: 'unchanged' });
}));

test('API refuses writes, runner commands and extra arguments before executing them', async () => fixture(async ({ base }) => {
  for (const [name, args] of [['corrective-assessment-v5.mjs', ['--write']], ['run.mjs', []], ['verify-correction-v4.mjs', ['--check']]])
    assert.throws(() => run(base, name, args), /exact read-only/u);
}));

test('a non-historical child keeps its original native timeout under the preload', async () => fixture(async ({ base, write }) => {
  await write('other.mjs', 'setTimeout(()=>console.log("unexpected"),120);');
  await write('corrective-assessment-v5.mjs', `import {execFileSync} from 'node:child_process';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
try{execFileSync(process.execPath,[fileURLToPath(new URL('./other.mjs',import.meta.url))],{timeout:10});throw Error('unexpected success');}
catch(error){assert.equal(error.code,'ETIMEDOUT');console.log(JSON.stringify({status:'PASS',native_error:error.code}));}`);
  assert.equal(JSON.parse(run(base)).native_error, 'ETIMEDOUT');
}));

test('a known filename with --write gets no deadline extension from the preload', async () => fixture(async ({ base, write }) => {
  await write('corrective-assessment-v5.mjs', `import {execFileSync} from 'node:child_process';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
try{execFileSync(process.execPath,[fileURLToPath(new URL('./verify-correction-v4.mjs',import.meta.url)),'--write'],{timeout:10});throw Error('unexpected success');}
catch(error){assert.equal(error.code,'ETIMEDOUT');console.log(JSON.stringify({status:'PASS',native_error:error.code}));}`);
  assert.equal(JSON.parse(run(base)).native_error, 'ETIMEDOUT');
}));

test('original child exit status, stdout and stderr propagate', async () => fixture(async ({ base, write }) => {
  await write('verify-correction-v4.mjs', `process.stdout.write('original stdout');process.stderr.write('original failure');process.exit(7);`);
  assert.throws(() => run(base, 'verify-correction-v4.mjs', [], { stdio: 'pipe' }), error =>
    error.status === 7 && String(error.stdout) === 'original stdout' && String(error.stderr) === 'original failure');
}));

test('maxBuffer and supplied environment/cwd are preserved; process.env is untouched', async () => fixture(async ({ base, write }) => {
  const before = { ...process.env };
  await write('verify-correction-v4.mjs', `console.log(JSON.stringify({cwd:process.cwd(),custom:process.env.TEST_HISTORY_CUSTOM}));`);
  assert.deepEqual(JSON.parse(run(base, 'verify-correction-v4.mjs', [], { env: { ...process.env, TEST_HISTORY_CUSTOM: 'literal' } })), { cwd: base, custom: 'literal' });
  await write('verify-correction-v4.mjs', `process.stdout.write('x'.repeat(100000));`);
  assert.throws(() => run(base, 'verify-correction-v4.mjs', [], { maxBuffer: 128, stdio: 'pipe' }), error => error.code === 'ENOBUFS');
  assert.deepEqual({ ...process.env }, before);
}));

test('nested children and sequential siblings share an absolute deadline, with parent cleanup time', async () => fixture(async ({ base, write }) => {
  await write('verify-correction-v3.mjs', `setTimeout(()=>console.log(JSON.stringify({status:'PASS'})),30);`);
  await write('verify-correction-v4.mjs', `import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
console.log(execFileSync(process.execPath,[fileURLToPath(new URL('./verify-correction-v3.mjs',import.meta.url))],{timeout:10,encoding:'utf8'}));`);
  await write('corrective-assessment-v5.mjs', `import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {readFileSync} from 'node:fs';
const s=JSON.parse(process.env.${STATE_ENV});const script=fileURLToPath(new URL('./verify-correction-v4.mjs',import.meta.url));
for(let i=0;i<2;i++)execFileSync(process.execPath,[script],{timeout:10,encoding:'utf8'});
console.log(JSON.stringify({status:'PASS',state:s,events:readFileSync(s.receipt_path,'utf8').trim().split('\\n').map(JSON.parse)}));`);
  const result = JSON.parse(run(base)), edges = result.events.filter(event => event.event === 'child_budget');
  assert.deepEqual(edges.map(event => event.depth), [1, 2, 3, 2, 3]);
  for (const edge of edges) assert.equal(edge.parent_deadline_ms - edge.child_deadline_ms, 2000);
  const siblings = edges.filter(edge => edge.depth === 2);
  assert.equal(siblings[0].child_deadline_ms, siblings[1].child_deadline_ms);
  assert(siblings[1].effective_timeout_ms < siblings[0].effective_timeout_ms);
  assert.equal(result.state.root_deadline_ms - result.state.started_ms, 900000);
}));

test('two URLs of identical policy bytes reuse the true native function without double preparation', async () => fixture(async ({ base, write }) => {
  await write('corrective-assessment-v5.mjs', `import {runHistoricalCheckSync} from './historical-execution-v1.mjs';import {fileURLToPath} from 'node:url';import {readFileSync} from 'node:fs';
runHistoricalCheckSync(fileURLToPath(new URL('./verify-correction-v4.mjs',import.meta.url)),[],{timeout:10,encoding:'utf8'});
const s=JSON.parse(process.env.${STATE_ENV});console.log(JSON.stringify({status:'PASS',events:readFileSync(s.receipt_path,'utf8').trim().split('\\n').map(JSON.parse)}));`);
  const { events } = JSON.parse(run(base)), edges = events.filter(event => event.event === 'child_budget');
  assert.deepEqual(edges.map(event => event.depth), [1, 2]);
  const activations = events.filter(event => event.event === 'preload_active');
  assert.equal(new Set(activations.map(event => event.pid)).size, activations.length);
}));

test('a second URL with different policy bytes fails visibly', async () => fixture(async ({ base, write }) => {
  await write('historical-execution-policy-v1.mjs', (await readFile(policyPath, 'utf8')) + '\n// changed policy copy\n');
  await write('corrective-assessment-v5.mjs', `await import('./historical-execution-policy-v1.mjs');console.log('unexpected success');`);
  assert.throws(() => run(base, 'corrective-assessment-v5.mjs', ['--check'], { stdio: 'pipe' }),
    error => error.status === 1 && /Conflicting historical execution policy bytes/u.test(String(error.stderr)));
}));

test('a short shared overall budget stops a real child before its parent deadline', async () => fixture(async ({ base, root, write }) => {
  await write('verify-correction-v4.mjs', `setTimeout(()=>console.log('unexpected success'),5000);`);
  const receipt = resolve(root, 'bounded-events.jsonl'); await writeFile(receipt, '', { flag: 'wx' });
  const now = Date.now(), state = { policy: POLICY_ID, policy_sha256: POLICY_SHA256,
    started_ms: now, root_deadline_ms: now + 4500, deadline_ms: now + 4500, depth: 0, receipt_path: receipt };
  let error;
  try { execFileSync(process.execPath, ['--import', pathToFileURL(policyPath).href,
    resolve(base, 'corrective-assessment-v5.mjs'), '--check'], {
    cwd: base, encoding: 'utf8', stdio: 'pipe', timeout: 7000,
    env: { ...process.env, [STATE_ENV]: JSON.stringify(state) },
  }); } catch (failure) { error = failure; }
  assert.equal(error?.status, 1, 'The child must report failure; the outer harness must not time out');
  assert.match(String(error.stderr), /ETIMEDOUT/u);
  assert(Date.now() - now < 4500, 'Parent cleanup reserve was exhausted');
  const edges = (await eventsIn(receipt)).filter(event => event.event === 'child_budget');
  assert.equal(edges.length, 1); assert.equal(edges[0].child_deadline_ms, state.deadline_ms - 2000);
}));

test('current wrapper still rejects archived snapshot and manifest drift before callback', async () => {
  const { withCorrectionV5Code } = await import(pathToFileURL(resolve(OWN, E, 'verify-correction-v5.mjs')));
  const root = await mkdtemp(resolve(tmpdir(), 'anxin-history-archive-negative-'));
  const base = resolve(root, E);
  try {
    await mkdir(resolve(base, 'corrections-v5'), { recursive: true });
    await cp(resolve(SOURCE, E, 'correction-code-v5'), resolve(base, 'correction-code-v5'), { recursive: true });
    const manifestBytes = await readFile(resolve(SOURCE, E, 'corrections-v5/manifest.json'));
    await writeFile(resolve(base, 'corrections-v5/manifest.json'), manifestBytes);
    const snapshot = resolve(base, 'correction-code-v5/lib/material-fact-source-review.ts.snapshot');
    const bytes = await readFile(snapshot); await writeFile(snapshot, Buffer.concat([bytes, Buffer.from('\n// drift\n')]));
    let entered = false;
    await assert.rejects(withCorrectionV5Code(() => { entered = true; }, root), /Correction code changed/u);
    assert.equal(entered, false);
    await writeFile(snapshot, bytes);
    await writeFile(resolve(base, 'corrections-v5/manifest.json'), Buffer.concat([manifestBytes, Buffer.from('\n')]));
    await assert.rejects(withCorrectionV5Code(() => { entered = true; }, root));
    assert.equal(entered, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
