import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, readdir, rm, lstat, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// No model/Worker is started. Native runner children either execute rules or must
// reject before attempting inference. A local sentinel executable cannot load a
// model or send a request, and its execution would fail the test.
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ENGINE = resolve(process.env.MATERIAL_FACTS_V7_ENGINEERING_ROOT || ROOT);
const E = 'experiments/material-facts-v7';
const { BACKENDS, RUN_HASH_FILES, createFreeze, validateDevelopment, messageBytes, priorDeepseekReservation, loadPolicy } =
  await import(pathToFileURL(resolve(ENGINE, E, 'freeze.mjs')));
const execute = promisify(execFile);
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const lines = value => value.map(row => JSON.stringify(row)).join('\n') + '\n';
const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const write = async (root, path, value) => { await mkdir(dirname(resolve(root, path)), { recursive: true }); await writeFile(resolve(root, path), value); };

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'anxin-v7-independent-gates-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await write(root, 'package.json', '{"type":"module"}\n');
  const files = new Set([...RUN_HASH_FILES, `${E}/data/dev.inputs.jsonl`, `${E}/data/holdout.inputs.jsonl`,
    `${E}/api-models-preflight.json`, 'experiments/material-facts-v6/freeze.mjs']);
  for (const entry of await readdir(resolve(ENGINE, 'lib'))) if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) files.add(`lib/${entry}`);
  for (const path of files) {
    await mkdir(dirname(resolve(root, path)), { recursive: true });
    await copyFile(resolve(ENGINE, path), resolve(root, path));
  }
  await mkdir(resolve(root, E, 'results'), { recursive: true });
  await write(root, 'fixture-python', '#!/bin/sh\nif [ "$1" = "-c" ]; then printf "anxin-v7-python-ready\\n"; exit 0; fi\nprintf unexpected > "' + resolve(root, 'unexpected-worker-started') + '"\nexit 79\n');
  await chmod(resolve(root, 'fixture-python'), 0o700);
  await write(root, 'fixture-key', 'independent-test-not-a-real-credential\n');
  await chmod(resolve(root, 'fixture-key'), 0o600);
  const devBytes = await readFile(resolve(root, E, 'data/dev.inputs.jsonl'));
  const inputs = devBytes.toString().trim().split('\n').map(JSON.parse);
  return { root, inputs, devBytes, policy: await loadPolicy(root) };
}

async function run({ root }, backend, inputs, name, extra = []) {
  const out = resolve(root, E, 'results', name);
  try {
    const result = await execute(process.execPath, [resolve(root, E, 'run.mjs'), '--mode', 'diagnostic', '--backend', backend,
      '--inputs', resolve(root, inputs), '--out', out, '--python', resolve(root, 'fixture-python'),
      '--key-file', resolve(root, 'fixture-key'), ...extra], { cwd: root, timeout: 10_000, maxBuffer: 256 * 1024 });
    assert.equal(await exists(resolve(root, 'unexpected-worker-started')), false, 'No fixture may start an inference worker.');
    return { code: 0, out, ...result };
  } catch (error) {
    assert.equal(await exists(resolve(root, 'unexpected-worker-started')), false, 'No fixture may start an inference worker.');
    assert.equal(typeof error.code, 'number', 'Gate check must terminate normally instead of hanging or spawning a missing executable.');
    return { code: error.code, out, stdout: error.stdout, stderr: error.stderr };
  }
}

async function developmentAttempts(f) {
  const hashes = {};
  for (const path of RUN_HASH_FILES) hashes[path] = sha(await readFile(resolve(f.root, path)));
  const messages = await messageBytes(f.inputs, f.root);
  for (const backend of BACKENDS) {
    const directory = `${E}/results/dev-${backend}-fixture`;
    await write(f.root, `${directory}/protocol.json`, json({ backend, mode: 'diagnostic', input_sha256: sha(f.devBytes),
      case_ids: f.inputs.map(row => row.id), hashes, synthetic_test_receipt: true }));
    await write(f.root, `${directory}/messages.jsonl`, messages);
    const ids = f.inputs.map(row => row.id);
    await write(f.root, `${directory}/results.jsonl`, lines(ids.map(id => ({ id, backend, raw_output: '[]', finish_reason: 'stop' }))));
    const attempt = ids => ({ ids, completed: true, code: 0, signal: null, stop_reason: null, incomplete_stdout: false });
    await write(f.root, `${directory}/outcome.json`, json(backend === 'rules' ? { completed: true } : { completed: true,
      isolation: backend === 'qwen' ? 'fresh_process_per_document' : 'sequential_requests',
      attempts: backend === 'qwen' ? ids.map(id => attempt([id])) : [attempt(ids)] }));
  }
  return { hashes, messages };
}

