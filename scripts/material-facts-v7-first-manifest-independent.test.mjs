import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const EXPERIMENT = 'experiments/material-facts-v7';
const ORIGINAL = '3733e4c6939184fbe79b56e4a4bdc2db35f4e6f99a20fc91c48bd24913ce53ee';
const implementation = resolve(process.env.V7_VERIFY_FROZEN_MODULE ?? resolve(ROOT, EXPERIMENT, 'verify-frozen.mjs'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const { withFrozenCode } = await import(pathToFileURL(implementation).href);
function evidence(name, value) { console.log(JSON.stringify({ evidence: name, ...value })); }

test('first-run manifest binding uses original bytes, not JSON equivalence', { timeout: 120000 }, async t => {
  const original = await readFile(resolve(ROOT, EXPERIMENT, 'result-manifest.json'));
  assert.equal(sha(original), ORIGINAL, 'The independent fixture must begin with the authentic original artifact.');
  const frozenBefore = await readFile(resolve(ROOT, EXPERIMENT, 'freeze.json'));
  const fixture = await realpath(await mkdtemp(resolve(tmpdir(), 'anxin-v7-first-manifest-')));
  const destination = resolve(fixture, EXPERIMENT, 'result-manifest.json');
  try {
    for (const path of ['lib', 'scripts', 'experiments', 'docs', 'package.json']) {
      await cp(resolve(ROOT, path), resolve(fixture, path), { recursive: true });
    }
    // Only the current wrapper under review is substituted. Its 36 archived
    // executable snapshots, freeze, results and reports are copied byte-exact.
    await writeFile(resolve(fixture, EXPERIMENT, 'verify-frozen.mjs'), await readFile(implementation));
    const verify = () => execFileSync(process.execPath, [resolve(fixture, EXPERIMENT, 'verify-frozen.mjs')],
      { cwd: fixture, encoding: 'utf8', stdio: 'pipe', timeout: 60000, maxBuffer: 16 * 1024 ** 2 });
    evidence('wrapper_under_review', { sha256: sha(await readFile(implementation)), original_manifest_sha256: ORIGINAL });

    await t.test('the exact original bytes still pass full historical verification', () => {
      const result = JSON.parse(verify());
      assert.equal(result.status, 'PASS');
      assert.equal(result.result_manifest_sha256, ORIGINAL);
      assert.equal(result.current_code_claim, false);
    });

    const value = JSON.parse(original);
    const variants = [
      ['compact serialization', JSON.stringify(value) + '\n'],
      ['reordered top-level keys', JSON.stringify(Object.fromEntries(Object.entries(value).reverse()), null, 2) + '\n'],
      ['one extra terminal newline', original.toString('utf8') + '\n'],
    ];
    for (const [name, text] of variants) await t.test('same JSON with ' + name + ' is refused by the historical CLI', async () => {
      const bytes = Buffer.from(text);
      assert.deepEqual(JSON.parse(bytes), value, 'The mutation must preserve the complete parsed artifact.');
      assert.notEqual(sha(bytes), ORIGINAL);
      try {
        await writeFile(destination, bytes);
        let returned = null, failure = null;
        try { returned = JSON.parse(verify()); } catch (error) { failure = error; }
        evidence('equivalent_manifest', { variant: name, sha256: sha(bytes), cli_returned: returned,
          refused: failure !== null });
        assert(failure, 'Historical verification accepted a different byte representation of the original result manifest.');
        assert.equal(failure.status, 1);
        assert.match(String(failure.stderr), /Original first-run result manifest changed/u);
      } finally { await writeFile(destination, original); }
    });

    await t.test('the exported reconstruction API refuses a changed manifest before executing its callback', async () => {
      let entered = false;
      try {
        await writeFile(destination, variants[0][1]);
        await assert.rejects(withFrozenCode(() => { entered = true; }, fixture), /Original first-run result manifest changed/u);
        assert.equal(entered, false);
      } finally { await writeFile(destination, original); }
    });
  } finally {
    await rm(fixture, { recursive: true, force: true });
    assert.deepEqual(await readFile(resolve(ROOT, EXPERIMENT, 'result-manifest.json')), original);
    assert.deepEqual(await readFile(resolve(ROOT, EXPERIMENT, 'freeze.json')), frozenBefore);
    evidence('original_artifacts_unchanged', { result_manifest_sha256: ORIGINAL, freeze_sha256: sha(frozenBefore) });
  }
});
