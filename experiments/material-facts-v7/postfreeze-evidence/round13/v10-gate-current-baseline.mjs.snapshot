import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const E = 'experiments/material-facts-v7';
const { withCorrectionV9Code } = await import(pathToFileURL(resolve(ROOT, E, 'verify-correction-v9.mjs')));
const { historicalV9Target } = await import(pathToFileURL(resolve(ROOT, E, 'historical-v9-execution.mjs')));
const { historicalTarget } = await import(pathToFileURL(resolve(ROOT, E, 'historical-execution-policy-v1.mjs')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bytesAt = path => readFile(resolve(ROOT, E, path));
const ORIGINAL = '3733e4c6939184fbe79b56e4a4bdc2db35f4e6f99a20fc91c48bd24913ce53ee';
const V9 = 'ccb4dce9e91f74fd24f5115133db468288b9c988f76ce28136bfd61e00bce764';
const POLICY = 'cf6a04377e518064037cb3374591eb7747972f7259aa92ffa0f8440eefde7dea';

// Author-prepared gate, independently reviewable by another agent. The two
// native v10 children each have a 960s outer bound, so the test allows both plus
// cleanup. Their historical v9 child and older children share the same 900s
// absolute deadline; the immutable v1 whitelist remains unchanged.
test('v10 preserves v9 and binds the reviewed amount-presence and parsing guards without changing the historical execution policy', { timeout: 1980000 }, async t => {
  const protectedNames = ['freeze.json', 'result-manifest.json', 'corrections/manifest.json',
    ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map(version => `corrections-v${version}/manifest.json`),
    'correction-code-v9/manifest.json', 'historical-execution-v1.mjs', 'historical-execution-policy-v1.mjs'];
  const before = Object.fromEntries(await Promise.all(protectedNames.map(async path => [path, sha(await bytesAt(path))])));
  assert.equal(before['result-manifest.json'], ORIGINAL);
  assert.equal(before['corrections-v9/manifest.json'], V9);
  assert.equal(before['historical-execution-policy-v1.mjs'], POLICY);
  const manifestBytes = await bytesAt('corrections-v10/manifest.json'), manifest = JSON.parse(manifestBytes);

  await t.test('the current v10 manifest binds 49 exact dependencies in the v7 experiment family', async () => {
    assert.equal(manifest.schema, 'material-facts-v7-postfreeze-correction-manifest/10');
    assert.equal(JSON.parse(await bytesAt('corrections-v10/comparison.json')).schema, 'material-facts-v7-postfreeze-correction/10');
    assert.deepEqual(manifestBytes, Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
    assert.equal(manifest.previous_correction_manifest_sha256, V9);
    assert.equal(manifest.first_result_manifest_sha256, ORIGINAL);
    assert.equal(manifest.inference, false);
    assert.equal(Object.keys(manifest.code_sha256).length, 49);
    for (const path of ['lib/material-fact-currency-review.ts', 'lib/material-fact-range-review.ts', `${E}/verify-correction-v9.mjs`, `${E}/corrective-assessment-v10.mjs`, `${E}/historical-v9-execution.mjs`,
      `${E}/historical-execution-v1.mjs`, `${E}/historical-execution-policy-v1.mjs`]) assert(path in manifest.code_sha256, path);
    for (const [path, digest] of Object.entries(manifest.code_sha256)) assert.equal(sha(await readFile(resolve(ROOT, path))), digest, path);
    assert.equal(manifest.code_sha256[`${E}/historical-execution-policy-v1.mjs`], POLICY);
    assert(historicalTarget(resolve(ROOT, E, 'corrective-assessment-v8.mjs'), ['--check']));
    assert(historicalV9Target(resolve(ROOT, E, 'corrective-assessment-v9.mjs'), ['--check']));
    assert.equal(historicalV9Target(resolve(ROOT, E, 'corrective-assessment-v9.mjs'), ['--write']), null);
    assert.equal(historicalV9Target(resolve(ROOT, E, 'corrective-assessment-v10.mjs'), ['--check']), null);
    assert.equal(historicalTarget(resolve(ROOT, E, 'verify-correction-v9.mjs'), []), null);
    assert.equal(historicalTarget(resolve(ROOT, E, 'corrective-assessment-v9.mjs'), ['--check']), null);
  });

  await t.test('the v9 wrapper restores all 46 historical dependencies and cleans up when the callback throws', async () => {
    const archived = JSON.parse(await bytesAt('corrections-v9/manifest.json'));
    let owned;
    const expected = new Error('Synthetic v9 callback failure');
    await assert.rejects(withCorrectionV9Code(async temporary => {
      owned = temporary;
      for (const [path, digest] of Object.entries(archived.code_sha256)) assert.equal(sha(await readFile(resolve(temporary, path))), digest, path);
      assert.equal(sha(await readFile(resolve(temporary, E, 'historical-execution-policy-v1.mjs'))), POLICY);
      throw expected;
    }, ROOT), error => error === expected);
    assert(owned);
    await assert.rejects(readFile(resolve(owned, 'package.json')), { code: 'ENOENT' });
  });

  const temporary = await realpath(await mkdtemp(resolve(tmpdir(), 'anxin-v7-v10-current-negative-')));
  try {
    for (const path of ['lib', 'scripts', 'experiments', 'docs', 'package.json']) await cp(resolve(ROOT, path), resolve(temporary, path), { recursive: true });
    const target = resolve(temporary, E, 'corrections-v10/manifest.json');
    const refused = expected => {
      let failure;
      try {
        // v10 stays outside both historical target lists. Its current
        // controller restores v9 in-process, then uses the narrow v9 bridge.
        execFileSync(process.execPath, [resolve(temporary, E, 'corrective-assessment-v10.mjs'), '--check'],
          { cwd: temporary, stdio: 'pipe', timeout: 960000, maxBuffer: 16 * 1024 ** 2 });
      } catch (error) { failure = error; }
      assert(failure, 'Changed current v10 bytes passed their sealed binding.');
      assert.equal(failure.status, 1, 'Refusal must be a verifier result, not fixture timeout.');
      assert.match(String(failure.stderr), expected);
    };
    await t.test('the actual v10 CLI refuses JSON-equivalent current manifest whitespace', async () => {
      const altered = Buffer.concat([manifestBytes, Buffer.from('\n')]);
      assert.deepEqual(JSON.parse(altered), manifest);
      assert.notEqual(sha(altered), sha(manifestBytes));
      await writeFile(target, altered);
      refused(/Correction v10 manifest bytes changed/u);
      await writeFile(target, manifestBytes);
    });
    await t.test('the actual v10 CLI refuses comment-only range-guard drift after archived v9 verification', async () => {
      const guard = resolve(temporary, 'lib/material-fact-range-review.ts');
      await writeFile(guard, Buffer.concat([await readFile(guard), Buffer.from('\n// Synthetic current range guard byte drift.\n')]));
      refused(/Correction v10 manifest changed/u);
    });
  } finally { await rm(temporary, { recursive: true, force: true }); }
  for (const [path, digest] of Object.entries(before)) assert.equal(sha(await bytesAt(path)), digest, path);
  console.log(JSON.stringify({ evidence: 'v10_author_gate_protected_bytes_unchanged', manifests: before, model_requests: 0 }));
});
