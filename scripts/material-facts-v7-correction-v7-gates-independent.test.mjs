import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runHistoricalCheckSync } from '../experiments/material-facts-v7/historical-execution-v1.mjs';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CURRENT_ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const E = 'experiments/material-facts-v7';
const { withCorrectionV6Code } = await import(pathToFileURL(resolve(CURRENT_ROOT, E, 'verify-correction-v6.mjs')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const { withCorrectionV7Code } = await import(pathToFileURL(resolve(CURRENT_ROOT, E, 'verify-correction-v7.mjs')));
const ORIGINAL = '3733e4c6939184fbe79b56e4a4bdc2db35f4e6f99a20fc91c48bd24913ce53ee';
const V6 = '0c9ef56e30e278c816e088a934df1cb8f0cdc944c262b9bd9f88be146909ee69';

// All mutations are in owned temporary trees. These tests never import the
// runner, generate model output, or change an existing correction artifact.
test('v7 binds canonical manifest bytes while preserving the archived v6 source', { timeout: 960000 }, async t => withCorrectionV7Code(async ROOT => {
  const bytesAt = path => readFile(resolve(ROOT, E, path));
  const protectedNames = ['freeze.json', 'result-manifest.json', 'corrections/manifest.json',
    ...[2, 3, 4, 5, 6, 7].map(version => `corrections-v${version}/manifest.json`),
    'correction-code-v6/manifest.json'];
  const before = Object.fromEntries(await Promise.all(protectedNames.map(async path => [path, sha(await bytesAt(path))])));
  assert.equal(before['result-manifest.json'], ORIGINAL);
  assert.equal(before['corrections-v6/manifest.json'], V6);
  const manifestBytes = await bytesAt('corrections-v7/manifest.json');
  const manifest = JSON.parse(manifestBytes);

  await t.test('the valid current manifest uses canonical bytes and binds all 39 current dependencies', async () => {
    assert.deepEqual(manifestBytes, Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
    assert.equal(manifest.previous_correction_manifest_sha256, V6);
    assert.equal(manifest.first_result_manifest_sha256, ORIGINAL);
    assert.equal(manifest.inference, false);
    assert.equal(Object.keys(manifest.code_sha256).length, 39);
    for (const path of [`${E}/experiment-lock.mjs`, `${E}/verify-correction-v6.mjs`, `${E}/corrective-assessment-v7.mjs`])
      assert(path in manifest.code_sha256, `Missing current dependency: ${path}`);
    for (const [path, digest] of Object.entries(manifest.code_sha256))
      assert.equal(sha(await readFile(resolve(ROOT, path))), digest, path);
  });

  await t.test('the real v6 wrapper rejects a changed archived source before its callback', async () => {
    const temporary = await realpath(await mkdtemp(resolve(tmpdir(), 'anxin-v7-v7-source-negative-')));
    try {
      await mkdir(resolve(temporary, E, 'corrections-v6'), { recursive: true });
      await cp(resolve(ROOT, E, 'correction-code-v6'), resolve(temporary, E, 'correction-code-v6'), { recursive: true });
      await writeFile(resolve(temporary, E, 'corrections-v6/manifest.json'), await bytesAt('corrections-v6/manifest.json'));
      const path = 'lib/material-fact-arithmetic-review.ts';
      const target = resolve(temporary, E, 'correction-code-v6', path + '.snapshot');
      await writeFile(target, Buffer.concat([await readFile(target), Buffer.from('\n// Independent archived source drift.\n')]));
      let entered = false;
      await assert.rejects(withCorrectionV6Code(async () => { entered = true; }, temporary), /Correction code changed/u);
      assert.equal(entered, false);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });

  const temporary = await realpath(await mkdtemp(resolve(tmpdir(), 'anxin-v7-v7-manifest-negative-')));
  try {
    for (const path of ['lib', 'scripts', 'experiments', 'docs', 'package.json'])
      await cp(resolve(ROOT, path), resolve(temporary, path), { recursive: true });
    const target = resolve(temporary, E, 'corrections-v7/manifest.json');
    const variants = {
      whitespace: Buffer.concat([manifestBytes, Buffer.from('\n')]),
      reordered: Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(manifest).reverse()), null, 2) + '\n'),
    };
    for (const [name, altered] of Object.entries(variants)) await t.test(`the actual v7 CLI refuses JSON-equivalent ${name} manifest bytes`, async () => {
      assert.deepEqual(JSON.parse(altered), manifest);
      assert.notEqual(sha(altered), sha(manifestBytes));
      await writeFile(target, altered);
      let failure;
      try {
        runHistoricalCheckSync(resolve(temporary, E, 'corrective-assessment-v7.mjs'), ['--check'],
          { cwd: temporary, stdio: 'pipe', timeout: 180000, maxBuffer: 16 * 1024 ** 2 });
      } catch (error) { failure = error; }
      assert(failure, 'JSON-equivalent manifest rewrite passed its byte binding.');
      assert.equal(failure.status, 1, 'Refusal must be the verifier result, not a fixture timeout.');
      assert.match(String(failure.stderr), /Correction v7 manifest bytes changed/u);
      console.log(JSON.stringify({ evidence: 'v7_manifest_bytes_refused', variant: name,
        original_sha256: sha(manifestBytes), altered_sha256: sha(altered), model_requests: 0 }));
    });
  } finally { await rm(temporary, { recursive: true, force: true }); }
  for (const [path, digest] of Object.entries(before)) assert.equal(sha(await bytesAt(path)), digest, path);
  console.log(JSON.stringify({ evidence: 'v7_independent_gate_protected_bytes_unchanged', manifests: before }));
}, CURRENT_ROOT));
