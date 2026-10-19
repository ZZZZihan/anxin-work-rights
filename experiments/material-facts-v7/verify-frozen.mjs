// Rebuild the exact first-run code in a temporary directory. Never overwrite
// current source or historical evidence to make a frozen check pass.
import assert from 'node:assert/strict';
import { runHistoricalCheckSync } from './historical-execution-v1.mjs';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const EXPERIMENT = 'experiments/material-facts-v7';
const FIRST_RUN_FREEZE_SHA256 = '0caa5b58d498a9c3ea57fc3f807118cd1faa0169a80e41b9935eacf3853ccab2';
const FIRST_RUN_RESULT_MANIFEST_SHA256 = '3733e4c6939184fbe79b56e4a4bdc2db35f4e6f99a20fc91c48bd24913ce53ee';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
export async function withFrozenCode(action, root = ROOT) {
  const base = resolve(root, EXPERIMENT), snapshot = resolve(base, 'frozen-code-v2');
  const freezeBytes = await readFile(resolve(base, 'freeze.json')), freeze = JSON.parse(freezeBytes);
  assert.equal(hash(freezeBytes), FIRST_RUN_FREEZE_SHA256, 'Original first-run freeze changed');
  assert.equal(hash(await readFile(resolve(base, 'result-manifest.json'))), FIRST_RUN_RESULT_MANIFEST_SHA256, 'Original first-run result manifest changed');
  const manifest = await readJson(resolve(snapshot, 'manifest.json'));
  assert.equal(manifest.schema, 'material-facts-v7-frozen-code/2');
  assert.equal(manifest.storage_suffix, '.snapshot');
  assert.equal(manifest.freeze_sha256, hash(freezeBytes));
  // Select from the original immutable freeze, without importing current
  // run/freeze/verify/summarize code. All five bound v7 executables are restored.
  const expected = Object.keys(freeze.files).filter(path => !path.startsWith(`${EXPERIMENT}/`) || path.endsWith('.mjs')).sort();
  assert.deepEqual(Object.keys(manifest.files).sort(), expected, 'Historical code snapshot omits or adds frozen paths');
  const archived = [];
  for (const path of expected) {
    assert(!path.startsWith('/') && path.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe snapshot path');
    const bytes = await readFile(resolve(snapshot, `${path}.snapshot`));
    assert.equal(hash(bytes), freeze.files[path], `Archived code changed: ${path}`);
    assert.equal(manifest.files[path], freeze.files[path]);
    archived.push([path, bytes]);
  }
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'anxin-v7-frozen-')));
  try {
    // Diagnostic audit attachments are never execution inputs. Keep every frozen
    // result, code snapshot, data file and review-evidence file in the copy.
    // Exclude only this exact subtree, including before archived wrappers recurse.
    for (const path of ['lib', 'scripts', 'experiments', 'docs', 'package.json']) await cp(resolve(root, path), resolve(temporary, path), {
      recursive: true, filter: source => resolve(source) !== resolve(root, EXPERIMENT, 'postfreeze-evidence'),
    });
    // Verify the bytes actually supplied to the historical verifier as well as
    // the source artifact. JSON equivalence does not preserve sealed evidence.
    assert.equal(hash(await readFile(resolve(temporary, EXPERIMENT, 'result-manifest.json'))), FIRST_RUN_RESULT_MANIFEST_SHA256, 'Original first-run result manifest changed');
    for (const [path, bytes] of archived) {
      const target = resolve(temporary, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
    return await action(temporary);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && await realpath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 2, 'Historical verification accepts no write or generation options');
  const receipt = await withFrozenCode(temporary => {
    const run = script => runHistoricalCheckSync(resolve(temporary, EXPERIMENT, script), script === 'summarize.mjs' ? ['--check'] : [], {
      cwd: temporary, encoding: 'utf8', maxBuffer: 16 * 1024 ** 2, timeout: 60000,
    });
    const original = JSON.parse(run('verify.mjs'));
    const summary = JSON.parse(run('summarize.mjs'));
    assert.equal(original.status, 'PASS'); assert.equal(summary.holdout_documents, 12);
    return { ...original, execution: 'exact_archived_first_run_code_in_temporary_directory', current_code_claim: false };
  });
  console.log(JSON.stringify(receipt));
}
