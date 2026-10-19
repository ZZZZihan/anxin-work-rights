import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, readdir, rm, lstat, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SOURCE = resolve(process.env.MATERIAL_FACTS_V7_SOURCE_ROOT || ROOT);
const ENGINE = resolve(process.env.MATERIAL_FACTS_V7_ENGINEERING_ROOT || ROOT);
const E = 'experiments/material-facts-v7';
const engine = await import(pathToFileURL(resolve(ENGINE, E, 'freeze.mjs')));
const { BACKENDS, RUN_HASH_FILES, validateDevelopment, messageBytes, loadPolicy } = engine;
const execute = promisify(execFile);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const lines = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const write = async (root, file, bytes) => { await mkdir(dirname(resolve(root, file)), { recursive: true }); await writeFile(resolve(root, file), bytes); };

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'anxin-v7-run-readiness-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await write(root, 'package.json', '{"type":"module"}\n');
  const files = new Set([...RUN_HASH_FILES, `${E}/data/dev.inputs.jsonl`, `${E}/api-models-preflight.json`, 'experiments/material-facts-v6/freeze.mjs']);
  for (const file of await readdir(resolve(SOURCE, 'lib'))) if (file.endsWith('.ts') && !file.endsWith('.test.ts')) files.add(`lib/${file}`);
  for (const file of files) {
    const from = [`${E}/run.mjs`, `${E}/freeze.mjs`].includes(file) ? ENGINE : SOURCE;
    await mkdir(dirname(resolve(root, file)), { recursive: true });
    await copyFile(resolve(from, file), resolve(root, file));
  }
  // Test only the runner's pre-write lifecycle here, independently of the
  // immutable experiment's full preflight. No actual holdout is copied or read.
  await write(root, `${E}/verify.mjs`, `import { readFile } from 'node:fs/promises';
export async function verifyPreflight(root) { return { freeze: JSON.parse(await readFile(root + '/${E}/freeze.json', 'utf8')) }; }
`);
  const inputBytes = await readFile(resolve(root, E, 'data/dev.inputs.jsonl'));
  const inputs = inputBytes.toString().trim().split('\n').map(JSON.parse);
  const messages = await messageBytes(inputs, root);
  await write(root, `${E}/freeze.json`, json({ input_sha256: sha(inputBytes), messages_sha256: sha(messages), deepseek_egress: (await loadPolicy(root)).deepseek.egress }));
  // This executable only answers the harmless interpreter probe. A worker
  // launch writes a sentinel and fails; it cannot load a model or use a key.
  const python = resolve(root, 'fake-python');
  await writeFile(python, `#!/bin/sh
if [ "$1" = "-c" ]; then
  echo anxin-v7-python-ready
  exit 0
fi
echo started > '${root}/worker-started.txt'
exit 7
`);
  await chmod(python, 0o700);
  return { root, inputs, inputBytes, messages, python, policy: await loadPolicy(root) };
}

async function run(f, backend, extra = [], mode = 'holdout', python = f.python) {
  const out = resolve(f.root, E, 'results', mode === 'holdout' ? `holdout-${backend}-1` : `dev-${backend}-fixture`);
  const args = [resolve(f.root, E, 'run.mjs'), '--mode', mode, '--backend', backend,
    '--inputs', resolve(f.root, E, 'data/dev.inputs.jsonl'), '--out', out, ...(python === null ? [] : ['--python', python]), ...extra];
  if (backend === 'deepseek' && f.policy.deepseek.egress === 'temporary_loopback_ssh_test_host' && !extra.includes('--connect-port')) args.push('--connect-port', '443');
  try { return { code: 0, out, ...await execute(process.execPath, args, { cwd: f.root, timeout: 10_000, maxBuffer: 128 * 1024 }) }; }
  catch (error) { assert.equal(typeof error.code, 'number'); return { code: error.code, out, stdout: error.stdout, stderr: error.stderr }; }
}

