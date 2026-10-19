import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { runHistoricalCheckSync } from '../experiments/material-facts-v7/historical-execution-v1.mjs';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withCorrectionV1Code } from '../experiments/material-facts-v7/verify-correction-v1.mjs';

// Only an owned temporary copy is mutated. These tests perform no model call,
// build, service startup, original correction write, or historical evidence edit.
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const EXPERIMENT = 'experiments/material-facts-v7';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
async function replaced(path, bytes, action) {
  assert.ok((await lstat(path)).isFile());
  const original = await readFile(path);
  try { await writeFile(path, bytes); return await action(); }
  finally { await writeFile(path, original); }
}
const run = (fixture, path, args = []) => args.includes('--write')
  ? execFileSync(process.execPath, [resolve(fixture, path), ...args],
    { cwd: fixture, encoding: 'utf8', stdio: 'pipe', timeout: 960000, maxBuffer: 16 * 1024 ** 2 })
  : runHistoricalCheckSync(resolve(fixture, path), args,
    { cwd: fixture, encoding: 'utf8', stdio: 'pipe', timeout: 60000, maxBuffer: 16 * 1024 ** 2 });

test('independent correction-v2 gates preserve correction-v1 evidence and cleanup', { timeout: 960000 }, async t => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'anxin-v7-v2-independent-'));
  const base = resolve(fixture, EXPERIMENT);
  const mainManifest = resolve(ROOT, EXPERIMENT, 'corrections/manifest.json');
  const originalResult = resolve(ROOT, EXPERIMENT, 'results/holdout-rules-1/results.jsonl');
  const historicalHashes = [sha(await readFile(mainManifest)), sha(await readFile(originalResult))];
  try {
    for (const path of ['lib', 'scripts', 'experiments', 'docs', 'package.json'])
      await cp(resolve(ROOT, path), resolve(fixture, path), { recursive: true });
    const manifestPath = resolve(base, 'correction-code-v1/manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const archivedPath = 'lib/material-fact-runtime-ingest.ts';
    const snapshotPath = resolve(base, 'correction-code-v1', archivedPath + '.snapshot');
    assert.ok(Object.hasOwn(manifest.files, archivedPath));
    const rejectBeforeCallback = async pattern => {
      let entered = false;
      await assert.rejects(withCorrectionV1Code(() => { entered = true; }, fixture), pattern);
      assert.equal(entered, false, 'corrupt snapshots must be rejected before action executes');
    };

    await t.test('unaltered correction-v1 CLI checks exact archived code and original artifacts', () => {
      const receipt = JSON.parse(run(fixture, EXPERIMENT + '/verify-correction-v1.mjs'));
      assert.equal(receipt.status, 'PASS');
      assert.equal(receipt.execution, 'archived_correction_v1_code');
      assert.equal(receipt.current_code_claim, false);
      assert.equal(receipt.model_requests, 0);
      assert.equal(receipt.correction_manifest_sha256, historicalHashes[0]);
    });
    await t.test('missing correction snapshot manifest path rejects before callback', async () => {
      const changed = structuredClone(manifest); delete changed.files[archivedPath];
      await replaced(manifestPath, jsonBytes(changed), () => rejectBeforeCallback(/Correction snapshot omits or adds code paths/u));
    });
    await t.test('additional correction snapshot manifest path rejects before callback', async () => {
      const changed = structuredClone(manifest); changed.files['lib/unregistered-independent.ts'] = '0'.repeat(64);
      await replaced(manifestPath, jsonBytes(changed), () => rejectBeforeCallback(/Correction snapshot omits or adds code paths/u));
    });
    await t.test('changed archived runtime bytes reject before callback', async () => {
      const bytes = await readFile(snapshotPath);
      await replaced(snapshotPath, Buffer.concat([bytes, Buffer.from('\n// independent fixture corruption\n')]),
        () => rejectBeforeCallback(/Correction code changed: lib\/material-fact-runtime-ingest\.ts/u));
    });
    await t.test('missing archived runtime file rejects before callback', async () => {
      const bytes = await readFile(snapshotPath); await rm(snapshotPath);
      try { await rejectBeforeCallback({ code: 'ENOENT' }); }
      finally { await writeFile(snapshotPath, bytes); }
    });
    await t.test('changed correction-v1 manifest bytes reject before callback', async () => {
      const path = resolve(base, 'corrections/manifest.json'), bytes = await readFile(path);
      await replaced(path, Buffer.concat([bytes, Buffer.from('\n')]), () => rejectBeforeCallback(/AssertionError/u));
    });
    await t.test('changed correction-v1 report bytes block v2 before reassessment or writing', async () => {
      const path = resolve(base, 'corrections/report-rules.json'), bytes = await readFile(path);
      await replaced(path, Buffer.concat([bytes, Buffer.from('\n')]), async () => {
        const entry = 'const {computeCorrectionV2}=await import('
          + JSON.stringify(pathToFileURL(resolve(base, 'corrective-assessment-v2.mjs')).href)
          + ');await computeCorrectionV2(' + JSON.stringify(fixture) + ');';
        assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '--eval', entry],
          { cwd: fixture, encoding: 'utf8', stdio: 'pipe', timeout: 60000, maxBuffer: 16 * 1024 ** 2 }), error => {
          assert.notEqual(error.status, 0);
          assert.match(String(error.stderr), /Correction bytes changed: report-rules\.json/u);
          return true;
        });
      });
    });
    await t.test('throwing reconstruction callback cleans only its owned temporary directory', async () => {
      let temporary; const sentinel = new Error('independent-v1-callback-failure');
      await assert.rejects(withCorrectionV1Code(async directory => {
        temporary = directory;
        assert.notEqual(resolve(directory), resolve(fixture));
        assert.notEqual(resolve(directory), resolve(ROOT));
        assert.equal(sha(await readFile(resolve(directory, archivedPath))), manifest.files[archivedPath]);
        await writeFile(resolve(directory, 'independent-cleanup-marker'), 'owned fixture only\n');
        throw sentinel;
      }, fixture), error => error === sentinel);
      assert.ok(temporary);
      await assert.rejects(stat(temporary), { code: 'ENOENT' });
      assert.ok((await stat(fixture)).isDirectory());
    });
    await t.test('successful reconstruction callback also removes its temporary directory', async () => {
      let temporary;
      const value = await withCorrectionV1Code(async directory => { temporary = directory; return 42; }, fixture);
      assert.equal(value, 42);
      await assert.rejects(stat(temporary), { code: 'ENOENT' });
    });
    await t.test('v2 --write refuses an existing output directory and preserves its sentinel', async () => {
      const directory = resolve(base, 'corrections-v2');
      // A parent may already have created real v2 artifacts before this test is
      // rerun; the fixture always keeps them, and only adds a new sentinel.
      await mkdir(directory, { recursive: true });
      const sentinel = resolve(directory, 'independent-existing-output-sentinel');
      await writeFile(sentinel, 'must not be overwritten\n', { flag: 'wx' });
      const before = sha(await readFile(sentinel));
      assert.throws(() => run(fixture, EXPERIMENT + '/corrective-assessment-v2.mjs', ['--write']), error => {
        assert.notEqual(error.status, 0);
        assert.match(String(error.stderr), /EEXIST/u);
        return true;
      });
      assert.equal(sha(await readFile(sentinel)), before);
    });
  } finally {
    await rm(fixture, { recursive: true, force: true });
    assert.equal(sha(await readFile(mainManifest)), historicalHashes[0]);
    assert.equal(sha(await readFile(originalResult)), historicalHashes[1]);
  }
});

