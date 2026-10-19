import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.env.MATERIAL_FACTS_V7_ENGINEERING_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const E = 'experiments/material-facts-v7';
const evidence = process.env.MATERIAL_FACTS_R44_EVIDENCE;
const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const put = async (root, path, bytes) => { const target = resolve(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes); return target; };

// Only literal module dependencies are copied. These real CLI calls read small
// synthetic reports, never the frozen corpus, scorer, historical chain or model.
async function copyModules(root) {
  const seen = new Set();
  async function copy(path) {
    if (!await exists(path) && await exists(path + '.ts')) path += '.ts';
    if (seen.has(path)) return;
    seen.add(path);
    const bytes = await readFile(path);
    const target = resolve(root, path.slice(ROOT.length + 1));
    await mkdir(dirname(target), { recursive: true }); await copyFile(path, target);
    for (const match of bytes.toString().matchAll(/(?:from\s*|import\s*\()(['"])([^'"]+)\1/gu)) {
      if (match[2].startsWith('.')) await copy(resolve(dirname(path), match[2]));
    }
  }
  await copy(resolve(ROOT, E, 'summarize.mjs'));
  await copy(resolve(ROOT, E, 'immutable-artifact-publication.mjs'));
}

async function fixture(t) {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), 'anxin-r44-summary-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await copyModules(root);
  const metrics = Object.fromEntries(['raw_basic', 'accepted_basic', 'raw_relational', 'accepted_relational', 'raw_strict', 'accepted_strict']
    .map(name => [name, { tp: 0, fp: 0, fn: 0, precision: null, recall: null, f1: null }]));
  const cases = Array.from({ length: 12 }, () => ({ production_defense: [], event_alignment: { raw: [], accepted: [] }, normalization: [], review_issues: [], attribute_errors: [], rejected: [], errors: [], coverage: null }));
  for (const backend of ['rules', 'qwen', 'deepseek']) {
    const path = `${E}/results/holdout-${backend}-1`;
    await put(root, `${path}/report.json`, JSON.stringify({ planned_documents: 12, expected_facts: 43, cases, metrics, returned: 0, completed: 0, native_json: 0, protocol_valid: 0, exact_documents: 0, raw_candidates: 0, accepted_candidates: 0, rejected_candidates: 0, review_issues: 0 }));
    await put(root, `${path}/outcome.json`, '{"attempts":[],"completed":false}\n');
    await put(root, `${path}/results.jsonl`, '');
    if (backend === 'deepseek') await put(root, `${path}/protocol.json`, '{"deepseek":{"egress":"direct"}}\n');
  }
  return { root, cli: resolve(root, E, 'summarize.mjs'), output: resolve(root, E, 'comparison.json'), lock: resolve(root, E, '.experiment.lock') };
}

async function record(label, result, f) {
  if (!evidence) return;
  await mkdir(evidence, { recursive: true });
  const data = { node: process.version, cli: f.cli, status: result.status, signal: result.signal, error: result.error?.code ?? null, stdout: result.stdout, stderr: result.stderr,
    files: (await readdir(resolve(f.root, E))).sort() };
  await writeFile(resolve(evidence, `${label}.json`), JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  if (await exists(f.output)) await writeFile(resolve(evidence, `${label}.comparison.snapshot`), await readFile(f.output), { flag: 'wx' });
  for (const name of data.files.filter(name => name.endsWith('.stage'))) {
    await writeFile(resolve(evidence, `${label}.${name}.snapshot`), await readFile(resolve(f.root, E, name)), { flag: 'wx' });
  }
}

async function invoke(label, f, args = []) {
  const result = spawnSync(process.execPath, [f.cli, ...args], { cwd: f.root, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  await record(label, result, f);
  assert.equal(result.error, undefined, 'A timeout/spawn error cannot establish publication correctness');
  assert.equal(result.signal, null, 'Signal termination cannot establish an intentional refusal');
  return result;
}

test('summary publication is complete, byte-identical to stdout, and a retry cannot replace it', async t => {
  const f = await fixture(t), first = await invoke('success-first', f);
  assert.equal(first.status, 0, first.stderr);
  const bytes = await readFile(f.output);
  assert.deepEqual(bytes, Buffer.from(JSON.stringify(JSON.parse(first.stdout), null, 2) + '\n'));
  assert.equal(JSON.parse(bytes).holdout_documents, 12);
  const retry = await invoke('success-retry', f);
  assert.equal(retry.status, 1); assert.match(retry.stderr, /EEXIST/u);
  assert.deepEqual(await readFile(f.output), bytes);
  assert.equal((await invoke('success-check', f, ['--check'])).status, 0);
  assert.equal((await readdir(resolve(f.root, E))).filter(name => name.endsWith('.stage')).length, 0);
  assert.equal(await exists(f.lock), false);
});

test('a native file-size failure retains its stage without occupying the immutable summary name; retry succeeds', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t);
  const launcher = await put(f.root, 'native-file-limit.py', 'import os,resource,signal,sys\nsignal.signal(signal.SIGXFSZ,signal.SIG_IGN)\nresource.setrlimit(resource.RLIMIT_FSIZE,(2048,2048))\nos.execv(sys.argv[1],sys.argv[1:])\n');
  const failed = spawnSync('python3', [launcher, process.execPath, f.cli], { cwd: f.root, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  await record('native-efbig-before-retry', failed, f);
  assert.equal(failed.error, undefined); assert.equal(failed.signal, null); assert.equal(failed.status, 1); assert.match(failed.stderr, /EFBIG|file too large/iu);
  const occupied = await exists(f.output);
  const stages = (await readdir(resolve(f.root, E))).filter(name => name.endsWith('.stage'));
  const stageBytes = await Promise.all(stages.map(name => readFile(resolve(f.root, E, name))));
  const retry = await invoke('native-efbig-retry', f);
  // Perform and record the retry before assertions, preserving the old failure's
  // real EEXIST outcome and partial target rather than stopping at one symptom.
  assert.equal(occupied, false, 'Failed summary bytes must not reserve comparison.json');
  assert.equal(stages.length, 1, 'A real I/O failure keeps exactly its owned diagnostic stage');
  assert(stageBytes[0].length > 0 && stageBytes[0].length <= 2048);
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal(JSON.parse(await readFile(f.output)).holdout_documents, 12);
  assert.deepEqual(await readFile(resolve(f.root, E, stages[0])), stageBytes[0], 'A successful retry cannot destroy earlier failed I/O evidence');
  assert.equal(await exists(f.lock), false);
});

test('an existing summary symlink is refused without changing the original target', async t => {
  const f = await fixture(t), victim = await put(f.root, 'existing-summary.json', 'original immutable evidence\n');
  await symlink(victim, f.output);
  const result = await invoke('symlink-refusal', f);
  assert.equal(result.status, 1); assert.match(result.stderr, /EEXIST/u);
  assert.equal((await lstat(f.output)).isSymbolicLink(), true);
  assert.equal(await readFile(victim, 'utf8'), 'original immutable evidence\n');
  assert.equal((await readdir(resolve(f.root, E))).filter(name => name.endsWith('.stage')).length, 0);
});

test('an active holdout lock still refuses summary before publication, and release permits the real CLI', async t => {
  const f = await fixture(t);
  await mkdir(f.lock, { mode: 0o700 });
  await writeFile(resolve(f.lock, 'owner.json'), '{"operation":"holdout","token":"synthetic-owned-fixture"}\n');
  const result = await invoke('holdout-refusal', f);
  assert.equal(result.status, 1); assert.match(result.stderr, /Experiment lock already exists/u);
  assert.equal(await exists(f.output), false);
  assert.equal((await readdir(resolve(f.root, E))).filter(name => name.endsWith('.stage')).length, 0);
  await rm(f.lock, { recursive: true });
  assert.equal((await invoke('holdout-released', f)).status, 0);
  assert.equal(await exists(f.lock), false);
});