async function development(f) {
  await rm(resolve(f.root, E, 'freeze.json'));
  const hashes = Object.fromEntries(await Promise.all(RUN_HASH_FILES.map(async file => [file, sha(await readFile(resolve(f.root, file)))])));
  const ids = f.inputs.map(row => row.id);
  for (const backend of BACKENDS) {
    const directory = `${E}/results/dev-${backend}-ready`;
    await write(f.root, `${directory}/protocol.json`, json({ backend, mode: 'diagnostic', input_sha256: sha(f.inputBytes), case_ids: ids, hashes }));
    await write(f.root, `${directory}/messages.jsonl`, f.messages);
    const batches = backend === 'qwen' ? ids.map(id => [id]) : [ids];
    const attempts = batches.map(ids => ({ ids, completed: true, code: 0, signal: null, stop_reason: null, incomplete_stdout: false }));
    await write(f.root, `${directory}/outcome.json`, json(backend === 'rules' ? { completed: true } : { completed: true, attempts }));
    await write(f.root, `${directory}/results.jsonl`, lines(ids.map(id => ({ id, backend, raw_output: '{"schemaVersion":3,"candidates":[]}', finish_reason: 'stop' }))));
  }
}

async function credential(f, content = 'synthetic-not-a-real-credential', mode = 0o600) {
  const path = resolve(f.root, 'synthetic-key');
  await writeFile(path, content, { mode }); await chmod(path, mode);
  return ['--key-file', path];
}

async function qwenPaths(f) {
  await write(f.root, 'model/config.json', '{}\n');
  await write(f.root, 'integrity/source-manifest.json', '{}\n');
  await write(f.root, 'integrity/weights-verification.json', '{}\n');
  return ['--model-path', resolve(f.root, 'model'), '--integrity-dir', resolve(f.root, 'integrity')];
}

async function rejectsBeforeWrite(f, backend, extra, pattern, python = f.python) {
  const result = await run(f, backend, extra, 'holdout', python);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, pattern);
  assert.equal(await exists(result.out), false);
  assert.equal(await exists(resolve(f.root, E, 'results')), false);
  assert.equal(await exists(resolve(f.root, 'worker-started.txt')), false);
}

test('missing DeepSeek credential rejects before allocating the unique formal attempt', async t => {
  const f = await fixture(t), result = await run(f, 'deepseek');
  assert.notEqual(result.code, 0);
  assert.equal(await exists(result.out), false, 'A missing backend argument must not consume the formal attempt');
  assert.equal(await exists(resolve(f.root, E, 'results')), false, 'Preflight rejection must not create an artifact root');
  assert.equal(await exists(resolve(f.root, 'worker-started.txt')), false);
});

test('a current-hash failed Qwen outcome cannot establish development readiness', async t => {
  const f = await fixture(t); await development(f);
  await write(f.root, `${E}/results/dev-qwen-ready/outcome.json`, json({ completed: false, attempts: [] }));
  await assert.rejects(validateDevelopment(f.root, f.inputs), /successful|complete|ready|outcome/i);
});

for (const missing of ['both', 'model-path', 'integrity-dir']) test(`Qwen missing ${missing} rejects before creating any artifacts`, async t => {
  const f = await fixture(t), all = await qwenPaths(f);
  const extra = missing === 'both' ? [] : missing === 'model-path' ? all.slice(2) : all.slice(0, 2);
  await rejectsBeforeWrite(f, 'qwen', extra, /requires --model-path and --integrity-dir/);
});

for (const invalid of ['model directory', 'integrity directory', 'configuration JSON', 'integrity receipt']) test(`Qwen invalid ${invalid} rejects before creating any artifacts`, async t => {
  const f = await fixture(t), extra = await qwenPaths(f);
  if (invalid === 'model directory') extra[1] = resolve(f.root, 'missing-model');
  if (invalid === 'integrity directory') extra[3] = resolve(f.root, 'model/config.json');
  if (invalid === 'configuration JSON') await write(f.root, 'model/config.json', '{truncated');
  if (invalid === 'integrity receipt') await rm(resolve(f.root, 'integrity/weights-verification.json'));
  await rejectsBeforeWrite(f, 'qwen', extra, /readable|valid JSON/);
});

