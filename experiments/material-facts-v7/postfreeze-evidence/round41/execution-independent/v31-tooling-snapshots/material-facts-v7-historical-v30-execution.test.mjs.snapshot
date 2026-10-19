// Author synthetic contract checks. These exercise native Node subprocesses,
// not model calls or a replacement implementation of historical scoring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const E = 'experiments/material-facts-v7';
const url = name => pathToFileURL(resolve(ROOT, E, name)).href;
const { historicalV30Target, prepareHistoricalV30Options } = await import(url('historical-v30-execution.mjs'));
const { prepareHistoricalV28Options } = await import(url('historical-v28-execution.mjs'));
const { CLEANUP_RESERVE_MS, POLICY_ID, POLICY_SHA256, ROOT_BUDGET_MS, STATE_ENV, historicalTarget,
  prepareHistoricalOptions } = await import(url('historical-execution-policy-v1.mjs'));
const POLICY = 'cf6a04377e518064037cb3374591eb7747972f7259aa92ffa0f8440eefde7dea';
const ADAPTER = '0796452771e29dcf6ae5cfd653cb96a851a713f07de9f2b6e2754feb50586a8c';
const V28_BRIDGE = '8d25d053af5c4a9223713994e7aa3c885c31280f734c02c1544d878573361ce4';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const target = resolve(ROOT, E, 'corrective-assessment-v30.mjs');
const plainEnv = () => {
  const env = { ...process.env };
  delete env[STATE_ENV];
  delete env.NODE_OPTIONS;
  return env;
};

test('v30 execution bridge keeps all immutable v1 and v28 bridge byte bindings', async () => {
  assert.equal(POLICY_SHA256, POLICY);
  assert.equal(sha(await readFile(resolve(ROOT, E, 'historical-execution-v1.mjs'))), ADAPTER);
  assert.equal(sha(await readFile(resolve(ROOT, E, 'historical-v28-execution.mjs'))), V28_BRIDGE);
  assert.equal(historicalTarget(target, ['--check']), null);
});

test('only the exact v30 read-only CLI is accepted by the new bridge', () => {
  assert.equal(historicalV30Target(target, ['--check']), `${E}/corrective-assessment-v30.mjs`);
  for (const [path, args] of [[target, []], [target, ['--write']], [target, ['--check', '--write']],
    [target, ['--check=1']], [resolve(ROOT, E, 'run.mjs'), ['--check']],
    [resolve(ROOT, E, 'corrective-assessment-v8.mjs'), ['--check']],
    [resolve(ROOT, E, 'corrective-assessment-v28.mjs'), ['--check']],
    [resolve(ROOT, E, 'corrective-assessment-v31.mjs'), ['--check']],
    [resolve(ROOT, 'other/corrective-assessment-v30.mjs'), ['--check']]]) {
    assert.equal(historicalV30Target(path, args), null, `${path} ${args.join(' ')}`);
  }
});

