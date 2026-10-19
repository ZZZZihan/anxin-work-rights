import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.MATERIAL_FACT_TEST_ROOT ?? fileURLToPath(new URL('../', import.meta.url)));
const RUN_FILE = resolve(process.env.MATERIAL_FACT_RUN_FILE ?? resolve(ROOT, 'experiments/material-facts-v7/run.mjs'));
const VERIFY_FILE = resolve(process.env.MATERIAL_FACT_VERIFY_FILE ?? resolve(ROOT, 'experiments/material-facts-v7/verify.mjs'));
const PUBLICATION_FILE = resolve(process.env.MATERIAL_FACT_PUBLICATION_FILE ?? resolve(ROOT, 'experiments/material-facts-v7/immutable-artifact-publication.mjs'));
const E = 'experiments/material-facts-v7';
const execute = promisify(execFile);
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const originalRun = await readFile(RUN_FILE);
const originalVerify = await readFile(VERIFY_FILE, 'utf8');
const originalPublication = await readFile(PUBLICATION_FILE);
const sliceBetween = (text, start, end) => {
  const from = text.indexOf(start), to = text.indexOf(end, from);
  assert(from >= 0 && to > from, `Missing exact source boundary: ${start}`);
  return text.slice(from, to).trimEnd();
};
const outcomeBody = sliceBetween(originalVerify, 'function checkOutcome(', '\nfunction checkEvents(');
const eventBodies = sliceBetween(originalVerify, 'function checkEvents(', '\nasync function checkDeepseek(');
const verificationBody = sliceBetween(originalVerify, 'export async function verifyExperiment(', '\nif (await isMainModule(');
const checkOutcome = new Function('assert', 'prefix', 'same', `${outcomeBody}\nreturn checkOutcome;`)(
  assert, (ids, expected) => ids.every((id, index) => id === expected[index]),
  (a, b, message) => assert.deepEqual(a, b, message));
const checkEvents = new Function('assert', 'same', `${eventBodies}\nreturn checkEvents;`)(
  assert, (a, b, message) => assert.deepEqual(a, b, message));

const policy = { deepseek: { model: 'deepseek-v4-pro', thinking: 'disabled', egress: 'direct', reserved_upper_usd: 2,
  input_usd_per_million: 1.32, output_usd_per_million: 3.96 } };
const memoryPolicy = { allocator_guideline_gib: 24, wired_gib: 20, cache_mib: 512, prefill_step_size: 128,
  kv_bits: 4, kv_group_size: 64, quantized_kv_start: 0, critical: 'immediate_stop', warning: '10_seconds',
  swap_growth_gib: 4, case_timeout_seconds: 600 };