for (const invalid of ['missing', 'directory', 'empty', 'shared']) test(`DeepSeek ${invalid} credential rejects without spending an attempt`, async t => {
  const f = await fixture(t);
  const extra = invalid === 'missing' ? ['--key-file', resolve(f.root, 'missing-key')]
    : invalid === 'directory' ? ['--key-file', f.root] : await credential(f, invalid === 'empty' ? ' \n' : 'synthetic-key', invalid === 'shared' ? 0o644 : 0o600);
  await rejectsBeforeWrite(f, 'deepseek', extra, /--key-file/);
});

for (const port of ['0', '65536', '-1', '1.5', 'not-a-port']) test(`DeepSeek port ${port} rejects before allocating an attempt`, async t => {
  const f = await fixture(t);
  await rejectsBeforeWrite(f, 'deepseek', [...await credential(f), '--connect-port', port], /--connect-port/);
});

for (const invalid of ['missing', 'non-executable', 'probe-failure']) test(`invalid Python ${invalid} rejects before creating any artifacts`, async t => {
  const f = await fixture(t), python = resolve(f.root, 'bad-python');
  if (invalid !== 'missing') { await writeFile(python, '#!/bin/sh\nexit 9\n'); await chmod(python, invalid === 'non-executable' ? 0o600 : 0o700); }
  await rejectsBeforeWrite(f, 'deepseek', await credential(f), /executable Python|no-model preflight/, python);
});

test('a missing worker script rejects without consuming the formal attempt', async t => {
  const f = await fixture(t); await rm(resolve(f.root, 'scripts/fact-runtime-v2.py'));
  await rejectsBeforeWrite(f, 'deepseek', await credential(f), /Worker script/);
});

test('a corrected configuration can reuse the same unconsumed path, while a started worker failure is immutable', async t => {
  const f = await fixture(t), first = await run(f, 'deepseek');
  assert.notEqual(first.code, 0); assert.equal(await exists(first.out), false);
  const extra = await credential(f), started = await run(f, 'deepseek', extra);
  assert.notEqual(started.code, 0); assert.equal(await exists(resolve(f.root, 'worker-started.txt')), true);
  const snapshot = Object.fromEntries(await Promise.all((await readdir(started.out)).map(async name => [name, await readFile(resolve(started.out, name))])));
  const outcome = JSON.parse(snapshot['outcome.json']);
  assert.equal(outcome.completed, false); assert.equal(outcome.attempts[0].code, 7);
  const retry = await run(f, 'deepseek', extra);
  assert.notEqual(retry.code, 0); assert.match(retry.stderr, /EEXIST/);
  for (const [name, bytes] of Object.entries(snapshot)) assert.deepEqual(await readFile(resolve(started.out, name)), bytes);
  assert.deepEqual((await readdir(started.out)).sort(), Object.keys(snapshot).sort());
});

test('rules can complete without any model paths, credentials or interpreter', async t => {
  const f = await fixture(t), result = await run(f, 'rules', [], 'holdout', null);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(await readFile(resolve(result.out, 'outcome.json'))).completed, true);
  assert.equal(await exists(resolve(f.root, 'worker-started.txt')), false);
});

test('complete current-hash runs with empty candidate arrays qualify all backends without a score threshold', async t => {
  const f = await fixture(t); await development(f);
  assert.deepEqual((await validateDevelopment(f.root, f.inputs)).backends, [...BACKENDS].sort());
});

