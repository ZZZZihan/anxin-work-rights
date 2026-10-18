import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// All mutations are in disposable roots. Only the registered development inputs
// are copied into runner fixtures. The historical restoration fixtures copy saved
// evidence without executing an inference worker, network client, or assessment.
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ENGINE = resolve(process.env.MATERIAL_FACTS_V7_ENGINEERING_ROOT || ROOT);
const E = 'experiments/material-facts-v7';
const execute = promisify(execFile);
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const lines = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const write = async (root, path, value) => { await mkdir(dirname(resolve(root, path)), { recursive: true }); await writeFile(resolve(root, path), value); };
const engineering = await import(pathToFileURL(resolve(ENGINE, E, 'freeze.mjs')));
const { BACKENDS, RUN_HASH_FILES, messageBytes, validateDevelopment, loadPolicy } = engineering;

async function temporary(t, name) {
  const root = await mkdtemp(resolve(tmpdir(), `anxin-v7-independent-${name}-`));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function fixture(t) {
  const root = await temporary(t, 'integrity');
  await write(root, 'package.json', '{"type":"module"}\n');
  const files = new Set([...RUN_HASH_FILES, `${E}/data/dev.inputs.jsonl`, `${E}/api-models-preflight.json`,
    'experiments/material-facts-v6/freeze.mjs']);
  for (const entry of await readdir(resolve(ENGINE, 'lib'))) if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) files.add(`lib/${entry}`);
  for (const path of files) {
    await mkdir(dirname(resolve(root, path)), { recursive: true });
    await copyFile(resolve(ENGINE, path), resolve(root, path));
  }
  await mkdir(resolve(root, E, 'results'), { recursive: true });
  const bytes = await readFile(resolve(root, E, 'data/dev.inputs.jsonl'));
  const inputs = bytes.toString().trim().split('\n').map(JSON.parse);
  const messages = await messageBytes(inputs, root), policy = await loadPolicy(root);
  // Formal preflight is deliberately replaced only in this disposable fixture.
  // This isolates argument validation from historical verification. It cannot
  // authorize any actual request: the only executable is a failing sentinel.
  await write(root, `${E}/verify.mjs`, `import {readFile} from 'node:fs/promises';\nexport async function verifyPreflight(root) {return {freeze:JSON.parse(await readFile(root+'/${E}/freeze.json','utf8'))};}\n`);
  await write(root, 'fixture-python', `#!/bin/sh\nif [ "$1" = "-c" ]; then printf "anxin-v7-python-ready\\n"; exit 0; fi\nprintf unexpected > "${resolve(root, 'unexpected-worker-started')}"\nexit 79\n`);
  await chmod(resolve(root, 'fixture-python'), 0o700);
  await write(root, 'fixture-key', 'independent-test-not-a-real-credential\n');
  await chmod(resolve(root, 'fixture-key'), 0o600);
  // A minimal readable model fixture is never loaded. Omitting the integrity
  // directory is still invalid even when all preceding arguments are usable.
  await write(root, 'fixture-model/config.json', '{}\n');
  await write(root, 'fixture-model/model.safetensors.index.json', '{"weight_map":{"fixture":"model-00001.safetensors"}}\n');
  await write(root, 'fixture-model/model-00001.safetensors', 'not-weights\n');
  await write(root, 'fixture-integrity/source-manifest.json', '{}\n');
  await write(root, 'fixture-integrity/weights-verification.json', '{}\n');
  return { root, bytes, inputs, messages, policy };
}

