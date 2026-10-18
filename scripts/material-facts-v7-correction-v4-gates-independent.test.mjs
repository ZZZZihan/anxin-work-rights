import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Synthetic corruption in an owned fixture only. All executed CLIs are read-only
// verifiers; this test never invokes a runner, a model or an HTTP service.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const EXPERIMENT = 'experiments/material-facts-v7';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const { withCorrectionV3Code } = await import(pathToFileURL(resolve(ROOT, EXPERIMENT, 'verify-correction-v3.mjs')).href);
const run = (root, path, args = []) => execFileSync(process.execPath, [resolve(root, EXPERIMENT, path), ...args],
  { cwd: root, encoding: 'utf8', stdio: 'pipe', timeout: 60000, maxBuffer: 16 * 1024 ** 2 });

async function replaced(path, bytes, action) {
  const original = await readFile(path);
  try { await writeFile(path, bytes); return await action(); }
  finally { await writeFile(path, original); }
}
function evidence(name, detail) { console.log(JSON.stringify({ evidence: name, ...detail })); }
function failsWith(action, pattern) {
  assert.throws(action, error => {
    assert.notEqual(error.status, 0);
    assert.match(String(error.stderr ?? '') + String(error.stdout ?? ''), pattern,
      'The verifier failed for a different reason than the injected corruption.');
    return true;
  });
}

test('independent v4 gates bind the archived v3 and current arithmetic code', { timeout: 120000 }, async t => {
  const historical = ['freeze.json', 'result-manifest.json', 'corrections/manifest.json',
    'corrections-v2/manifest.json', 'corrections-v3/manifest.json', 'corrections-v4/manifest.json'];
  const before = Object.fromEntries(await Promise.all(historical.map(async path => [path, sha(await readFile(resolve(ROOT, EXPERIMENT, path)))])));
  const fixture = await realpath(await mkdtemp(resolve(tmpdir(), 'anxin-v7-v4-independent-')));
  const base = resolve(fixture, EXPERIMENT);
  try {
    for (const path of ['lib', 'scripts', 'experiments', 'docs', 'package.json']) {
      await cp(resolve(ROOT, path), resolve(fixture, path), { recursive: true });
    }
    const archive = JSON.parse(await readFile(resolve(base, 'correction-code-v3/manifest.json'), 'utf8'));
    const v3 = JSON.parse(await readFile(resolve(base, 'corrections-v3/manifest.json'), 'utf8'));
    const v4 = JSON.parse(await readFile(resolve(base, 'corrections-v4/manifest.json'), 'utf8'));

    await t.test('published v4 binds all 29 archived v3 files and both new execution dependencies', async () => {
      assert.equal(Object.keys(archive.files).length, 29);
      assert.deepEqual(archive.files, v3.code_sha256);
      assert.equal(v4.previous_correction_manifest_sha256, before['corrections-v3/manifest.json']);
      for (const path of ['lib/material-fact-arithmetic-review.ts', `${EXPERIMENT}/verify-correction-v3.mjs`]) {
        assert.equal(v4.code_sha256[path], sha(await readFile(resolve(fixture, path))), 'New code is outside the versioned manifest: ' + path);
      }
      const result = JSON.parse(run(fixture, 'corrective-assessment-v4.mjs', ['--check']));
      assert.equal(result.status, 'PASS');
      assert.equal(result.model_requests, 0);
      assert.equal(result.new_holdout_run, false);
      evidence('v4-baseline', { v4_manifest_sha256: before['corrections-v4/manifest.json'], v3_manifest_sha256: before['corrections-v3/manifest.json'] });
    });

    const rejectsBeforeCallback = async pattern => {
      let entered = false;
      await assert.rejects(withCorrectionV3Code(() => { entered = true; }, fixture), pattern);
      assert.equal(entered, false, 'Invalid archive reached the historical verifier callback.');
    };
    await t.test('a changed previous manifest cannot silently select a different history', async () => {
      const path = resolve(base, 'corrections-v3/manifest.json'), bytes = await readFile(path);
      await replaced(path, Buffer.concat([bytes, Buffer.from('\n')]), () => rejectsBeforeCallback(/AssertionError|ERR_ASSERTION/u));
    });
    await t.test('a changed archived money snapshot is refused before restoring code', async () => {
      const path = resolve(base, 'correction-code-v3/lib/material-money-v4.ts.snapshot');
      await replaced(path, Buffer.concat([await readFile(path), Buffer.from('\n// Independent fixture corruption.\n')]),
        () => rejectsBeforeCallback(/Correction code changed/u));
    });
    await t.test('a missing archived executable is refused before restoring code', async () => {
      const path = resolve(base, 'correction-code-v3/experiments/material-facts-v7/corrective-assessment-v3.mjs.snapshot');
      const bytes = await readFile(path);
      try { await rm(path); await rejectsBeforeCallback(/ENOENT/u); }
      finally { await writeFile(path, bytes); }
    });
    await t.test('v4 rejects changed v3 report bytes through the archived verifier', async () => {
      const path = resolve(base, 'corrections-v3/report-rules.json');
      await replaced(path, Buffer.concat([await readFile(path), Buffer.from('\n')]), () => {
        failsWith(() => run(fixture, 'corrective-assessment-v4.mjs', ['--check']), /Correction v3 bytes changed/u);
      });
    });
    await t.test('unchanged behavior with a changed arithmetic helper still invalidates v4', async () => {
      const path = resolve(fixture, 'lib/material-fact-arithmetic-review.ts');
      await replaced(path, Buffer.concat([await readFile(path), Buffer.from('\n// Hash-only independent drift probe.\n')]), () => {
        failsWith(() => run(fixture, 'corrective-assessment-v4.mjs', ['--check']), /Correction v4 manifest changed/u);
      });
    });
    await t.test('archived code is restored and owned temporary files are cleaned after callback failure', async () => {
      let temporary;
      const sentinel = new Error('independent-cleanup-sentinel');
      await assert.rejects(withCorrectionV3Code(async directory => {
        temporary = directory;
        assert.notEqual(directory, fixture);
        for (const [path, expected] of Object.entries(archive.files)) {
          assert.equal(sha(await readFile(resolve(directory, path))), expected);
        }
        throw sentinel;
      }, fixture), error => error === sentinel);
      await assert.rejects(stat(temporary), /ENOENT/u);
      assert.equal((await stat(fixture)).isDirectory(), true);
    });
  } finally {
    await rm(fixture, { recursive: true, force: true });
    for (const [path, expected] of Object.entries(before)) {
      assert.equal(sha(await readFile(resolve(ROOT, EXPERIMENT, path))), expected, 'Independent tests changed live evidence: ' + path);
    }
    evidence('historical_hashes_unchanged', before);
  }
});
