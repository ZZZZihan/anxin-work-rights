import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.MATERIAL_FACT_SUMMARY_PUBLICATION_ROOT ?? fileURLToPath(new URL('../', import.meta.url)));
const E = 'experiments/material-facts-v7';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(done => setTimeout(done, ms));
const metrics = Object.fromEntries(['raw_basic', 'accepted_basic', 'raw_relational', 'accepted_relational', 'raw_strict', 'accepted_strict']
  .map(name => [name, { tp: 0, fp: 0, fn: 43, precision: 0, recall: 0, f1: 0 }]));
const preloadSource = `
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
process.on('SIGXFSZ', () => {});
const nativeLink = fs.link, nativeOpen = fs.open, nativeUnlink = fs.unlink;
const scenario = process.env.SUMMARY_PUBLICATION_SCENARIO;
fs.link = async (stage, target) => {
  if (target.endsWith('/comparison.json') && ['inspect-link', 'barrier'].includes(scenario)) {
    let absent = false;
    try { await fs.lstat(target); } catch (error) { if (error.code !== 'ENOENT') throw error; absent = true; }
    const report = JSON.parse(await fs.readFile(stage, 'utf8'));
    const owner = JSON.parse(await fs.readFile(join(dirname(target), '.experiment.lock/owner.json'), 'utf8'));
    await fs.writeFile(process.env.SUMMARY_PUBLICATION_OBSERVATION, JSON.stringify({ absent, report, owner }));
    if (scenario === 'barrier') {
      await fs.writeFile(process.env.SUMMARY_PUBLICATION_READY, 'complete-before-link', { flag: 'wx' });
      const until = Date.now() + 7000;
      for (;;) {
        try { await fs.lstat(process.env.SUMMARY_PUBLICATION_RELEASE); break; }
        catch (error) { if (error.code !== 'ENOENT' || Date.now() >= until) throw error; }
        await new Promise(done => setTimeout(done, 5));
      }
    }
  }
  return nativeLink(stage, target);
};
if (scenario === 'sync-failure') fs.open = async (...args) => {
  const handle = await nativeOpen(...args);
  if (!String(args[0]).includes('/.comparison.json.') || !String(args[0]).endsWith('.stage')) return handle;
  return {
    writeFile: bytes => handle.writeFile(bytes),
    sync: async () => { throw Object.assign(new Error('injected comparison sync failure'), { code: 'EIO' }); },
    close: () => handle.close(),
  };
};
if (scenario === 'unlink-failure') fs.unlink = async path => {
  if (String(path).includes('/.comparison.json.') && String(path).endsWith('.stage'))
    throw Object.assign(new Error('injected comparison cleanup failure'), { code: 'EACCES' });
  return nativeUnlink(path);
};
syncBuiltinESMExports();
`;

async function fixture(t) {
  const retained = process.env.MATERIAL_FACT_SUMMARY_RETAIN_ROOT;
  if (retained) await fs.mkdir(retained, { recursive: true });
  const directory = await fs.mkdtemp(join(retained ?? tmpdir(), 'anxin-summary-publication-'));
  const experiment = join(directory, E), control = join(directory, 'external-control'), children = [];
  await fs.mkdir(experiment, { recursive: true }); await fs.mkdir(control);
  const sources = [`${E}/summarize.mjs`, `${E}/freeze.mjs`, `${E}/experiment-lock.mjs`, `${E}/immutable-artifact-publication.mjs`, 'experiments/material-facts-v6/freeze.mjs'];
  for (const path of sources) {
    await fs.mkdir(join(directory, path, '..'), { recursive: true });
    await fs.copyFile(resolve(ROOT, path), join(directory, path));
  }
  // Synthetic aggregate receipts only. Use the real summary implementation and
  // lock; never run the scorer, historical CLI, models or frozen experiment data.
  for (const backend of ['rules', 'qwen', 'deepseek']) {
    const target = join(experiment, `results/holdout-${backend}-1`);
    await fs.mkdir(target, { recursive: true });
    const cases = Array.from({ length: 12 }, (_, i) => ({ id: `synthetic-${i + 1}`, production_defense: [], event_alignment: { raw: [], accepted: [] },
      coverage: { status: 'synthetic' }, normalization: [], review_issues: [], attribute_errors: [], rejected: [], errors: [] }));
    const report = { planned_documents: 12, expected_facts: 43, cases, metrics, returned: 12, completed: 12,
      native_json: 12, protocol_valid: 12, exact_documents: 0, raw_candidates: 0, accepted_candidates: 0, rejected_candidates: 0, review_issues: 0 };
    await fs.writeFile(join(target, 'report.json'), JSON.stringify(report));
    await fs.writeFile(join(target, 'outcome.json'), JSON.stringify({ completed: true, attempts: [{ seconds: 1 }] }));
    await fs.writeFile(join(target, 'results.jsonl'), cases.map(row => JSON.stringify({ id: row.id, finish_reason: 'stop', latency_seconds: 0 })).join('\n') + '\n');
    if (backend === 'deepseek') await fs.writeFile(join(target, 'protocol.json'), JSON.stringify({ deepseek: { egress: 'direct' } }));
  }
  const preload = join(control, 'preload.mjs'); await fs.writeFile(preload, preloadSource);
  const { buildSummary } = await import(pathToFileURL(join(experiment, 'summarize.mjs')).href);
  const expected = JSON.stringify(await buildSummary(directory), null, 2) + '\n';
  assert(Buffer.byteLength(expected) > 512, 'Native file-size fault must reach comparison publication');
  const file = { directory, experiment, control, preload, children, expected,
    output: join(experiment, 'comparison.json'), cli: join(experiment, 'summarize.mjs'),
    observation: join(control, 'link-observation.json'), ready: join(control, 'ready'), release: join(control, 'release') };
  t.after(async () => {
    for (const item of children) {
      if (item.child.exitCode === null && item.child.signalCode === null) item.child.kill('SIGKILL');
      await item.completion;
    }
    if (!retained) await fs.rm(directory, { recursive: true, force: true });
  });
  if (retained) t.diagnostic(JSON.stringify({ retained_fixture: directory }));
  return file;
}

