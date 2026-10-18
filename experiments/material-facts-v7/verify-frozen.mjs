// Rebuild the exact first-run code in a temporary directory. Never overwrite
// current source or historical evidence to make a frozen check pass.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const EXPERIMENT = 'experiments/material-facts-v7';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
export async function withFrozenCode(action, root = ROOT) {
  const base = resolve(root, EXPERIMENT), snapshot = resolve(base, 'frozen-code');
  const freezeBytes = await readFile(resolve(base, 'freeze.json')), freeze = JSON.parse(freezeBytes);
  const manifest = await readJson(resolve(snapshot, 'manifest.json'));
  assert.equal(manifest.schema, 'material-facts-v7-frozen-code/1');
  assert.equal(manifest.storage_suffix, '.snapshot');
  assert.equal(manifest.freeze_sha256, hash(freezeBytes));
  const expected = Object.keys(freeze.files).filter(path => !path.startsWith(`${EXPERIMENT}/`) || path === `${EXPERIMENT}/assess.mjs`).sort();
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
    for (const path of ['lib', 'scripts', 'experiments', 'docs', 'package.json']) await cp(resolve(root, path), resolve(temporary, path), { recursive: true });
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
    const run = script => execFileSync(process.execPath, [resolve(temporary, EXPERIMENT, script), ...(script === 'summarize.mjs' ? ['--check'] : [])], {
      cwd: temporary, encoding: 'utf8', maxBuffer: 16 * 1024 ** 2, timeout: 60000,
    });
    const original = JSON.parse(run('verify.mjs'));
    const summary = JSON.parse(run('summarize.mjs'));
    assert.equal(original.status, 'PASS'); assert.equal(summary.holdout_documents, 12);
    return { ...original, execution: 'exact_archived_first_run_code_in_temporary_directory', current_code_claim: false };
  });
  console.log(JSON.stringify(receipt));
}
