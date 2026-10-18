import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withFrozenCode } from '../experiments/material-facts-v7/verify-frozen.mjs';

// Only owned temporary fixtures are changed. No model, network, build, or
// generation command is used. The optional root supplies read-only evidence
// when this script and its implementation are prepared in an isolated tree.
const IMPLEMENTATION_ROOT = fileURLToPath(new URL('../', import.meta.url));
const ROOT = resolve(process.env.MATERIAL_FACT_TEST_ROOT || IMPLEMENTATION_ROOT);
const EXPERIMENT = 'experiments/material-facts-v7';
const ARCHIVE = `${EXPERIMENT}/frozen-code-v2`;
const OMITTED = ['run.mjs', 'freeze.mjs', 'verify.mjs', 'summarize.mjs'].map(name => `${EXPERIMENT}/${name}`);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const hashes = async (root, paths) => Object.fromEntries(await Promise.all(paths.map(async path => [path, sha(await readFile(resolve(root, path)))])));

async function replaced(path, replacement, action) {
  assert.ok((await lstat(path)).isFile(), 'only change a regular fixture file');
  const original = await readFile(path);
  try { await writeFile(path, replacement); return await action(); }
  finally { await writeFile(path, original); }
}

async function replacedMany(paths, replacement, action) {
  if (!paths.length) return action();
  return replaced(paths[0], replacement, () => replacedMany(paths.slice(1), replacement, action));
}

function runHistorical(root) {
  return JSON.parse(execFileSync(process.execPath, [resolve(root, EXPERIMENT, 'verify-frozen.mjs')], {
    cwd: root, encoding: 'utf8', stdio: 'pipe', timeout: 60000, maxBuffer: 16 * 1024 ** 2,
  }));
}