function launch(file, { bounded = false, scenario = 'plain', args = [] } = {}) {
  const nodeArgs = ['--import', pathToFileURL(file.preload).href, file.cli, ...args];
  const command = bounded ? 'python3' : process.execPath;
  const argv = bounded ? ['-c', 'import os,resource,sys; resource.setrlimit(resource.RLIMIT_FSIZE,(512,512)); os.execv(sys.argv[1],sys.argv[1:])', process.execPath, ...nodeArgs] : nodeArgs;
  const child = spawn(command, argv, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
    SUMMARY_PUBLICATION_SCENARIO: scenario, SUMMARY_PUBLICATION_OBSERVATION: file.observation,
    SUMMARY_PUBLICATION_READY: file.ready, SUMMARY_PUBLICATION_RELEASE: file.release } });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', value => { stdout += value; });
  child.stderr.setEncoding('utf8').on('data', value => { stderr += value; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 12000);
  const completion = new Promise((done, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => done({ code, signal, stdout, stderr }));
  }).finally(() => clearTimeout(timer));
  completion.catch(() => {});
  const item = { child, completion }; file.children.push(item); return item;
}
const execute = (file, options) => launch(file, options).completion;
async function absent(path) {
  try { await fs.lstat(path); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; }
}
async function stages(file) {
  return Promise.all((await fs.readdir(file.experiment)).filter(name => name.startsWith('.comparison.json.') && name.endsWith('.stage')).sort()
    .map(async name => ({ name, bytes: await fs.readFile(join(file.experiment, name)) })));
}
async function inventory(file) {
  return Promise.all((await fs.readdir(file.experiment)).sort().map(async name => {
    const path = join(file.experiment, name), stat = await fs.lstat(path);
    return { name, type: stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'file',
      content: stat.isSymbolicLink() ? await fs.readlink(path) : stat.isFile() ? hash(await fs.readFile(path)) : null };
  }));
}
async function unlocked(file) { assert.equal(await absent(join(file.experiment, '.experiment.lock')), true, 'Summary lock must release on success and handled failure'); }

test('real summary CLI publishes exactly the existing descriptive bytes and stdout', async t => {
  const file = await fixture(t), result = await execute(file);
  assert.equal(result.code, 0, result.stderr); assert.equal(result.signal, null);
  assert.equal(await fs.readFile(file.output, 'utf8'), file.expected); assert.equal(result.stdout, file.expected);
  assert.deepEqual(await stages(file), []); await unlocked(file);
});

test('summary --check remains read-only and rejects changed comparison bytes', async t => {
  const file = await fixture(t); await fs.writeFile(file.output, file.expected);
  const before = await inventory(file), result = await execute(file, { args: ['--check'] });
  assert.equal(result.code, 0, result.stderr); assert.equal(result.stdout, file.expected); assert.deepEqual(await inventory(file), before);
  await fs.writeFile(file.output, '{}\n');
  const rejected = await execute(file, { args: ['--check'] }); assert.equal(rejected.code, 1); assert.match(rejected.stderr, /Comparison changed/u);
  assert.equal(await fs.readFile(file.output, 'utf8'), '{}\n'); assert.deepEqual(await stages(file), []); await unlocked(file);
});

