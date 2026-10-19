import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SOURCE = resolve(process.env.MATERIAL_FACTS_V7_SOURCE_ROOT || ROOT);
const ENGINE = resolve(process.env.MATERIAL_FACTS_V7_ENGINEERING_ROOT || ROOT);
const E = 'experiments/material-facts-v7';
const { RUN_HASH_FILES, loadPolicy, priorDeepseekReservation } = await import(pathToFileURL(resolve(SOURCE, E, 'freeze.mjs')));
const execute = promisify(execFile);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const write = async (root, path, bytes) => {
  await mkdir(dirname(resolve(root, path)), { recursive: true });
  await writeFile(resolve(root, path), bytes);
};

// All requests are synthetic. Rules execute locally; the only other executable
// answers the Python probe, writes a sentinel and exits. No model worker, API,
// historical input, freeze or experiment output is executed or copied.
async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'anxin-v7-reserved-name-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await write(root, 'package.json', '{"type":"module"}\n');
  const files = new Set([...RUN_HASH_FILES, `${E}/api-models-preflight.json`, 'experiments/material-facts-v6/freeze.mjs']);
  for (const file of await readdir(resolve(SOURCE, 'lib'))) if (file.endsWith('.ts') && !file.endsWith('.test.ts')) files.add(`lib/${file}`);
  for (const file of files) {
    await mkdir(dirname(resolve(root, file)), { recursive: true });
    await copyFile(resolve(file === `${E}/run.mjs` ? ENGINE : SOURCE, file), resolve(root, file));
  }
  const rows = [1, 2, 3].map(index => {
    const text = `王甲的第${index}份合成材料未陈述金额。`;
    return { id: `synthetic-${index}`, source: { id: `synthetic-source-${index}`, name: '合成路径门禁', sha256: sha(text), analysisRevision: 1, ready: true,
      blocks: [{ id: 'b1', page: 1, text, bbox: null, confidence: null }] } };
  });
  await write(root, `${E}/data/dev.inputs.jsonl`, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  const python = resolve(root, 'sentinel-python.mjs');
  await writeFile(python, `#!${process.execPath}\nimport {writeFile} from 'node:fs/promises';\nif(process.argv[2]==='-c') console.log('anxin-v7-python-ready');\nelse {await writeFile(${JSON.stringify(resolve(root, 'worker-started'))},'sentinel-only\\n');process.exitCode=7;}\n`, { mode: 0o700 });
  await writeFile(resolve(root, 'synthetic-key'), 'synthetic-not-a-real-key\n', { mode: 0o600 });
  return { root, python, policy: await loadPolicy(root) };
}