async function formal(f, backend, extra = []) {
  await write(f.root, `${E}/freeze.json`, json({ input_sha256: sha(f.bytes), messages_sha256: sha(f.messages), deepseek_egress: f.policy.deepseek.egress }));
  const out = resolve(f.root, E, `results/holdout-${backend}-1`);
  const route = backend === 'deepseek' && !extra.includes('--connect-port') && f.policy.deepseek.egress === 'temporary_loopback_ssh_test_host' ? ['--connect-port', '1'] : [];
  let result;
  try {
    const python = extra.includes('--python') ? [] : ['--python', resolve(f.root, 'fixture-python')];
    result = { code: 0, ...await execute(process.execPath, [resolve(f.root, E, 'run.mjs'), '--mode', 'holdout', '--backend', backend,
      '--inputs', resolve(f.root, E, 'data/dev.inputs.jsonl'), '--out', out, ...python, ...route, ...extra],
    { cwd: f.root, timeout: 10000, maxBuffer: 256 * 1024 }) };
  } catch (error) {
    assert.equal(typeof error.code, 'number', 'Runner gate must terminate without timeout.');
    result = { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
  return { ...result, out };
}

async function completeDevelopment(f) {
  const hashes = Object.fromEntries(await Promise.all(RUN_HASH_FILES.map(async path => [path, sha(await readFile(resolve(f.root, path)))])));
  const ids = f.inputs.map(row => row.id);
  for (const backend of BACKENDS) {
    const directory = `${E}/results/dev-${backend}-fixture`;
    await write(f.root, `${directory}/protocol.json`, json({ backend, mode: 'diagnostic', input_sha256: sha(f.bytes), case_ids: ids, hashes }));
    await write(f.root, `${directory}/messages.jsonl`, f.messages);
    // Empty candidates are a legitimate terminal model answer, not an empty
    // result stream and not an unfinished process.
    await write(f.root, `${directory}/results.jsonl`, lines(ids.map(id => ({ id, backend, finish_reason: 'stop', raw_output: '[]' }))));
    const attempt = ids => ({ ids, completed: true, code: 0, signal: null, stop_reason: null, incomplete_stdout: false });
    await write(f.root, `${directory}/outcome.json`, json(backend === 'rules' ? { completed: true } : {
      completed: true, isolation: backend === 'qwen' ? 'fresh_process_per_document' : 'sequential_requests',
      attempts: backend === 'qwen' ? ids.map(id => attempt([id])) : [attempt(ids)],
    }));
  }
}

for (const [name, backend, extra] of [
  ['missing Qwen model arguments', 'qwen', []],
  ['missing Qwen integrity directory', 'qwen', ['--model-path', 'fixture-model']],
  ['unreadable Qwen model path', 'qwen', ['--model-path', 'no-such-model', '--integrity-dir', 'no-such-integrity']],
  ['missing DeepSeek credential argument', 'deepseek', []],
  ['unreadable DeepSeek credential file', 'deepseek', ['--key-file', 'no-such-key']],
  ['missing Python executable', 'qwen', ['--model-path', 'fixture-model', '--integrity-dir', 'fixture-integrity', '--python', 'no-such-python']],
  ['non-numeric transport port', 'deepseek', ['--key-file', 'fixture-key', '--connect-port', 'invalid']],
  ['zero transport port', 'deepseek', ['--key-file', 'fixture-key', '--connect-port', '0']],
  ['out-of-range transport port', 'deepseek', ['--key-file', 'fixture-key', '--connect-port', '65536']],
]) test(`formal runner rejects ${name} without consuming the unique attempt or starting a worker`, async t => {
  const f = await fixture(t), result = await formal(f, backend, extra.map((value, index) => index % 2 && extra[index - 1] !== '--connect-port' ? resolve(f.root, value) : value));
  assert.notEqual(result.code, 0);
  assert.equal(await exists(result.out), false, 'Invalid backend configuration consumed the one formal attempt directory.');
  assert.equal(await exists(resolve(f.root, 'unexpected-worker-started')), false, 'Argument rejection reached an inference worker.');
  assert.equal(await exists(resolve(f.root, E, 'results/.deepseek-budget.lock')), false);
});

test('formal rules need no model arguments and save all registered terminal rows', async t => {
  const f = await fixture(t), result = await formal(f, 'rules');
  assert.equal(result.code, 0, result.stderr);
  const rows = (await readFile(resolve(result.out, 'results.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 3);
  assert(rows.every(row => row.backend === 'rules' && row.finish_reason === 'stop' && typeof row.raw_output === 'string'));
  assert.equal(JSON.parse(await readFile(resolve(result.out, 'outcome.json'))).completed, true);
  assert.equal(await exists(resolve(f.root, 'unexpected-worker-started')), false);
});

test('all three completed development attempts may legitimately return no candidates', async t => {
  const f = await fixture(t); await completeDevelopment(f);
  assert.deepEqual((await validateDevelopment(f.root, f.inputs)).backends, [...BACKENDS].sort());
});

for (const [name, mutate] of [
  ['missing outcome', async (f, dir) => rm(resolve(dir, 'outcome.json'))],
  ['incomplete outcome', async (f, dir) => writeFile(resolve(dir, 'outcome.json'), json({ completed: false }))],
  ['missing terminal results', async (f, dir) => rm(resolve(dir, 'results.jsonl'))],
  ['empty terminal stream', async (f, dir) => writeFile(resolve(dir, 'results.jsonl'), '')],
  ['partial terminal stream', async (f, dir) => writeFile(resolve(dir, 'results.jsonl'), lines([{ id: f.inputs[0].id, backend: 'rules', finish_reason: 'stop', raw_output: '[]' }]))],
  ['duplicate terminal IDs', async (f, dir) => writeFile(resolve(dir, 'results.jsonl'), lines(f.inputs.map(() => ({ id: f.inputs[0].id, backend: 'rules', finish_reason: 'stop', raw_output: '[]' }))))],
  ['foreign backend terminal rows', async (f, dir) => writeFile(resolve(dir, 'results.jsonl'), lines(f.inputs.map(row => ({ id: row.id, backend: 'deepseek', finish_reason: 'stop', raw_output: '[]' }))))],
  ['non-stop terminal result', async (f, dir) => writeFile(resolve(dir, 'results.jsonl'), lines(f.inputs.map(row => ({ id: row.id, backend: 'rules', finish_reason: 'length', raw_output: '[]' }))))],
  ['truncated JSONL tail', async (f, dir) => writeFile(resolve(dir, 'results.jsonl'), lines(f.inputs.map(row => ({ id: row.id, backend: 'rules', finish_reason: 'stop', raw_output: '[]' }))) + '{')],
]) test(`matching protocol and code hashes cannot make ${name} development-ready`, async t => {
  const f = await fixture(t); await completeDevelopment(f);
  await mutate(f, resolve(f.root, E, 'results/dev-rules-fixture'));
  await assert.rejects(validateDevelopment(f.root, f.inputs));
});

test('successful rows cannot hide a failed model process receipt', async t => {
  const f = await fixture(t); await completeDevelopment(f);
  const path = resolve(f.root, E, 'results/dev-qwen-fixture/outcome.json');
  const outcome = JSON.parse(await readFile(path)); outcome.attempts[1].code = 9;
  await writeFile(path, json(outcome));
  await assert.rejects(validateDevelopment(f.root, f.inputs));
});

test('an audited failed history does not prevent a separate complete current-code attempt from contributing readiness', async t => {
  const f = await fixture(t); await completeDevelopment(f);
  const source = resolve(f.root, E, 'results/dev-rules-fixture');
  const failed = resolve(f.root, E, 'results/dev-rules-earlier-failed');
  await cp(source, failed, { recursive: true });
  await writeFile(resolve(failed, 'outcome.json'), json({ completed: false }));
  await writeFile(resolve(failed, 'results.jsonl'), '');
  const before = sha(await readFile(resolve(failed, 'outcome.json')));
  assert.deepEqual((await validateDevelopment(f.root, f.inputs)).backends, [...BACKENDS].sort());
  assert.equal(sha(await readFile(resolve(failed, 'outcome.json'))), before);
});

const { withFrozenCode } = await import(pathToFileURL(resolve(ENGINE, E, 'verify-frozen.mjs')));
async function historicalFixture(t) {
  const root = await temporary(t, 'historical');
  for (const path of ['lib', 'scripts', 'experiments', 'docs', 'package.json']) await cp(resolve(ENGINE, path), resolve(root, path), { recursive: true });
  return root;
}

test('historical restoration replaces all four changed live v7 executables with their frozen bytes', async t => {
  const root = await historicalFixture(t), freeze = JSON.parse(await readFile(resolve(root, E, 'freeze.json')));
  const paths = ['run.mjs', 'freeze.mjs', 'verify.mjs', 'summarize.mjs'].map(name => `${E}/${name}`);
  const live = {};
  for (const path of paths) {
    live[path] = Buffer.concat([await readFile(resolve(root, path)), Buffer.from('\n// Independent live-code sentinel, never execute.\n')]);
    await writeFile(resolve(root, path), live[path]);
  }
  let temporaryRoot;
  await withFrozenCode(async temporary => {
    temporaryRoot = temporary;
    for (const path of paths) assert.equal(sha(await readFile(resolve(temporary, path))), freeze.files[path], `Live executable escaped archival restoration: ${path}`);
  }, root);
  assert.equal(await exists(temporaryRoot), false, 'Historical temporary code was not cleaned up.');
  for (const path of paths) assert.deepEqual(await readFile(resolve(root, path)), live[path], 'Historical verification changed current source.');
});

for (const mutation of ['missing', 'changed']) test(`historical restoration rejects a ${mutation} required archived executable before invoking its callback`, async t => {
  const root = await historicalFixture(t);
  const archive = await exists(resolve(root, E, 'frozen-code-v2')) ? 'frozen-code-v2' : 'frozen-code';
  const manifest = JSON.parse(await readFile(resolve(root, E, archive, 'manifest.json')));
  const key = Object.keys(manifest.files).find(path => path.endsWith('/assess.mjs'));
  assert(key);
  const path = resolve(root, E, archive, `${key}.snapshot`);
  if (mutation === 'missing') await rm(path); else await writeFile(path, 'corrupted snapshot\n');
  let invoked = false;
  await assert.rejects(withFrozenCode(() => { invoked = true; }, root));
  assert.equal(invoked, false);
});

test('historical restoration cleans temporary code after callback failure while preserving the original error', async t => {
  const root = await historicalFixture(t), sentinel = new Error('Independent callback failure');
  let temporaryRoot;
  await assert.rejects(withFrozenCode(temporary => { temporaryRoot = temporary; throw sentinel; }, root), error => error === sentinel);
  assert.equal(await exists(temporaryRoot), false);
});

const publicationPath = resolve(ENGINE, E, 'publish-artifacts.mjs');
if (await exists(publicationPath)) {
  const { publishArtifacts } = await import(pathToFileURL(publicationPath));
  const artifacts = { 'rules.report.json': { candidates: [], fixed_denominator: 43 }, 'comparison.json': { models: [] }, 'manifest.json': { files: {} } };
  test('atomic publication keeps a complete legitimate empty-candidate artifact set', async t => {
    const root = await temporary(t, 'publication'), target = resolve(root, 'corrections');
    await publishArtifacts(target, artifacts);
    assert.deepEqual((await readdir(target)).sort(), Object.keys(artifacts).sort());
    for (const [name, value] of Object.entries(artifacts)) assert.deepEqual(JSON.parse(await readFile(resolve(target, name))), value);
  });
  test('a mid-write fault preserves evidence outside the final directory and permits an exact retry', async t => {
    const root = await temporary(t, 'publication'), target = resolve(root, 'corrections');
    const failure = Object.assign(new Error('private-path-do-not-log'), { code: 'EIO' });
    let stage;
    await assert.rejects(publishArtifacts(target, artifacts, { onProgress: ({ staging }) => { stage = staging; throw failure; } }), error => error === failure);
    assert.equal(await exists(target), false);
    const receiptBytes = await readFile(resolve(stage, '.publication-failure.json'), 'utf8');
    const receipt = JSON.parse(receiptBytes);
    assert.equal(receipt.final_published, false); assert.equal(receipt.error_code, 'EIO');
    assert.equal(receipt.completed_artifacts.length, 1); assert(!receiptBytes.includes(failure.message));
    const before = sha(await readFile(resolve(stage, receipt.completed_artifacts[0])));
    await publishArtifacts(target, artifacts);
    assert.equal(sha(await readFile(resolve(stage, receipt.completed_artifacts[0]))), before);
    assert.deepEqual((await readdir(target)).sort(), Object.keys(artifacts).sort());
  });
  for (const [name, values] of [
    ['empty set', {}], ['parent traversal', { '../escape.json': {} }],
    ['undefined JSON', { 'first.json': {}, 'bad.json': undefined }],
    ['non-serializable JSON', { 'first.json': {}, 'bad.json': 1n }],
  ]) test(`invalid ${name} is rejected before creating either a final publication or a partial stage`, async t => {
    const root = await temporary(t, 'publication'), target = resolve(root, 'corrections');
    await assert.rejects(publishArtifacts(target, values));
    assert.equal(await exists(target), false);
    assert.deepEqual(await readdir(root), []);
  });
  test('a destination created while staging is preserved and the complete unpublished stage remains evidence', async t => {
    const root = await temporary(t, 'publication'), target = resolve(root, 'corrections');
    let stage;
    await assert.rejects(publishArtifacts(target, artifacts, { onProgress: async ({ staging, completed }) => {
      stage = staging;
      if (completed.length === 1) { await mkdir(target); await writeFile(resolve(target, 'external-history'), 'preserve\n'); }
    } }), error => error.code === 'EEXIST');
    assert.equal(await readFile(resolve(target, 'external-history'), 'utf8'), 'preserve\n');
    assert.deepEqual(await readdir(target), ['external-history']);
    assert.equal(JSON.parse(await readFile(resolve(stage, '.publication-failure.json'))).completed_artifacts.length, 3);
  });
  for (const kind of ['empty directory', 'existing history', 'symlink']) test(`atomic publication cannot replace an ${kind}`, async t => {
    const root = await temporary(t, 'publication'), target = resolve(root, 'corrections');
    if (kind === 'symlink') { await mkdir(resolve(root, 'elsewhere')); await symlink(resolve(root, 'elsewhere'), target); }
    else { await mkdir(target); if (kind === 'existing history') await writeFile(resolve(target, 'history'), 'immutable\n'); }
    await assert.rejects(publishArtifacts(target, artifacts), error => error.code === 'EEXIST');
    if (kind === 'existing history') assert.equal(await readFile(resolve(target, 'history'), 'utf8'), 'immutable\n');
    if (kind === 'symlink') assert.equal((await lstat(target)).isSymbolicLink(), true);
  });
  test('two complete concurrent publishers cannot overwrite the winning immutable artifact set', async t => {
    const root = await temporary(t, 'publication'), target = resolve(root, 'corrections');
    let count = 0, release;
    const barrier = new Promise(resolve => { release = resolve; });
    const onProgress = async ({ completed }) => { if (completed.length === 3) { if (++count === 2) release(); await barrier; } };
    const sets = [artifacts, { ...artifacts, 'comparison.json': { models: ['other'] } }];
    const results = await Promise.allSettled(sets.map(set => publishArtifacts(target, set, { onProgress })));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const winner = results.findIndex(result => result.status === 'fulfilled');
    for (const [name, value] of Object.entries(sets[winner])) assert.deepEqual(JSON.parse(await readFile(resolve(target, name))), value);
    const failed = results.find(result => result.status === 'rejected');
    assert.equal(await exists(resolve(failed.reason.stagingDirectory, '.publication-failure.json')), true);
  });
  test('SIGKILL leaves an unpublished stage and a later publisher can complete without erasing it', async t => {
    const root = await temporary(t, 'publication'), target = resolve(root, 'corrections');
    const childPath = resolve(root, 'crash.mjs');
    await writeFile(childPath, `import {publishArtifacts} from ${JSON.stringify(pathToFileURL(publicationPath).href)};\nawait publishArtifacts(${JSON.stringify(target)}, ${JSON.stringify(artifacts)}, {onProgress:async ({staging})=>{console.log(staging);setInterval(()=>{},1000);await new Promise(()=>{});}});\n`);
    const child = spawn(process.execPath, [childPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => child.kill('SIGKILL'));
    let stdout = '';
    const stage = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Crash fixture did not reach its first write')), 5000);
      child.stdout.on('data', bytes => { stdout += bytes; if (stdout.includes('\n')) { clearTimeout(timer); resolve(stdout.trim()); } });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Crash fixture exited before interruption')); });
    });
    const stopped = new Promise(resolve => child.once('close', resolve));
    child.kill('SIGKILL'); await stopped;
    assert.equal(await exists(target), false); assert.equal(await exists(stage), true);
    const before = (await readdir(stage)).sort();
    await publishArtifacts(target, artifacts);
    assert.deepEqual((await readdir(stage)).sort(), before);
    assert.deepEqual((await readdir(target)).sort(), Object.keys(artifacts).sort());
  });
} else test('atomic publication implementation must be present', () => assert.fail('publish-artifacts.mjs is not available yet'));