for (const kind of ['file', 'directory', 'symlink', 'dangling-symlink']) test(`an existing ${kind} is refused without any experiment-directory change`, async t => {
  const file = await fixture(t), victim = join(file.control, 'original.json'), original = 'immutable external bytes\n';
  if (kind === 'file') await fs.writeFile(file.output, original);
  if (kind === 'directory') await fs.mkdir(file.output);
  if (kind === 'symlink') { await fs.writeFile(victim, original); await fs.symlink(victim, file.output); }
  if (kind === 'dangling-symlink') await fs.symlink(victim, file.output);
  const before = await inventory(file), result = await execute(file);
  assert.equal(result.code, 1); assert.match(result.stderr, /EEXIST/u); assert.equal(result.stdout, '');
  assert.deepEqual(await inventory(file), before);
  if (kind === 'symlink') assert.equal(await fs.readFile(victim, 'utf8'), original);
  await unlocked(file);
});

test('native partial summary write retains diagnostic stage but no final name and permits clean retry', { skip: process.platform === 'win32' }, async t => {
  const file = await fixture(t), failed = await execute(file, { bounded: true }), partial = await stages(file);
  const finalAbsent = await absent(file.output);
  t.diagnostic(JSON.stringify({ exit: failed.code, final_absent: finalAbsent, partial_stage_bytes: partial.map(row => row.bytes.length), native_efbig: /EFBIG/u.test(failed.stderr) }));
  assert.equal(failed.code, 1); assert.equal(failed.signal, null); assert.match(failed.stderr, /EFBIG/u);
  assert.equal(finalAbsent, true); assert.equal(partial.length, 1); assert.equal(partial[0].bytes.length, 512);
  assert.throws(() => JSON.parse(partial[0].bytes.toString())); await unlocked(file);
  const retry = await execute(file); assert.equal(retry.code, 0, retry.stderr);
  assert.equal(await fs.readFile(file.output, 'utf8'), file.expected); assert.deepEqual(await stages(file), partial); await unlocked(file);
});

test('summary links complete JSON only while final name is absent and the summary lock is owned', async t => {
  const file = await fixture(t), result = await execute(file, { scenario: 'inspect-link' });
  assert.equal(result.code, 0, result.stderr);
  const seen = JSON.parse(await fs.readFile(file.observation, 'utf8'));
  assert.equal(seen.absent, true); assert.deepEqual(seen.report, JSON.parse(file.expected)); assert.equal(seen.owner.operation, 'summary');
  assert.equal(await fs.readFile(file.output, 'utf8'), file.expected); await unlocked(file);
});

test('sync failure keeps the complete stage and original error while retry remains possible', async t => {
  const file = await fixture(t), failed = await execute(file, { scenario: 'sync-failure' });
  assert.equal(failed.code, 1); assert.match(failed.stderr, /injected comparison sync failure/u); assert.equal(await absent(file.output), true);
  const retained = await stages(file); assert.equal(retained.length, 1); assert.equal(retained[0].bytes.toString(), file.expected); await unlocked(file);
  const retry = await execute(file); assert.equal(retry.code, 0, retry.stderr);
  assert.deepEqual(await stages(file), retained); assert.equal(await fs.readFile(file.output, 'utf8'), file.expected);
});

test('shared lock spans publication so a colliding real summary CLI cannot publish or alter the winner', async t => {
  const file = await fixture(t), first = launch(file, { scenario: 'barrier' });
  const deadline = Date.now() + 8000;
  while (await absent(file.ready)) {
    if (first.child.exitCode !== null || first.child.signalCode !== null) assert.fail(`First CLI did not reach native link: ${JSON.stringify(await first.completion)}`);
    assert(Date.now() < deadline, 'Native-link barrier must be reached'); await pause(5);
  }
  assert.equal(await absent(file.output), true); assert.equal((await stages(file)).length, 1);
  const collision = await execute(file); assert.equal(collision.code, 1); assert.match(collision.stderr, /Experiment lock already exists/u);
  assert.equal(await absent(file.output), true); assert.equal((await stages(file)).length, 1);
  await fs.writeFile(file.release, 'release', { flag: 'wx' }); const winner = await first.completion;
  assert.equal(winner.code, 0, winner.stderr); assert.equal(await fs.readFile(file.output, 'utf8'), file.expected);
  const before = await inventory(file), repeat = await execute(file); assert.equal(repeat.code, 1); assert.match(repeat.stderr, /EEXIST/u);
  assert.deepEqual(await inventory(file), before); await unlocked(file);
});

test('published summary remains successful when stage cleanup fails and reports an explicit warning', async t => {
  const file = await fixture(t), result = await execute(file, { scenario: 'unlink-failure' });
  assert.equal(result.code, 0, result.stderr); assert.equal(result.stdout, file.expected); assert.equal(await fs.readFile(file.output, 'utf8'), file.expected);
  const warning = JSON.parse(result.stderr.trim()); assert.equal(warning.publication.published, true); assert.equal(warning.publication.temporary_removed, false);
  assert.equal(warning.publication.cleanup_error_code, 'EACCES'); assert.equal((await stages(file)).length, 1); await unlocked(file);
  const before = await inventory(file), repeat = await execute(file); assert.equal(repeat.code, 1); assert.match(repeat.stderr, /EEXIST/u);
  assert.deepEqual(await inventory(file), before);
});