const mutations = {
  'missing outcome': async (root, dir) => rm(resolve(root, dir, 'outcome.json')),
  'missing results': async (root, dir) => rm(resolve(root, dir, 'results.jsonl')),
  'empty results': async (root, dir) => write(root, `${dir}/results.jsonl`, ''),
  'missing case': async (root, dir, rows) => write(root, `${dir}/results.jsonl`, lines(rows.slice(1))),
  'duplicate case': async (root, dir, rows) => write(root, `${dir}/results.jsonl`, lines([rows[0], rows[0], rows[2]])),
  'foreign case': async (root, dir, rows) => write(root, `${dir}/results.jsonl`, lines([{ ...rows[0], id: 'unregistered' }, ...rows.slice(1)])),
  'wrong backend': async (root, dir, rows) => write(root, `${dir}/results.jsonl`, lines([{ ...rows[0], backend: 'rules' }, ...rows.slice(1)])),
  'nonterminal result': async (root, dir, rows) => write(root, `${dir}/results.jsonl`, lines([{ ...rows[0], finish_reason: 'length' }, ...rows.slice(1)])),
  'unterminated JSONL': async (root, dir, rows) => write(root, `${dir}/results.jsonl`, lines(rows).trimEnd()),
  'truncated JSON': async (root, dir, rows) => write(root, `${dir}/results.jsonl`, lines(rows) + '{"id":\n'),
  'partial worker stdout': async (root, dir) => write(root, `${dir}/partial-stdout-1.txt`, '{"type":"result"'),
};
for (const [name, mutate] of Object.entries(mutations)) test(`development readiness rejects ${name} despite current protocol hashes`, async t => {
  const f = await fixture(t); await development(f);
  const dir = `${E}/results/dev-qwen-ready`, rows = (await readFile(resolve(f.root, dir, 'results.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  await mutate(f.root, dir, rows);
  await assert.rejects(validateDevelopment(f.root, f.inputs), /successful complete development attempt/);
});

for (const backend of BACKENDS) test(`${backend} false completion cannot be hidden by otherwise complete stop rows`, async t => {
  const f = await fixture(t); await development(f);
  const dir = `${E}/results/dev-${backend}-ready`, path = resolve(f.root, dir, 'outcome.json'), outcome = JSON.parse(await readFile(path));
  outcome.completed = false; await writeFile(path, json(outcome));
  await assert.rejects(validateDevelopment(f.root, f.inputs), /successful complete development attempt/);
});

for (const name of ['code', 'signal', 'stop_reason', 'incomplete_stdout', 'ids', 'missing attempt']) test(`Qwen unsuccessful process receipt ${name} cannot be ready`, async t => {
  const f = await fixture(t); await development(f);
  const path = resolve(f.root, E, 'results/dev-qwen-ready/outcome.json'), outcome = JSON.parse(await readFile(path));
  if (name === 'missing attempt') outcome.attempts.pop();
  else outcome.attempts[0][name] = { code: 1, signal: 'SIGTERM', stop_reason: 'parent_cancel', incomplete_stdout: true, ids: ['other-id'] }[name];
  await writeFile(path, json(outcome));
  await assert.rejects(validateDevelopment(f.root, f.inputs), /successful complete development attempt/);
});

test('a preserved failed historical attempt does not veto a separate complete current run', async t => {
  const f = await fixture(t); await development(f);
  const failed = `${E}/results/dev-qwen-failed`, complete = `${E}/results/dev-qwen-ready`;
  for (const name of ['protocol.json', 'messages.jsonl', 'results.jsonl']) await write(f.root, `${failed}/${name}`, await readFile(resolve(f.root, complete, name)));
  await write(f.root, `${failed}/outcome.json`, json({ completed: false, attempts: [] }));
  const before = await readFile(resolve(f.root, failed, 'outcome.json'));
  assert.deepEqual((await validateDevelopment(f.root, f.inputs)).backends, [...BACKENDS].sort());
  assert.deepEqual(await readFile(resolve(f.root, failed, 'outcome.json')), before);
});

test('all six original successful development artifacts satisfy completion without rewriting them', async () => {
  let count = 0;
  for (const name of (await readdir(resolve(SOURCE, E, 'results'))).filter(name => /^dev-(rules|qwen|deepseek)-[12]$/u.test(name))) {
    const dir = resolve(SOURCE, E, 'results', name), names = ['protocol.json', 'outcome.json', 'results.jsonl'];
    const before = await Promise.all(names.map(name => readFile(resolve(dir, name))));
    const result = await engine.validateDevelopmentCompletion(dir, JSON.parse(before[0]));
    assert.equal(result.cases, 3);
    for (let i = 0; i < names.length; i++) assert.deepEqual(await readFile(resolve(dir, names[i])), before[i]);
    count++;
  }
  assert.equal(count, 6);
});

