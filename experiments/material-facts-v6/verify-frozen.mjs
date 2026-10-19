// Read-only compatibility entry point for the sealed v6 experiment. Restore the
// original v3 dependency only inside an owned temporary tree; never replace the
// current product or amend a frozen hash to accept current behavior.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const EXPERIMENT = 'experiments/material-facts-v6';
const ARCHIVED_PATH = 'lib/material-facts-v3.ts';
const ARCHIVED_SHA256 = 'b1e5fbe9829cd677c98315070fd3406dfadd6305a3291dfa601a3df64874cbdd';
const SEALED = {
  'freeze.json': '0298d7644bf4def061a0d2234b78cd8aab524bf7ae9710dda80bae8f76daf28b',
  'result-manifest.json': '41882c5c653576fce3fb737028217d35476abcc3f9dd0a041ceda47ceca35913',
  'comparison.json': '645f991e82aeda79107aa1f7917f1ae12f0b18eeb1779073a8ae8b53db180d3a',
};
const COPY_PATHS = ['lib', 'scripts', 'docs', 'package.json',
  'experiments/material-facts-v4', 'experiments/material-facts-v4-replication-20261017',
  'experiments/material-facts-v5', EXPERIMENT];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function regularBytes(path) {
  assert((await lstat(path)).isFile(), 'Historical artifact must be a regular file');
  return readFile(path);
}
async function checkProductLocation(root) {
  assert((await lstat(resolve(root, 'lib'))).isDirectory(), 'Product lib must be a real directory');
  await regularBytes(resolve(root, ARCHIVED_PATH));
}
async function checkSealed(root) {
  const bytes = {};
  for (const [name, expected] of Object.entries(SEALED)) {
    bytes[name] = await regularBytes(resolve(root, EXPERIMENT, name));
    assert.equal(sha(bytes[name]), expected, `Sealed v6 artifact changed: ${name}`);
  }
  return bytes;
}
async function checkBoundFiles(root, freeze, { archived = false } = {}) {
  assert.equal(Object.keys(freeze.files).length, 36, 'Unexpected v6 frozen file set');
  for (const [path, expected] of Object.entries(freeze.files)) {
    assert(!path.startsWith('/') && path.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe frozen path');
    if (path === ARCHIVED_PATH && !archived) continue;
    assert.equal(sha(await regularBytes(resolve(root, path))), expected, `Frozen v6 dependency changed: ${path}`);
  }
}

export async function withFrozenV6Code(action, root = ROOT) {
  // cp preserves symlinks. Reject an externally linked product before copying,
  // and check the owned copy again before replacing its historical dependency.
  await checkProductLocation(root);
  const sealed = await checkSealed(root), freeze = JSON.parse(sealed['freeze.json']);
  assert.equal(freeze.files[ARCHIVED_PATH], ARCHIVED_SHA256);
  const archive = resolve(root, EXPERIMENT, 'frozen-source-v1');
  const manifest = JSON.parse(await regularBytes(resolve(archive, 'manifest.json')));
  assert.equal(manifest.schema, 'material-facts-v6-frozen-source/1');
  assert.equal(manifest.freeze_sha256, SEALED['freeze.json']);
  assert.equal(manifest.storage_suffix, '.snapshot');
  assert.deepEqual(manifest.files, { [ARCHIVED_PATH]: ARCHIVED_SHA256 }, 'Unexpected v6 archived dependency set');
  const original = await regularBytes(resolve(archive, `${ARCHIVED_PATH}.snapshot`));
  assert.equal(sha(original), ARCHIVED_SHA256, 'Archived v3 dependency changed');
  // The other 35 dependencies must still be the original bytes, not a silently
  // accepted replacement. A future change requires another explicit archive.
  await checkBoundFiles(root, freeze);
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'anxin-v6-frozen-')));
  try {
    for (const path of COPY_PATHS) {
      await mkdir(dirname(resolve(temporary, path)), { recursive: true });
      await cp(resolve(root, path), resolve(temporary, path), { recursive: true });
    }
    await checkProductLocation(temporary);
    await unlink(resolve(temporary, ARCHIVED_PATH));
    await writeFile(resolve(temporary, ARCHIVED_PATH), original, { flag: 'wx' });
    // Recheck the actual copied bytes before executing any historical code.
    await checkSealed(temporary);
    await checkBoundFiles(temporary, freeze, { archived: true });
    return await action(temporary);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function verifyFrozenV6(root = ROOT) {
  return withFrozenV6Code(temporary => {
    const run = (script, args = []) => JSON.parse(execFileSync(process.execPath,
      [resolve(temporary, EXPERIMENT, script), ...args], {
        cwd: temporary, encoding: 'utf8', maxBuffer: 16 * 1024 ** 2, timeout: 60000,
      }));
    const original = run('verify.mjs'), summary = run('summarize.mjs', ['--check']);
    assert.equal(original.status, 'PASS');
    assert.equal(summary.holdout_documents, 8);
    assert.deepEqual(Object.keys(summary.models).sort(), ['deepseek', 'qwen', 'rules']);
    return { ...original, execution: 'original_v6_verify_and_summary_in_temporary_tree',
      archived_dependency_sha256: ARCHIVED_SHA256, current_product_validation: false,
      summary_checked: true };
  }, root);
}

if (process.argv[1] && await realpath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 2, 'Historical v6 verification accepts no write or generation arguments');
    console.log(JSON.stringify(await verifyFrozenV6()));
  } catch (error) {
    console.error(JSON.stringify({ status: 'FAIL', error: error.message }));
    process.exitCode = 1;
  }
}