test('v30 child and older child inherit one absolute deadline and retain caller options without mutation', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'anxin-v7-v30-budget-test-'));
  try {
    const receipt = resolve(temporary, 'events.jsonl'); await writeFile(receipt, '');
    const now = Date.now(), state = { policy: POLICY_ID, policy_sha256: POLICY_SHA256, started_ms: now,
      root_deadline_ms: now + ROOT_BUDGET_MS, deadline_ms: now + 120000, depth: 4, receipt_path: receipt };
    const env = { CUSTOM: 'preserved', NODE_OPTIONS: '--no-warnings' };
    const options = { env, timeout: 1, maxBuffer: 123456, encoding: 'buffer', windowsHide: true };
    const before = JSON.stringify({ state, options }), processBefore = process.env[STATE_ENV];
    const prepared = prepareHistoricalV30Options(target, ['--check'], options, state);
    const child = JSON.parse(prepared.env[STATE_ENV]);
    assert.equal(prepared.maxBuffer, options.maxBuffer);
    assert.equal(prepared.encoding, options.encoding);
    assert.equal(prepared.windowsHide, true);
    assert.notEqual(prepared.env, env);
    assert.equal(prepared.env.CUSTOM, 'preserved');
    assert(prepared.timeout > 100000 && prepared.timeout <= 120000 - CLEANUP_RESERVE_MS);
    assert.equal(child.root_deadline_ms, state.root_deadline_ms);
    assert.equal(child.started_ms, state.started_ms);
    assert.equal(child.deadline_ms, state.deadline_ms - CLEANUP_RESERVE_MS);
    assert.equal(child.depth, state.depth + 1);
    const older = prepareHistoricalV28Options(resolve(ROOT, E, 'corrective-assessment-v28.mjs'), ['--check'], prepared, child);
    const grandchild = JSON.parse(older.env[STATE_ENV]);
    assert.equal(grandchild.root_deadline_ms, state.root_deadline_ms);
    assert.equal(grandchild.deadline_ms, child.deadline_ms - CLEANUP_RESERVE_MS);
    assert.equal(grandchild.depth, child.depth + 1);
    const oldest = prepareHistoricalOptions(resolve(ROOT, E, 'corrective-assessment-v8.mjs'), ['--check'], older, grandchild);
    const third = JSON.parse(oldest.env[STATE_ENV]);
    assert.equal(third.root_deadline_ms, state.root_deadline_ms);
    assert.equal(third.deadline_ms, grandchild.deadline_ms - CLEANUP_RESERVE_MS);
    assert.equal(third.depth, grandchild.depth + 1);
    assert.equal(JSON.stringify({ state, options }), before);
    assert.equal(process.env[STATE_ENV], processBefore);
    const events = (await readFile(receipt, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(events.map(event => event.depth), [5, 6, 7]);
    assert.equal(events[0].requested_timeout_ms, 1);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('invalid and expired inherited states refuse before child allocation', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'anxin-v7-v30-expired-test-'));
  try {
    const receipt = resolve(temporary, 'events.jsonl'); await writeFile(receipt, '');
    const now = Date.now(), state = { policy: POLICY_ID, policy_sha256: POLICY_SHA256, started_ms: now - 1000,
      root_deadline_ms: now + 1000, deadline_ms: now + 500, depth: 2, receipt_path: receipt };
    assert.throws(() => prepareHistoricalV30Options(target, ['--check'], {}, state), { code: 'ETIMEDOUT' });
    assert.throws(() => prepareHistoricalV30Options(target, ['--check'], {}, { ...state, policy_sha256: '0'.repeat(64) }), /Invalid historical/u);
    assert.throws(() => prepareHistoricalV30Options(target, ['--check'], {}, undefined), /Invalid historical/u);
    assert.throws(() => prepareHistoricalV30Options(target, ['--write'], {}, state), /exact read-only/u);
    const events = (await readFile(receipt, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(events.length, 1);
    assert.equal(events[0].event, 'budget_exhausted');
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

async function fixture(action) {
  const root = await mkdtemp(join(tmpdir(), 'anxin v7 v30 native contract '));
  try {
    const base = resolve(root, E); await mkdir(base, { recursive: true });
    for (const name of ['historical-execution-policy-v1.mjs', 'historical-execution-v1.mjs', 'historical-v28-execution.mjs', 'historical-v30-execution.mjs'])
      await cp(resolve(ROOT, E, name), resolve(base, name));
    return await action(root, base);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('native two-URL policy preload keeps sibling and nested checks inside the same budget; unrelated exec stays bounded', { timeout: 15000 }, async () => {
  await fixture(async (root, base) => {
    await writeFile(resolve(base, 'corrective-assessment-v8.mjs'), `
import { readExecutionState } from './historical-execution-policy-v1.mjs';
await new Promise(resolve => setTimeout(resolve, 30));
console.log(JSON.stringify(readExecutionState()));
`);
    await writeFile(resolve(base, 'corrective-assessment-v28.mjs'), `
import { execFileSync } from 'node:child_process';
import { readExecutionState } from './historical-execution-policy-v1.mjs';
import { fileURLToPath } from 'node:url';
const state=readExecutionState();
const nested=JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL('./corrective-assessment-v8.mjs',import.meta.url)),'--check'],{encoding:'utf8',timeout:1}));
console.log(JSON.stringify({state,nested}));
`);
    await writeFile(resolve(base, 'corrective-assessment-v30.mjs'), `
import { execFileSync } from 'node:child_process';
import { runHistoricalV28CheckSync } from './historical-v28-execution.mjs';
import { readFileSync } from 'node:fs';
import { readExecutionState } from './historical-execution-policy-v1.mjs';
import { fileURLToPath } from 'node:url';
const state=readExecutionState();
const nested=JSON.parse(runHistoricalV28CheckSync(fileURLToPath(new URL('./corrective-assessment-v28.mjs',import.meta.url)),['--check'],{encoding:'utf8',timeout:1}));
let unrelated;
try { execFileSync(process.execPath,['-e','setTimeout(()=>{},1000)'],{timeout:1,stdio:'pipe'}); }
catch(error) { unrelated=error.code; }
const events=readFileSync(state.receipt_path,'utf8').trim().split('\\n').map(JSON.parse);
console.log(JSON.stringify({state,nested,unrelated,events,preloads:process.env.NODE_OPTIONS}));
`);
    // Load the original URL before the copied URL: both modules must use the
    // same true native function and the same root start time.
    const driver = resolve(root, 'driver.mjs');
    await writeFile(driver, `
import { existsSync } from 'node:fs';
import { rootBudgetStartedMs } from ${JSON.stringify(url('historical-execution-policy-v1.mjs'))};
import { runHistoricalV30CheckSync } from ${JSON.stringify(pathToFileURL(resolve(base, 'historical-v30-execution.mjs')).href)};
const started=rootBudgetStartedMs();
const run=()=>JSON.parse(runHistoricalV30CheckSync(${JSON.stringify(resolve(base, 'corrective-assessment-v30.mjs'))},['--check'],{encoding:'utf8',timeout:1,maxBuffer:65536,env:{...process.env,NODE_OPTIONS:${JSON.stringify(`--import=${url('historical-execution-policy-v1.mjs')}`)}}}));
const first=run(),second=run();
console.log(JSON.stringify({started,first,second,receipt_exists:[first,second].some(x=>existsSync(x.state.receipt_path))}));
`);
    const result = execFileSync(process.execPath, [driver], { cwd: root, env: plainEnv(), encoding: 'utf8', timeout: 10000, maxBuffer: 1024 ** 2, stdio: ['ignore', 'pipe', 'pipe'] });
    const parsed = JSON.parse(result);
    for (const item of [parsed.first, parsed.second]) {
      assert.equal(item.state.depth, 1);
      assert.equal(item.nested.state.depth, 2);
      assert.equal(item.nested.nested.depth, 3);
      assert.equal(item.state.started_ms, parsed.started);
      assert.equal(item.nested.state.root_deadline_ms, item.state.root_deadline_ms);
      assert.equal(item.nested.state.deadline_ms, item.state.deadline_ms - CLEANUP_RESERVE_MS);
      assert.equal(item.nested.nested.root_deadline_ms, item.state.root_deadline_ms);
      assert.equal(item.nested.nested.deadline_ms, item.nested.state.deadline_ms - CLEANUP_RESERVE_MS);
      assert.equal(item.unrelated, 'ETIMEDOUT');
      assert.equal(item.preloads.split(/\s+/u).length, 2);
      for (const depth of [1, 2, 3]) {
        assert.equal(item.events.filter(event => event.event === 'preload_active' && event.depth === depth).length, 1);
        assert.equal(item.events.filter(event => event.event === 'child_budget' && event.depth === depth).length, 1);
      }
    }
    assert.equal(parsed.first.state.root_deadline_ms, parsed.second.state.root_deadline_ms);
    assert.equal(parsed.receipt_exists, false);
  });
});

test('native v30 exit status, stdout and stderr survive the adapter, with owned receipt cleanup', { timeout: 10000 }, async () => {
  await fixture(async (root, base) => {
    await writeFile(resolve(base, 'corrective-assessment-v30.mjs'), `
import { readExecutionState } from './historical-execution-policy-v1.mjs';
console.log(JSON.stringify(readExecutionState()));
console.error('synthetic validator exit detail');
process.exit(7);
`);
    const driver = resolve(root, 'failure.mjs');
    await writeFile(driver, `
import { existsSync } from 'node:fs';
import { runHistoricalV30CheckSync } from ${JSON.stringify(pathToFileURL(resolve(base, 'historical-v30-execution.mjs')).href)};
try { runHistoricalV30CheckSync(${JSON.stringify(resolve(base, 'corrective-assessment-v30.mjs'))},['--check'],{encoding:'utf8',stdio:'pipe'}); process.exit(99); }
catch(error) { const state=JSON.parse(error.stdout); console.log(JSON.stringify({status:error.status,stderr:error.stderr,receipt_exists:existsSync(state.receipt_path)})); }
`);
    const output = execFileSync(process.execPath, [driver], { cwd: root, env: plainEnv(), encoding: 'utf8', timeout: 5000, maxBuffer: 1024 ** 2, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.deepEqual(JSON.parse(output), { status: 7, stderr: 'synthetic validator exit detail\n', receipt_exists: false });
  });
});

test('native inherited v1 state keeps its root deadline and receipt ownership in the caller', { timeout: 10000 }, async () => {
  await fixture(async (root, base) => {
    const receipt = resolve(root, 'caller-receipt.jsonl'); await writeFile(receipt, '');
    const now = Date.now(), state = { policy: POLICY_ID, policy_sha256: POLICY_SHA256, started_ms: now,
      root_deadline_ms: now + ROOT_BUDGET_MS, deadline_ms: now + 30000, depth: 3, receipt_path: receipt };
    await writeFile(resolve(base, 'corrective-assessment-v30.mjs'), `
import { readExecutionState } from './historical-execution-policy-v1.mjs';
console.log(JSON.stringify(readExecutionState()));
`);
    const driver = resolve(root, 'inherited.mjs');
    await writeFile(driver, `
import { runHistoricalV30CheckSync } from ${JSON.stringify(pathToFileURL(resolve(base, 'historical-v30-execution.mjs')).href)};
process.stdout.write(runHistoricalV30CheckSync(${JSON.stringify(resolve(base, 'corrective-assessment-v30.mjs'))},['--check'],{encoding:'utf8',timeout:1}));
`);
    const env = { ...plainEnv(), [STATE_ENV]: JSON.stringify(state) };
    const output = execFileSync(process.execPath, [driver], { cwd: root, env, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 ** 2, stdio: ['ignore', 'pipe', 'pipe'] });
    const child = JSON.parse(output);
    assert.equal(child.depth, 4);
    assert.equal(child.started_ms, state.started_ms);
    assert.equal(child.root_deadline_ms, state.root_deadline_ms);
    assert.equal(child.deadline_ms, state.deadline_ms - CLEANUP_RESERVE_MS);
    const events = (await readFile(receipt, 'utf8')).trim().split('\n').map(JSON.parse);
    assert(events.some(event => event.event === 'child_budget' && event.depth === 4));
    assert(events.some(event => event.event === 'preload_active' && event.depth === 4));
  });
});