test('complete first-run archive restores every bound executable and rejects archive corruption', { timeout: 120000 }, async t => {
  const freeze = await readJson(resolve(ROOT, EXPERIMENT, 'freeze.json'));
  const resultManifest = await readJson(resolve(ROOT, EXPERIMENT, 'result-manifest.json'));
  const oldManifest = await readJson(resolve(ROOT, EXPERIMENT, 'frozen-code/manifest.json'));
  const protectedPaths = [...new Set([
    ...Object.keys(freeze.files),
    ...Object.keys(resultManifest.files).map(path => `${EXPERIMENT}/${path}`),
    `${EXPERIMENT}/freeze.json`, `${EXPERIMENT}/result-manifest.json`,
    `${EXPERIMENT}/frozen-code/manifest.json`,
    ...Object.keys(oldManifest.files).map(path => `${EXPERIMENT}/frozen-code/${path}.snapshot`),
  ])];
  const originalHashes = await hashes(ROOT, protectedPaths);
  const fixture = await mkdtemp(resolve(tmpdir(), 'anxin-v7-full-archive-test-'));
  const archiveRoot = resolve(fixture, ARCHIVE);
  const manifestPath = resolve(archiveRoot, 'manifest.json');
  try {
    for (const path of ['lib', 'scripts', 'experiments', 'docs', 'package.json'])
      await cp(resolve(ROOT, path), resolve(fixture, path), { recursive: true });
    await cp(resolve(IMPLEMENTATION_ROOT, EXPERIMENT, 'verify-frozen.mjs'), resolve(fixture, EXPERIMENT, 'verify-frozen.mjs'));
    await cp(resolve(IMPLEMENTATION_ROOT, ARCHIVE), archiveRoot, { recursive: true });
    const manifest = await readJson(manifestPath);
    // Give the pre-fix wrapper a fair baseline, even if current development has
    // already changed these scripts. Later subtests deliberately replace them.
    for (const path of OMITTED)
      await writeFile(resolve(fixture, path), await readFile(resolve(archiveRoot, `${path}.snapshot`)));

    await t.test('all 36 selected paths and bytes match the original freeze', async () => {
      const expected = Object.keys(freeze.files).filter(path => !path.startsWith(`${EXPERIMENT}/`) || path.endsWith('.mjs')).sort();
      assert.equal(expected.length, 36);
      assert.deepEqual(Object.keys(manifest.files).sort(), expected);
      assert.equal(manifest.freeze_sha256, sha(await readFile(resolve(fixture, EXPERIMENT, 'freeze.json'))));
      assert.equal(Object.keys(oldManifest.files).length, 32);
      for (const path of expected) {
        assert.equal(manifest.files[path], freeze.files[path], path);
        assert.equal(sha(await readFile(resolve(archiveRoot, `${path}.snapshot`))), freeze.files[path], path);
      }
    });

    await replacedMany(OMITTED.map(path => resolve(fixture, path)), Buffer.from('throw new Error("synthetic current v7 script must never execute during historical verification");\n'), async () => {
      await t.test('changed live run/freeze/verify/summarize restore to their original bytes', async () => {
        await withFrozenCode(async temporary => {
          for (const path of OMITTED)
            assert.equal(sha(await readFile(resolve(temporary, path))), freeze.files[path], `Current script leaked into historical reconstruction: ${path}`);
        }, fixture);
      });
      await t.test('the real historical verifier still checks all 60 original result artifacts', () => {
        const receipt = runHistorical(fixture);
        assert.equal(receipt.status, 'PASS');
        assert.equal(receipt.result_files, 60);
        assert.equal(receipt.result_manifest_sha256, '3733e4c6939184fbe79b56e4a4bdc2db35f4e6f99a20fc91c48bd24913ce53ee');
        assert.equal(receipt.current_code_claim, false);
        assert.equal(receipt.inference, false);
        assert.equal(receipt.training, false);
        t.diagnostic(`historical receipt: ${JSON.stringify(receipt)}`);
      });
    });

    const rejectBeforeCallback = async pattern => {
      let entered = false;
      await assert.rejects(withFrozenCode(() => { entered = true; }, fixture), pattern);
      assert.equal(entered, false, 'invalid code archive must fail before callback execution');
    };
    for (const path of OMITTED) {
      const snapshotPath = resolve(archiveRoot, `${path}.snapshot`);
      await t.test(`missing archived ${path.split('/').at(-1)} is rejected`, async () => {
        const bytes = await readFile(snapshotPath);
        await rm(snapshotPath);
        try { await rejectBeforeCallback({ code: 'ENOENT' }); }
        finally { await writeFile(snapshotPath, bytes); }
      });
      await t.test(`changed archived ${path.split('/').at(-1)} is rejected`, async () => {
        const bytes = await readFile(snapshotPath);
        await replaced(snapshotPath, Buffer.concat([bytes, Buffer.from('\n// synthetic archived-code corruption\n')]),
          () => rejectBeforeCallback(new RegExp(`Archived code changed: ${path.replaceAll('.', '\\.')}`, 'u')));
      });
    }
    await t.test('a required executable omitted from the new manifest is rejected', async () => {
      const changed = structuredClone(manifest);
      delete changed.files[OMITTED[0]];
      await replaced(manifestPath, jsonBytes(changed), () => rejectBeforeCallback(/Historical code snapshot omits or adds frozen paths/u));
    });
    await t.test('an unregistered executable added to the new manifest is rejected', async () => {
      const changed = structuredClone(manifest);
      changed.files[`${EXPERIMENT}/synthetic-unfrozen.mjs`] = '0'.repeat(64);
      await replaced(manifestPath, jsonBytes(changed), () => rejectBeforeCallback(/Historical code snapshot omits or adds frozen paths/u));
    });
    await t.test('changed original result bytes are rejected by the archived historical verifier', async () => {
      const resultPath = resolve(fixture, EXPERIMENT, 'results/holdout-rules-1/results.jsonl');
      await replaced(resultPath, Buffer.concat([await readFile(resultPath), Buffer.from('\n')]), async () => {
        assert.throws(() => runHistorical(fixture), error => {
          assert.notEqual(error.status, 0);
          assert.match(String(error.stderr), /Result manifest differs or omits artifacts/u);
          return true;
        });
      });
    });
    await t.test('a throwing callback removes the temporary reconstruction', async () => {
      let temporary;
      const sentinel = new Error('synthetic-full-archive-callback-failure');
      await assert.rejects(withFrozenCode(async directory => {
        temporary = directory;
        assert.notEqual(resolve(directory), resolve(ROOT));
        assert.notEqual(resolve(directory), resolve(fixture));
        for (const path of OMITTED)
          assert.equal(sha(await readFile(resolve(directory, path))), freeze.files[path], path);
        await writeFile(resolve(directory, 'synthetic-owned-cleanup-marker'), 'temporary\n');
        throw sentinel;
      }, fixture), error => error === sentinel);
      assert.ok(temporary);
      await assert.rejects(stat(temporary), { code: 'ENOENT' });
    });
  } finally {
    await rm(fixture, { recursive: true, force: true });
    assert.deepEqual(await hashes(ROOT, protectedPaths), originalHashes, 'source freeze, raw results, old archive, and bound evidence must remain unchanged');
  }
});
