import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = process.env.V6_REVIEW_ROOT ?? fileURLToPath(new URL('../', import.meta.url));
const MODULE = process.env.V6_FROZEN_MODULE ?? resolve(ROOT, 'experiments/material-facts-v6/verify-frozen.mjs');
const { withFrozenV6Code, verifyFrozenV6 } = await import(pathToFileURL(MODULE).href);
const EXPERIMENT = 'experiments/material-facts-v6';
const ARCHIVE = `${EXPERIMENT}/frozen-source-v1`;
const V3 = 'lib/material-facts-v3.ts';
const OLD_V3_SHA = 'b1e5fbe9829cd677c98315070fd3406dfadd6305a3291dfa601a3df64874cbdd';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sandbox = await mkdtemp(join(tmpdir(), 'anxin-v6-compatibility-test-'));
after(() => rm(sandbox, { recursive: true, force: true }));
const base = resolve(sandbox, 'base');
for (const path of ['lib', 'scripts', 'docs', 'package.json', 'experiments/material-facts-v4',
  'experiments/material-facts-v4-replication-20261017', 'experiments/material-facts-v5', EXPERIMENT]) {
  await mkdir(dirname(resolve(base, path)), { recursive: true });
  await cp(resolve(ROOT, path), resolve(base, path), { recursive: true });
}
await cp(resolve(dirname(MODULE), 'frozen-source-v1'), resolve(base, ARCHIVE), { recursive: true });
await cp(MODULE, resolve(base, EXPERIMENT, 'verify-frozen.mjs'));
const originalFreeze = await readFile(resolve(base, EXPERIMENT, 'freeze.json'));
const originalManifest = await readFile(resolve(base, EXPERIMENT, 'result-manifest.json'));
const originalCurrentV3 = await readFile(resolve(base, V3));
let nextFixture = 0;
async function fixture(action) {
  const root = resolve(sandbox, `fixture-${++nextFixture}`);
  await cp(base, root, { recursive: true });
  try { return await action(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}
async function refuses(root, pattern) {
  let entered = false;
  await assert.rejects(withFrozenV6Code(() => { entered = true; }, root), pattern);
  assert.equal(entered, false, 'A rejected archive must not reach historical execution');
}

test('original verify and summary check pass with archived v3 while source product and sealed evidence stay unchanged', { timeout: 120000 }, async () => {
  const before = new Map();
  const freeze = JSON.parse(originalFreeze);
  for (const path of [...Object.keys(freeze.files), `${EXPERIMENT}/freeze.json`, `${EXPERIMENT}/result-manifest.json`, `${EXPERIMENT}/comparison.json`]) {
    before.set(path, sha(await readFile(resolve(base, path))));
  }
  const receipt = await verifyFrozenV6(base);
  assert.equal(receipt.status, 'PASS'); assert.equal(receipt.summary_checked, true);
  assert.equal(receipt.inference, false); assert.equal(receipt.training, false);
  assert.equal(receipt.current_product_validation, false);
  assert.equal(receipt.archived_dependency_sha256, OLD_V3_SHA);
  for (const [path, expected] of before) assert.equal(sha(await readFile(resolve(base, path))), expected, path);
  assert.deepEqual(await readFile(resolve(base, V3)), originalCurrentV3);
});

test('restores all 36 bound files before callback and removes the owned tree after callback failure', async () => {
  let temporary;
  const marker = new Error('intentional callback failure');
  await assert.rejects(withFrozenV6Code(async root => {
    temporary = root;
    for (const [path, expected] of Object.entries(JSON.parse(originalFreeze).files)) {
      assert.equal(sha(await readFile(resolve(root, path))), expected, path);
    }
    assert.equal(sha(await readFile(resolve(root, V3))), OLD_V3_SHA);
    throw marker;
  }, base), error => error === marker);
  assert(temporary);
  await assert.rejects(lstat(temporary), { code: 'ENOENT' });
});

test('tampered archived v3 is rejected before any historical callback', async () => fixture(async root => {
  await writeFile(resolve(root, ARCHIVE, `${V3}.snapshot`), '// changed archive\n');
  await refuses(root, /Archived v3 dependency changed/u);
}));

test('missing archived v3 is rejected rather than falling back to current product', async () => fixture(async root => {
  await rm(resolve(root, ARCHIVE, `${V3}.snapshot`));
  await refuses(root, /ENOENT/u);
}));

test('unexpected archive path set is rejected', async () => fixture(async root => {
  const path = resolve(root, ARCHIVE, 'manifest.json'), manifest = JSON.parse(await readFile(path));
  manifest.files['lib/material-facts-v2.ts'] = '0'.repeat(64);
  await writeFile(path, JSON.stringify(manifest));
  await refuses(root, /Unexpected v6 archived dependency set/u);
}));

test('semantically identical reserialized freeze and result manifest bytes are both rejected', async () => {
  for (const name of ['freeze.json', 'result-manifest.json']) await fixture(async root => {
    const path = resolve(root, EXPERIMENT, name), bytes = await readFile(path);
    await writeFile(path, JSON.stringify(JSON.parse(bytes)));
    await refuses(root, /Sealed v6 artifact changed/u);
  });
});

test('unarchived frozen dependency drift is rejected rather than hidden by restoration', async () => fixture(async root => {
  await writeFile(resolve(root, 'lib/material-facts-v2.ts'), '// changed current frozen dependency\n');
  await refuses(root, /Frozen v6 dependency changed: lib\/material-facts-v2\.ts/u);
}));

test('current v3 symlink is rejected and its external target remains unchanged', async () => fixture(async root => {
  const target = resolve(sandbox, 'external-current-v3.ts.snapshot');
  await writeFile(target, originalCurrentV3, { flag: 'wx' });
  await rm(resolve(root, V3));
  await symlink(target, resolve(root, V3));
  await refuses(root, /Historical artifact must be a regular file/u);
  assert.deepEqual(await readFile(target), originalCurrentV3);
}));

test('symlinked product directory is rejected before copying or replacing any dependency', async () => fixture(async root => {
  const target = resolve(sandbox, 'external-lib');
  await cp(resolve(root, 'lib'), target, { recursive: true });
  const before = await readFile(resolve(target, 'material-facts-v3.ts'));
  await rm(resolve(root, 'lib'), { recursive: true });
  await symlink(target, resolve(root, 'lib'));
  await refuses(root, /Product lib must be a real directory/u);
  assert.deepEqual(await readFile(resolve(target, 'material-facts-v3.ts')), before);
}));

test('historical CLI rejects write options without creating a new manifest', async () => {
  assert.throws(() => execFileSync(process.execPath,
    [resolve(base, EXPERIMENT, 'verify-frozen.mjs'), '--write-manifest'], {
      encoding: 'utf8', timeout: 5000, stdio: 'pipe',
    }), error => error.status === 1 && /accepts no write or generation arguments/u.test(error.stderr));
  assert.deepEqual(await readFile(resolve(base, EXPERIMENT, 'freeze.json')), originalFreeze);
  assert.deepEqual(await readFile(resolve(base, EXPERIMENT, 'result-manifest.json')), originalManifest);
});
