import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.V7_POLICY_ROOT ?? process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const E = 'experiments/material-facts-v7';
const policyPath = resolve(ROOT, E, 'historical-execution-policy-v1.mjs');
const adapterPath = resolve(ROOT, E, 'historical-execution-v1.mjs');
const { historicalTarget, prepareHistoricalOptions, readExecutionState, POLICY_ID, POLICY_SHA256,
  ROOT_BUDGET_MS, CLEANUP_RESERVE_MS, STATE_ENV } = await import(pathToFileURL(policyPath));
const { runHistoricalCheckSync } = await import(pathToFileURL(adapterPath));

test('historical policy accepts only exact read-only commands, without allocating a model attempt', () => {
  for (const [name, args] of [['run.mjs', ['--backend', 'rules']], ['freeze.mjs', []],
    ['corrective-assessment-v8.mjs', ['--write']], ['summarize.mjs', ['--write']],
    ['verify-correction-v7.mjs', ['--check']], ['not-v7/verify.mjs', []]]) {
    const path = resolve(ROOT, E, name);
    assert.equal(historicalTarget(path, args), null);
    assert.throws(() => runHistoricalCheckSync(path, args), /exact read-only/u);
  }
  assert.equal(historicalTarget(resolve(ROOT, E, 'verify-correction-v5.mjs'), []), `${E}/verify-correction-v5.mjs`);
});

test('one absolute historical budget preserves ordinary process options and shrinks at each nesting level', async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-independent-history-options-'));
  try {
    const started = Date.now(), receipt = resolve(temporary, 'events.jsonl');
    const state = { policy: POLICY_ID, policy_sha256: POLICY_SHA256, started_ms: started,
      root_deadline_ms: started + ROOT_BUDGET_MS, deadline_ms: started + ROOT_BUDGET_MS, depth: 0, receipt_path: receipt };
    const options = { cwd: temporary, encoding: 'utf8', maxBuffer: 123456, input: 'unchanged\n', env: { KEEP: 'present' }, timeout: 60000 };
    const original = structuredClone(options);
    const first = prepareHistoricalOptions(resolve(ROOT, E, 'verify-correction-v5.mjs'), [], options, state);
    const next = readExecutionState(first.env);
    const second = prepareHistoricalOptions(resolve(ROOT, E, 'verify-correction-v4.mjs'), [], first, next);
    const last = readExecutionState(second.env);
    assert.deepEqual(options, original);
    for (const key of ['cwd', 'encoding', 'maxBuffer', 'input']) assert.equal(first[key], original[key]);
    assert.equal(first.env.KEEP, 'present');
    assert.equal(next.root_deadline_ms, state.root_deadline_ms);
    assert.equal(next.deadline_ms, state.deadline_ms - CLEANUP_RESERVE_MS);
    assert.equal(last.deadline_ms, next.deadline_ms - CLEANUP_RESERVE_MS);
    assert.equal(next.depth, 1); assert.equal(last.depth, 2);
    assert(first.timeout > 60000 && second.timeout < first.timeout);
    const records = (await readFile(receipt, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(records.length, 2);
    assert(records.every(row => row.requested_timeout_ms && row.cleanup_reserve_ms === CLEANUP_RESERVE_MS));
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('expired or forged historical policy state fails before another child begins', async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-independent-history-expiry-'));
  try {
    const now = Date.now(), state = { policy: POLICY_ID, policy_sha256: POLICY_SHA256, started_ms: now - 100,
      root_deadline_ms: now + 10000, deadline_ms: now - 1, depth: 0, receipt_path: resolve(temporary, 'events.jsonl') };
    assert.throws(() => prepareHistoricalOptions(resolve(ROOT, E, 'verify.mjs'), [], {}, state), { code: 'ETIMEDOUT' });
    assert.throws(() => readExecutionState({ [STATE_ENV]: JSON.stringify({ ...state, policy_sha256: '0'.repeat(64) }) }), /Invalid historical/u);
    assert.throws(() => readExecutionState({ [STATE_ENV]: JSON.stringify({ ...state, root_deadline_ms: now + ROOT_BUDGET_MS * 2 }) }), /Invalid historical/u);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('native nested checks preserve validation failures and unrelated deadlines across two identical policy URLs', async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'anxin-independent-history-native-'));
  try {
    const directory = resolve(temporary, E);
    await mkdir(directory, { recursive: true });
    const copy = resolve(temporary, 'second-policy.mjs');
    await writeFile(copy, await readFile(policyPath));
    await writeFile(resolve(directory, 'verify.mjs'), 'await new Promise(done=>setTimeout(done,30));process.exit(7);\n');
    await writeFile(resolve(directory, 'corrective-assessment-v8.mjs'), `
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const original=await import(${JSON.stringify(pathToFileURL(policyPath).href)});
const copy=await import(${JSON.stringify(pathToFileURL(copy).href)});
assert.equal(original.nativeExecFileSync,copy.nativeExecFileSync,'Identical policies must share the unwrapped native primitive');
let failure;
try{execFileSync(process.execPath,[new URL('./verify.mjs',import.meta.url).pathname],{timeout:1,stdio:'pipe'});}catch(error){failure=error;}
assert.equal(failure?.status,7,'A failing archived validator must remain a failing validator, not timeout or PASS');
let unrelated;
try{execFileSync(process.execPath,['-e','setTimeout(()=>{},50)'],{timeout:1,stdio:'pipe'});}catch(error){unrelated=error;}
assert.equal(unrelated?.code,'ETIMEDOUT','Unrelated child timeout must not receive a historical budget');
console.log(JSON.stringify({status:'PASS',model_requests:0}));
`);
    const stdout = execFileSync(process.execPath, [adapterPath, resolve(directory, 'corrective-assessment-v8.mjs'), '--check'],
      { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.deepEqual(JSON.parse(stdout), { status: 'PASS', model_requests: 0 });
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