async function entries(path) {
  try { return (await readdir(path)).sort(); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function run(f, name, { backend = 'rules', inputs, credentials = true } = {}) {
  const out = resolve(f.root, E, 'results', name);
  const args = [resolve(f.root, E, 'run.mjs'), '--mode', 'diagnostic', '--backend', backend,
    '--inputs', inputs || resolve(f.root, E, 'data/dev.inputs.jsonl'), '--out', out];
  if (backend === 'deepseek' && credentials) {
    args.push('--python', f.python, '--key-file', resolve(f.root, 'synthetic-key'));
    if (f.policy.deepseek.egress === 'temporary_loopback_ssh_test_host') args.push('--connect-port', '443');
  }
  try { return { code: 0, out, ...await execute(process.execPath, args, { cwd: f.root, timeout: 5000, maxBuffer: 64 * 1024 }) }; }
  catch (error) {
    assert.equal(typeof error.code, 'number', `Runner must terminate itself: ${error}`);
    return { code: error.code, out, stdout: error.stdout, stderr: error.stderr };
  }
}

for (const name of ['.deepseek-budget.lock', '.DEEPSEEK-BUDGET.LOCK', '.DeepSeek-Budget.Lock', 'unused/../.deepseek-budget.lock', '.deepseek-budget.lock/']) {
  test(`reserved output ${name} rejects before any attempt or control lock is created`, async t => {
    const f = await fixture(t), result = await run(f, name);
    assert.notEqual(result.code, 0, 'A rules attempt must never occupy the budget lock path');
    assert.match(result.stderr, /reserved control directory name/u);
    assert.equal(await entries(resolve(f.root, E, 'results')), null);
    assert.equal(await entries(resolve(f.root, E, '.experiment.lock')), null);
    assert.equal(await entries(resolve(f.root, 'worker-started')), null);
  });
}

test('reserved path validation precedes backend credentials, input reads and artifact writes', async t => {
  const f = await fixture(t);
  const result = await run(f, '.deepseek-budget.lock', { backend: 'deepseek', credentials: false, inputs: resolve(f.root, 'missing-input') });
  assert.notEqual(result.code, 0); assert.match(result.stderr, /reserved control directory name/u);
  assert.equal(await entries(resolve(f.root, E, 'results')), null);
  assert.equal(await entries(resolve(f.root, E, '.experiment.lock')), null);
});

test('reserved-name rejection preserves an existing lock and all earlier attempt bytes', async t => {
  const f = await fixture(t), lockOwner = 'interrupted reservation: reconcile manually\n', oldOutput = 'old failure and raw evidence\n';
  await write(f.root, `${E}/results/.deepseek-budget.lock/owner.txt`, lockOwner);
  await write(f.root, `${E}/results/dev-preserved/outcome.json`, oldOutput);
  const result = await run(f, '.deepseek-budget.lock');
  assert.notEqual(result.code, 0); assert.match(result.stderr, /reserved control directory name/u);
  assert.deepEqual(await entries(resolve(f.root, E, 'results')), ['.deepseek-budget.lock', 'dev-preserved']);
  assert.deepEqual(await entries(resolve(f.root, E, 'results/.deepseek-budget.lock')), ['owner.txt']);
  assert.equal(await readFile(resolve(f.root, E, 'results/.deepseek-budget.lock/owner.txt'), 'utf8'), lockOwner);
  assert.equal(await readFile(resolve(f.root, E, 'results/dev-preserved/outcome.json'), 'utf8'), oldOutput);
  assert.equal(await entries(resolve(f.root, E, '.experiment.lock')), null);
});

test('rejected reserved path cannot block a later ordinary rules or sentinel DeepSeek attempt', async t => {
  const f = await fixture(t), rejected = await run(f, '.deepseek-budget.lock');
  assert.notEqual(rejected.code, 0);
  const rules = await run(f, 'dev-rules-safe');
  assert.equal(rules.code, 0, rules.stderr);
  assert.equal(JSON.parse(await readFile(resolve(rules.out, 'outcome.json'))).completed, true);
  const worker = await run(f, 'dev-deepseek-sentinel', { backend: 'deepseek' });
  assert.equal(worker.code, 1, worker.stderr);
  assert.equal(await readFile(resolve(f.root, 'worker-started'), 'utf8'), 'sentinel-only\n');
  const outcome = JSON.parse(await readFile(resolve(worker.out, 'outcome.json')));
  assert.equal(outcome.completed, false); assert.equal(outcome.attempts[0].code, 7);
  assert.equal(await entries(resolve(f.root, E, 'results/.deepseek-budget.lock')), null);
  assert((await priorDeepseekReservation(f.root, f.policy)) > 0, 'A started failure retains its budget reservation');
  const bytes = await readFile(resolve(worker.out, 'outcome.json'));
  const retry = await run(f, 'dev-deepseek-sentinel', { backend: 'deepseek' });
  assert.notEqual(retry.code, 0); assert.match(retry.stderr, /EEXIST/u);
  assert.deepEqual(await readFile(resolve(worker.out, 'outcome.json')), bytes);
});

for (const name of ['.diagnostic-not-a-control-lock', '.deepseek-budget.locked']) {
  test(`ordinary neighbouring name ${name} remains a usable immutable attempt`, async t => {
    const f = await fixture(t), result = await run(f, name);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(await readFile(resolve(result.out, 'outcome.json'))).completed, true);
    const before = await readFile(resolve(result.out, 'results.jsonl'));
    const retry = await run(f, name);
    assert.notEqual(retry.code, 0); assert.match(retry.stderr, /EEXIST/u);
    assert.deepEqual(await readFile(resolve(result.out, 'results.jsonl')), before);
  });
}

test('the experiment-root control lock remains outside every permitted attempt path', async t => {
  const f = await fixture(t), owner = 'existing experiment owner\n';
  await write(f.root, `${E}/.experiment.lock/owner.json`, owner);
  const result = await run(f, '../.experiment.lock');
  assert.notEqual(result.code, 0); assert.match(result.stderr, /direct children of v7\/results/u);
  assert.equal(await readFile(resolve(f.root, E, '.experiment.lock/owner.json'), 'utf8'), owner);
  assert.equal(await entries(resolve(f.root, E, 'results')), null);
});