test('native rules diagnostic rejects the real holdout before creating any attempt', async t => {
  const f = await fixture(t), result = await run(f, 'rules', `${E}/data/holdout.inputs.jsonl`, 'dev-misrouted-holdout');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /complete preregistered three-case development input/);
  assert.equal(await exists(result.out), false);
});

test('native diagnostic rejects a changed development source even when all three IDs remain unchanged', async t => {
  const f = await fixture(t), changed = structuredClone(f.inputs);
  changed[0].source.blocks[0].text += ' ';
  await write(f.root, `${E}/changed-dev.inputs.jsonl`, lines(changed));
  const result = await run(f, 'rules', `${E}/changed-dev.inputs.jsonl`, 'dev-changed-source');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /complete preregistered three-case development input/);
  assert.equal(await exists(result.out), false);
});

for (const script of ['freeze', 'verify', 'summarize']) test(`native ${script} CLI executes its argument guard through a temporary-directory path alias`, async t => {
  const f = await fixture(t);
  let failed = false;
  try {
    const result = await execute(process.execPath, [resolve(f.root, E, `${script}.mjs`), '--independent-invalid-option'],
      { cwd: f.root, timeout: 10_000, maxBuffer: 256 * 1024 });
    assert.fail(`CLI silently accepted an invalid option: ${JSON.stringify({ stdout: result.stdout, stderr: result.stderr })}`);
  } catch (error) {
    if (error.code === 'ERR_ASSERTION') throw error;
    assert.equal(error.code, 1, 'Native CLI must execute its own guard and fail with status 1.');
    assert.match(error.stderr, /"status":"FAIL"/);
    assert.match(error.stderr, /takes no arguments|Expected/);
    failed = true;
  }
  assert.equal(failed, true);
});

test('a complete development-only fixture passes the independent pre-freeze binding check', async t => {
  const f = await fixture(t);
  await developmentAttempts(f);
  const result = await validateDevelopment(f.root, f.inputs);
  assert.deepEqual(result.backends, [...BACKENDS].sort());
  assert.equal(result.input_sha256, sha(f.devBytes));
  assert.equal(result.messages_sha256, sha(await messageBytes(f.inputs, f.root)));
});

test('pre-freeze development check rejects altered model messages', async t => {
  const f = await fixture(t), baseline = await developmentAttempts(f);
  await write(f.root, `${E}/results/dev-rules-fixture/messages.jsonl`, baseline.messages.replace('"role":"system"', '"role":"user"'));
  await assert.rejects(validateDevelopment(f.root, f.inputs), /messages differ/);
});

for (const mutation of ['case_ids', 'input_sha256']) test(`pre-freeze development check rejects a non-development ${mutation} receipt`, async t => {
  const f = await fixture(t); await developmentAttempts(f);
  const path = resolve(f.root, E, 'results/dev-rules-fixture/protocol.json'), protocol = JSON.parse(await readFile(path));
  protocol[mutation] = mutation === 'case_ids' ? ['unregistered-case'] : '0'.repeat(64);
  await writeFile(path, json(protocol));
  await assert.rejects(validateDevelopment(f.root, f.inputs), /non-development IDs|other than the registered development/);
});

test('freeze rejects a formal attempt directory before reading or freezing any new labels', async t => {
  const f = await fixture(t);
  await mkdir(resolve(f.root, E, 'results/holdout-rules-1'));
  await assert.rejects(createFreeze(f.root), /formal attempt exists before freezing/i);
  assert.equal(await exists(resolve(f.root, E, 'freeze.json')), false);
});

test('development binding rejects a disguised pre-freeze formal attempt', async t => {
  const f = await fixture(t); await developmentAttempts(f);
  const path = resolve(f.root, E, 'results/dev-rules-fixture/protocol.json'), protocol = JSON.parse(await readFile(path));
  protocol.mode = 'holdout'; await writeFile(path, json(protocol));
  await assert.rejects(validateDevelopment(f.root, f.inputs), /not diagnostic/);
});

test('native runner never overwrites an existing attempt directory', async t => {
  const f = await fixture(t), path = `${E}/results/dev-rules-existing/sentinel.bin`, bytes = Buffer.from([0, 1, 2, 255]);
  await write(f.root, path, bytes);
  const result = await run(f, 'rules', `${E}/data/dev.inputs.jsonl`, 'dev-rules-existing');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /EEXIST/);
  assert.deepEqual(await readFile(resolve(f.root, path)), bytes);
  assert.deepEqual(await readdir(result.out), ['sentinel.bin']);
});