const report = { planned_documents: 12, expected_facts: 0, completed: 0, protocol_valid: 0 };
const write = async (root, path, bytes) => {
  const target = resolve(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes);
};
const exists = async path => { try { await readFile(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };

// Only the real runner and outcome/manifest-verifier bodies are under test.
// Dataset/hash preflight, prompt construction and scoring are explicit synthetic
// stubs in an owned temporary tree. No real model worker, model, key or network
// is used, and no historical CLI is started.
async function fixture(t, scenario) {
  const parent = process.env.MATERIAL_FACT_QWEN_PRESERVE_ROOT;
  if (parent) await mkdir(parent, { recursive: true });
  const root = await mkdtemp(resolve(parent ?? tmpdir(), `qwen-prespawn-${scenario}-`));
  if (!parent) t.after(() => rm(root, { recursive: true, force: true }));
  await write(root, 'package.json', '{"type":"module"}\n');
  await write(root, `${E}/run.mjs`, originalRun);
  // Copy the real publication implementation even for an older verifier body
  // that does not call it, so both source versions use this same fixture.
  await write(root, `${E}/immutable-artifact-publication.mjs`, originalPublication);
  const inputs = Array.from({ length: 12 }, (_, n) => ({ id: `synthetic-${n + 1}`, source: { text: `Synthetic material ${n + 1}` } }));
  const inputBytes = inputs.map(row => JSON.stringify(row)).join('\n') + '\n';
  const messages = inputs.map(input => ({ id: input.id, messages: [{ role: 'user', content: input.source.text }] }));
  const messageBytes = messages.map(row => JSON.stringify(row)).join('\n') + '\n';
  await write(root, 'synthetic.inputs.jsonl', inputBytes);
  await write(root, 'lib/material-facts-v3.ts', 'export function extractRuleCandidates(){throw new Error("No rules in Qwen probe");}\n');
  await write(root, 'lib/material-fact-extraction-v4.ts', 'export function buildExtractionMessagesV4(source){return [{role:"user",content:source.text}];}\n');
  await write(root, 'scripts/fact-runtime-v2.py', '# Synthetic placeholder; this file must never execute.\n');
  await write(root, 'synthetic-model/config.json', '{}\n');
  await write(root, 'synthetic-integrity/source-manifest.json', '{}\n');
  await write(root, 'synthetic-integrity/weights-verification.json', '{}\n');
  const freeze = { frozen_at: '2000-01-01T00:00:00Z', input_sha256: sha(inputBytes), messages_sha256: sha(messageBytes),
    case_ids: inputs.map(row => row.id), policy, deepseek_egress: 'direct', files: { [`${E}/run.mjs`]: sha(originalRun) } };
  await write(root, `${E}/freeze.json`, json(freeze));
  await write(root, `${E}/freeze.mjs`, `export const EXPERIMENT=${JSON.stringify(E)};
export const RUN_HASH_FILES=[${JSON.stringify(`${E}/run.mjs`)}];
export const QWEN_MEMORY=${JSON.stringify(memoryPolicy)};
export async function loadPolicy(){return ${JSON.stringify(policy)};}
export function deepseekReservation(){throw new Error('No DeepSeek');}
export function priorDeepseekReservation(){throw new Error('No DeepSeek');}
`);
  await write(root, `${E}/verify.mjs`, `import {readFile} from 'node:fs/promises';
export async function verifyPreflight(root){return {freeze:JSON.parse(await readFile(root+'/${E}/freeze.json','utf8')),sets:{holdout:{inputs:JSON.parse(await readFile(root+'/synthetic.inputs.array.json','utf8')),labels:[],facts:0}},summary:{synthetic:true}};}
`);
  await write(root, 'synthetic.inputs.array.json', json(inputs));
  await write(root, `${E}/experiment-lock.mjs`, 'export async function withExperimentLock(_root,_operation,callback){return callback();}\n');
  const python = resolve(root, 'synthetic-python');
  await writeFile(python, `#!${process.execPath}\nimport {appendFileSync,writeFileSync} from 'node:fs';
appendFileSync(process.env.PROBE_CALLS,JSON.stringify({type:'python',args:process.argv.slice(2)})+'\\n');
if(process.argv[2]==='-c')console.log('anxin-v7-python-ready');else{writeFileSync(process.env.PROBE_WORKER,'unexpected worker launch');process.exitCode=91;}
`, { mode: 0o700 });
  await chmod(python, 0o700);
  const sysctl = resolve(root, 'bin/sysctl');
  await write(root, 'bin/sysctl', `#!${process.execPath}\nimport {appendFileSync} from 'node:fs';
const key=process.argv[3],scenario=process.env.PROBE_SCENARIO;
appendFileSync(process.env.PROBE_CALLS,JSON.stringify({type:'sysctl',key})+'\\n');
if((scenario==='pressure-probe-fails'&&key==='kern.memorystatus_vm_pressure_level')||(scenario==='swap-probe-fails'&&key==='vm.swapusage'))process.exitCode=7;
else if(key==='kern.memorystatus_vm_pressure_level')console.log(scenario==='invalid-pressure'?'not-a-level':scenario==='critical'?'4':'2');
else console.log('total = 1024M used = 0M free = 1024M');
`);
  await chmod(sysctl, 0o700);
  await write(root, `${E}/assess.mjs`, `export function assess(){return ${JSON.stringify(report)};}\n`);
  await write(root, `${E}/results/holdout-qwen-1/report.json`, json(report));
  // The runner must allocate its own one-time output directory.
  await rm(resolve(root, E, 'results/holdout-qwen-1'), { recursive: true });
  await write(root, `${E}/comparison.json`, json({ synthetic: true }));
  const bodyVerifier = `import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {verifyPreflight} from './verify.mjs';
import {publishImmutableFile} from './immutable-artifact-publication.mjs';
import {withExperimentLock} from './experiment-lock.mjs';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const EXPERIMENT=${JSON.stringify(E)}, BACKENDS=['qwen'], COUNTS={holdout:12}, GIB=1024**3;
const QWEN_MEMORY=${JSON.stringify(memoryPolicy)}, RUN_HASH_FILES=[${JSON.stringify(`${E}/run.mjs`)}];
const sha=value=>createHash('sha256').update(value).digest('hex');
const same=(a,b,message)=>assert.deepEqual(a,b,message), prefix=(ids,expected)=>ids.every((id,n)=>id===expected[n]);
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const jsonl=async path=>(await readFile(path,'utf8')).trim().split('\\n').filter(Boolean).map(line=>JSON.parse(line));
const optionalJsonl=async path=>{try{return await jsonl(path);}catch(error){if(error.code==='ENOENT')return [];throw error;}};
const messageBytes=async inputs=>inputs.map(input=>JSON.stringify({id:input.id,messages:[{role:'user',content:input.source.text}]})).join('\\n')+'\\n';
async function filesUnder(root,path){let result=[];for(const entry of await readdir(resolve(root,path),{withFileTypes:true})){const next=path+'/'+entry.name;result.push(...(entry.isDirectory()?await filesUnder(root,next):[next]));}return result.sort();}
const buildSummary=async root=>json(resolve(root,EXPERIMENT,'comparison.json'));
const checkBudgetReceipts=async()=>({synthetic_no_deepseek:true});
${outcomeBody}
${eventBodies}
${verificationBody}
`;
  await write(root, `${E}/body-verifier.mjs`, bodyVerifier);
  return { root, inputs, python, scenario, calls: resolve(root, 'calls.jsonl'), worker: resolve(root, 'worker-started.marker'),
    out: resolve(root, E, 'results/holdout-qwen-1'), verifier: resolve(root, E, 'body-verifier.mjs') };
}

async function run(f) {
  const args = [resolve(f.root, E, 'run.mjs'), '--mode', 'holdout', '--backend', 'qwen', '--inputs', resolve(f.root, 'synthetic.inputs.jsonl'),
    '--out', f.out, '--python', f.python, '--model-path', resolve(f.root, 'synthetic-model'), '--integrity-dir', resolve(f.root, 'synthetic-integrity')];
  const env = { ...process.env, PATH: resolve(f.root, 'bin') + ':' + process.env.PATH, PROBE_SCENARIO: f.scenario, PROBE_CALLS: f.calls, PROBE_WORKER: f.worker };
  try { const result = await execute(process.execPath, args, { cwd: f.root, env, timeout: 5000, maxBuffer: 64 * 1024 }); return { code: 0, ...result }; }
  catch (error) { return { code: error.code, signal: error.signal, killed: error.killed, stdout: error.stdout, stderr: error.stderr }; }
}

for (const scenario of ['warning', 'critical', 'pressure-probe-fails', 'swap-probe-fails', 'invalid-pressure']) {
  test(`formal Qwen pre-spawn ${scenario} is preserved and verifiable without a worker`, async t => {
    const f = await fixture(t, scenario), result = await run(f);
    assert.equal(result.code, 1, JSON.stringify(result));
    const bytes = await readFile(resolve(f.out, 'outcome.json'));
    const outcome = JSON.parse(bytes);
    await writeFile(resolve(f.out, 'report.json'), json(report));
    const { verifyExperiment } = await import(pathToFileURL(f.verifier));
    let verification;
    try { verification = { ok: true, receipt: await verifyExperiment(f.root, { writeManifest: true }) }; }
    catch (error) { verification = { ok: false, error: error.message }; }
    const retry = await run(f);
    const calls = (await readFile(f.calls, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const observation = { scenario, source_run_sha256: sha(originalRun), source_verify_sha256: sha(originalVerify),
      source_publication_sha256: sha(originalPublication),
      source_check_outcome_sha256: sha(outcomeBody), source_verify_experiment_sha256: sha(verificationBody),
      result, outcome, calls, worker_started: await exists(f.worker), results_bytes: (await readFile(resolve(f.out, 'results.jsonl'))).length,
      verification, manifest_published: await exists(resolve(f.root, E, 'result-manifest.json')), retry,
      outcome_unchanged_after_retry: bytes.equals(await readFile(resolve(f.out, 'outcome.json'))),
      fixture_scope: 'Actual runner and exact outcome/manifest verification bodies; synthetic dataset/hash preflight, prompt and scorer stubs; no actual legacy CLI, model or network.' };
    await writeFile(resolve(f.root, 'observation.json'), json(observation));
    console.log(JSON.stringify({ scenario, root: f.root, ...observation }));
    assert.equal(observation.worker_started, false);
    assert.equal(calls.filter(call => call.type === 'python').length, 2, 'One no-model interpreter preflight per original/retry invocation');
    assert(calls.filter(call => call.type === 'python').every(call => call.args[0] === '-c'));
    assert.equal(observation.results_bytes, 0);
    assert.equal(outcome.completed, false); assert.equal(outcome.attempts.length, 1);
    const attempt = outcome.attempts[0];
    assert.equal(attempt.stop_reason, 'initial_memory_state');
    assert.equal(attempt.worker_started, false, 'A pre-spawn stop must explicitly say no worker started');
    assert.equal(attempt.stdout_state, 'not_started');
    assert.equal(attempt.incomplete_stdout, false, 'No stdout stream exists, so there is no incomplete fragment');
    assert.equal(Object.hasOwn(attempt, 'code'), false, 'Do not invent a worker exit code');
    assert.equal(Object.hasOwn(attempt, 'signal'), false, 'Do not invent a worker exit signal');
    assert.equal(verification.ok, true, JSON.stringify(verification));
    assert.equal(verification.receipt.runs[0].returned, 0);
    assert.equal(verification.receipt.runs[0].completed, 0);
    assert.equal(observation.manifest_published, true);
    assert.match(retry.stderr, /EEXIST/); assert.equal(retry.code, 1);
    assert.equal(observation.outcome_unchanged_after_retry, true);
    assert.equal((await verifyExperiment(f.root)).status, 'PASS');
  });
}

test('legacy successful worker receipts remain valid without new pre-spawn fields', () => {
  const ids = ['synthetic-a', 'synthetic-b'];
  const rows = ids.map(id => ({ id, finish_reason: 'stop' }));
  const outcome = { completed: true, isolation: 'fresh_process_per_document', attempts: ids.map(id => ({ ids: [id],
    completed: true, code: 0, signal: null, stop_reason: null, incomplete_stdout: false })) };
  assert.doesNotThrow(() => checkOutcome('qwen', outcome, rows, ids));
});

test('a genuinely incomplete worker stdout receipt is still rejected', () => {
  const outcome = { completed: false, attempts: [{ ids: ['synthetic-a'], completed: false, code: 1,
    stop_reason: 'incomplete_stdout', incomplete_stdout: true }] };
  assert.throws(() => checkOutcome('qwen', outcome, [], ['synthetic-a']), /incomplete or missing stdout termination evidence/);
});

const preSpawnOutcome = () => ({ completed: false, attempts: [{ ids: ['synthetic-a'], completed: false,
  stop_reason: 'initial_memory_state', worker_started: false, stdout_state: 'not_started', incomplete_stdout: false }] });

for (const field of ['worker_started', 'stdout_state', 'stop_reason']) {
  test(`pre-spawn receipt rejects missing ${field} rather than accepting a contradictory state`, () => {
    const outcome = preSpawnOutcome(); delete outcome.attempts[0][field];
    assert.throws(() => checkOutcome('qwen', outcome, [], ['synthetic-a']), /Pre-spawn stop/);
  });
}

for (const [field, value] of [['code', 0], ['signal', null]]) {
  test(`pre-spawn receipt cannot invent a worker ${field}`, () => {
    const outcome = preSpawnOutcome(); outcome.attempts[0][field] = value;
    assert.throws(() => checkOutcome('qwen', outcome, [], ['synthetic-a']), /unstarted worker cannot have an exit/);
  });
}

test('pre-spawn receipt cannot have a result for its unstarted material', () => {
  assert.throws(() => checkOutcome('qwen', preSpawnOutcome(), [{ id: 'synthetic-a', finish_reason: 'stop' }],
    ['synthetic-a']), /unstarted worker cannot have result rows/);
});

test('pre-spawn receipt cannot have load, generation, policy or result events for its unstarted material', () => {
  for (const type of ['load', 'generating', 'wired_policy', 'result']) {
    assert.throws(() => checkEvents('qwen', [{ id: 'synthetic-a', type }], [], preSpawnOutcome(),
      ['synthetic-a']), /unstarted worker cannot have worker events/);
  }
});
