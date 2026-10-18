import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withFrozenCode } from '../experiments/material-facts-v7/verify-frozen.mjs';

// Independent negative gate tests. Only a temporary copy is mutated: no model,
// network, build, correction write, or modification of historical repo evidence.
const IMPLEMENTATION_ROOT = fileURLToPath(new URL('../', import.meta.url));
const ROOT = resolve(process.env.MATERIAL_FACT_TEST_ROOT || IMPLEMENTATION_ROOT);
const EXPERIMENT = 'experiments/material-facts-v7';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');

async function replaced(path, replacement, action) {
  assert.ok((await lstat(path)).isFile(), 'only mutate a regular fixture file');
  const original = await readFile(path);
  try { await writeFile(path, replacement); return await action(); }
  finally { await writeFile(path, original); }
}

test('historical-code and correction gates reject isolated evidence corruption', { timeout: 120000 }, async t => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'anxin-v7-correction-gates-'));
  const base = resolve(fixture, EXPERIMENT);
  const manifestPath = resolve(base, 'frozen-code-v2/manifest.json');
  const originalResult = resolve(ROOT, EXPERIMENT, 'results/holdout-rules-1/results.jsonl');
  const rootResultHash = sha(await readFile(originalResult));
  try {
    for (const path of ['lib', 'scripts', 'experiments', 'docs', 'package.json'])
      await cp(resolve(ROOT, path), resolve(fixture, path), { recursive: true });
    await cp(resolve(IMPLEMENTATION_ROOT, EXPERIMENT, 'verify-frozen.mjs'), resolve(base, 'verify-frozen.mjs'));
    await cp(resolve(IMPLEMENTATION_ROOT, EXPERIMENT, 'frozen-code-v2'), resolve(base, 'frozen-code-v2'), { recursive: true });
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const archivedPath = 'lib/material-fact-source-review.ts';
    assert.ok(Object.hasOwn(manifest.files, archivedPath), 'fixture must contain the source-review snapshot');
    const snapshotPath = resolve(base, 'frozen-code-v2', `${archivedPath}.snapshot`);

    await t.test('unaltered copied evidence passes the real historical verifier', () => {
      const receipt = JSON.parse(execFileSync(process.execPath, [resolve(base, 'verify-frozen.mjs')], {
        cwd: fixture, encoding: 'utf8', stdio: 'pipe', timeout: 60000, maxBuffer: 16 * 1024 ** 2,
      }));
      assert.equal(receipt.status, 'PASS');
      assert.equal(receipt.result_files, 60);
      assert.equal(receipt.current_code_claim, false);
    });

    const rejectBeforeCallback = async (pattern) => {
      let entered = false;
      await assert.rejects(withFrozenCode(() => { entered = true; }, fixture), pattern);
      assert.equal(entered, false, 'invalid archive must fail before callback execution');
    };
    await t.test('a missing historical manifest path is rejected', async () => {
      const changed = structuredClone(manifest);
      delete changed.files[archivedPath];
      await replaced(manifestPath, jsonBytes(changed), () => rejectBeforeCallback(/Historical code snapshot omits or adds frozen paths/u));
    });
    await t.test('an extra historical manifest path is rejected', async () => {
      const changed = structuredClone(manifest);
      changed.files['lib/unregistered-synthetic-path.ts'] = '0'.repeat(64);
      await replaced(manifestPath, jsonBytes(changed), () => rejectBeforeCallback(/Historical code snapshot omits or adds frozen paths/u));
    });
    await t.test('modified historical snapshot bytes are rejected', async () => {
      const bytes = await readFile(snapshotPath);
      await replaced(snapshotPath, Buffer.concat([bytes, Buffer.from('\n// synthetic corruption\n')]),
        () => rejectBeforeCallback(/Archived code changed: lib\/material-fact-source-review\.ts/u));
    });
    await t.test('an absent historical snapshot file is rejected', async () => {
      const bytes = await readFile(snapshotPath);
      await rm(snapshotPath);
      try { await rejectBeforeCallback({ code: 'ENOENT' }); }
      finally { await writeFile(snapshotPath, bytes); }
    });
    await t.test('changed first-run result bytes block correction before reassessment', async () => {
      const resultPath = resolve(base, 'results/holdout-rules-1/results.jsonl');
      const bytes = await readFile(resultPath);
      // Whitespace preserves parsed rows and scores. The immutable-byte manifest
      // must still reject it, rather than merely checking semantic equivalence.
      await replaced(resultPath, Buffer.concat([bytes, Buffer.from('\n')]), async () => {
        const entry = `const { computeCorrection } = await import(${JSON.stringify(pathToFileURL(resolve(base, 'corrective-assessment.mjs')).href)}); await computeCorrection(${JSON.stringify(fixture)});`;
        assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '--eval', entry], {
          cwd: fixture, encoding: 'utf8', stdio: 'pipe', timeout: 60000, maxBuffer: 16 * 1024 ** 2,
        }), error => {
          assert.notEqual(error.status, 0);
          assert.match(String(error.stderr), /Result manifest differs or omits artifacts/u);
          return true;
        });
      });
    });
    await t.test('a throwing callback removes its owned temporary reconstruction', async () => {
      let temporary;
      const sentinel = new Error('synthetic-callback-failure');
      await assert.rejects(withFrozenCode(async directory => {
        temporary = directory;
        assert.notEqual(resolve(directory), resolve(ROOT));
        assert.notEqual(resolve(directory), resolve(fixture));
        assert.equal(sha(await readFile(resolve(directory, archivedPath))), manifest.files[archivedPath]);
        await writeFile(resolve(directory, 'synthetic-cleanup-marker'), 'owned temporary file\n');
        throw sentinel;
      }, fixture), error => error === sentinel);
      assert.ok(temporary, 'callback must execute before testing its cleanup');
      await assert.rejects(stat(temporary), { code: 'ENOENT' });
    });
  } finally {
    await rm(fixture, { recursive: true, force: true });
    assert.equal(sha(await readFile(originalResult)), rootResultHash, 'the main-tree original result must remain untouched');
  }
});