test('freeze creation and later diagnostic runs both preserve an existing freeze byte for byte', async t => {
  const f = await fixture(t), frozen = '{"synthetic_existing_freeze":true}\n';
  await write(f.root, `${E}/freeze.json`, frozen);
  await assert.rejects(createFreeze(f.root), /already exists/);
  const result = await run(f, 'rules', `${E}/data/dev.inputs.jsonl`, 'dev-after-freeze');
  assert.notEqual(result.code, 0); assert.match(result.stderr, /closed after freezing/);
  assert.equal(await exists(result.out), false);
  assert.equal(await readFile(resolve(f.root, E, 'freeze.json'), 'utf8'), frozen);
});

test('prior budget counts both development and stopped formal attempts without refunding unreturned cases', async t => {
  const f = await fixture(t), messages = JSON.parse((await messageBytes(f.inputs.slice(0, 1), f.root)).trim());
  const perRequest = (messages.messages.reduce((n, row) => n + Buffer.byteLength(row.content), 0) + 1024) * 1.32 / 1e6 + 4096 * 3.96 / 1e6;
  for (const [name, completed] of [['dev-failed', false], ['holdout-deepseek-1', false]]) {
    await write(f.root, `${E}/results/${name}/protocol.json`, json({ backend: 'deepseek', deepseek: f.policy.deepseek }));
    await write(f.root, `${E}/results/${name}/messages.jsonl`, lines([messages, messages]));
    await write(f.root, `${E}/results/${name}/outcome.json`, json({ completed }));
    await write(f.root, `${E}/results/${name}/results.jsonl`, '');
  }
  assert(Math.abs(await priorDeepseekReservation(f.root, f.policy) - perRequest * 4) < 1e-12);
  const requests = Array.from({ length: Math.ceil(2 / perRequest) + 1 }, () => messages);
  await write(f.root, `${E}/results/another-failed-attempt/protocol.json`, json({ backend: 'deepseek', deepseek: f.policy.deepseek }));
  await write(f.root, `${E}/results/another-failed-attempt/messages.jsonl`, lines(requests));
  await assert.rejects(priorDeepseekReservation(f.root, f.policy), /exhausted.*budget/);
});

test('an existing atomic DeepSeek budget lock blocks native runner before inference and is left for reconciliation', async t => {
  const f = await fixture(t), lock = `${E}/results/.deepseek-budget.lock`, marker = 'prior interrupted reservation\n';
  await write(f.root, `${lock}/owner.txt`, marker);
  const route = f.policy.deepseek.egress === 'temporary_loopback_ssh_test_host' ? ['--connect-port', '1'] : [];
  const result = await run(f, 'deepseek', `${E}/data/dev.inputs.jsonl`, 'dev-locked-deepseek', route);
  assert.notEqual(result.code, 0); assert.match(result.stderr, /EEXIST/);
  assert.equal(await exists(result.out), false);
  assert.equal(await readFile(resolve(f.root, lock, 'owner.txt'), 'utf8'), marker);
});

test('native runner reserves the entire next development batch before spending the remaining budget', async t => {
  const f = await fixture(t), message = JSON.parse((await messageBytes(f.inputs.slice(0, 1), f.root)).trim());
  const perRequest = (message.messages.reduce((n, row) => n + Buffer.byteLength(row.content), 0) + 1024) * 1.32 / 1e6 + 4096 * 3.96 / 1e6;
  const oldProtocol = json({ backend: 'deepseek', deepseek: f.policy.deepseek });
  await write(f.root, `${E}/results/dev-previous-failed/protocol.json`, oldProtocol);
  await write(f.root, `${E}/results/dev-previous-failed/messages.jsonl`, lines(Array.from({ length: Math.floor(2 / perRequest) }, () => message)));
  const prior = await priorDeepseekReservation(f.root, f.policy);
  assert(prior > 0 && prior <= 2, 'Prior reservations alone must still be within budget.');
  const route = f.policy.deepseek.egress === 'temporary_loopback_ssh_test_host' ? ['--connect-port', '1'] : [];
  const result = await run(f, 'deepseek', `${E}/data/dev.inputs.jsonl`, 'dev-insufficient-remaining-budget', route);
  assert.notEqual(result.code, 0); assert.match(result.stderr, /development plus holdout reservation exceeds 2 USD/);
  assert.equal(await exists(result.out), false);
  assert.equal(await exists(resolve(f.root, E, 'results/.deepseek-budget.lock')), false);
  assert.equal(await readFile(resolve(f.root, E, 'results/dev-previous-failed/protocol.json'), 'utf8'), oldProtocol);
});
