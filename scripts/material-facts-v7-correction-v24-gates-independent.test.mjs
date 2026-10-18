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
const { withCorrectionV23Code } = await import(pathToFileURL(resolve(ROOT, E, 'verify-correction-v23.mjs')));
const { historicalV23Target } = await import(pathToFileURL(resolve(ROOT, E, 'historical-v23-execution.mjs')));
const { historicalTarget } = await import(pathToFileURL(resolve(ROOT, E, 'historical-execution-policy-v1.mjs')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bytesAt = path => readFile(resolve(ROOT, E, path));
const ORIGINAL = '3733e4c6939184fbe79b56e4a4bdc2db35f4e6f99a20fc91c48bd24913ce53ee';
const V23 = 'e41acaf87e52dda27236aabbddd0c509c1d9762eaf46ef2e46314030e7f1b56c';
const V9_BRIDGE = 'd02aa0b5881a9699d71478ed8e2a78f9b7f17dfda7c806cda58c788e1c3df10e';
const POLICY = 'cf6a04377e518064037cb3374591eb7747972f7259aa92ffa0f8440eefde7dea';

// Author-prepared gate, independently reviewable by another agent. The two
// native v24 children each have a 960s outer bound, so the test allows both plus
// cleanup. Their historical v23 child and older children share the same 900s
// absolute deadline; the immutable v1 whitelist remains unchanged.
test('v24 preserves v23 and binds recurring payment-day aliases and traditional receipt and termination cues without changing the historical execution policy', { timeout: 1980000 }, async t => {
  const protectedNames = ['freeze.json', 'result-manifest.json', 'corrections/manifest.json',
    ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24].map(version => `corrections-v${version}/manifest.json`),
    'correction-code-v23/manifest.json', 'historical-execution-v1.mjs', 'historical-execution-policy-v1.mjs', 'historical-v9-execution.mjs'];
  const before = Object.fromEntries(await Promise.all(protectedNames.map(async path => [path, sha(await bytesAt(path))])));
  assert.equal(before['result-manifest.json'], ORIGINAL);
  assert.equal(before['corrections-v23/manifest.json'], V23);
  assert.equal(before['historical-execution-policy-v1.mjs'], POLICY);
  assert.equal(before['historical-v9-execution.mjs'], V9_BRIDGE);
  const manifestBytes = await bytesAt('corrections-v24/manifest.json'), manifest = JSON.parse(manifestBytes);

  await t.test('the current v24 manifest binds 91 exact dependencies in the v7 experiment family', async () => {
    assert.equal(manifest.schema, 'material-facts-v7-postfreeze-correction-manifest/24');
    assert.equal(JSON.parse(await bytesAt('corrections-v24/comparison.json')).schema, 'material-facts-v7-postfreeze-correction/24');
    assert.deepEqual(manifestBytes, Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
    assert.equal(manifest.previous_correction_manifest_sha256, V23);
    assert.equal(manifest.first_result_manifest_sha256, ORIGINAL);
    assert.equal(manifest.inference, false);
    assert.equal(Object.keys(manifest.code_sha256).length, 91);
    for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-source-review.ts', 'lib/material-fact-arithmetic-review.ts', `${E}/verify-correction-v23.mjs`, `${E}/corrective-assessment-v24.mjs`, `${E}/historical-v23-execution.mjs`,
      `${E}/historical-execution-v1.mjs`, `${E}/historical-execution-policy-v1.mjs`]) assert(path in manifest.code_sha256, path);
    for (const [path, digest] of Object.entries(manifest.code_sha256)) assert.equal(sha(await readFile(resolve(ROOT, path))), digest, path);
    assert.equal(manifest.code_sha256[`${E}/historical-execution-policy-v1.mjs`], POLICY);
    assert.equal(manifest.code_sha256[`${E}/historical-v9-execution.mjs`], V9_BRIDGE);
    assert(historicalTarget(resolve(ROOT, E, 'corrective-assessment-v8.mjs'), ['--check']));
    assert(historicalV23Target(resolve(ROOT, E, 'corrective-assessment-v23.mjs'), ['--check']));
    assert.equal(historicalV23Target(resolve(ROOT, E, 'corrective-assessment-v23.mjs'), ['--write']), null);
    assert.equal(historicalV23Target(resolve(ROOT, E, 'corrective-assessment-v24.mjs'), ['--check']), null);
    assert.equal(historicalTarget(resolve(ROOT, E, 'verify-correction-v23.mjs'), []), null);
    assert.equal(historicalTarget(resolve(ROOT, E, 'corrective-assessment-v23.mjs'), ['--check']), null);
  });

  await t.test('the v23 wrapper restores all 88 historical dependencies and cleans up when the callback throws', async () => {
    const archived = JSON.parse(await bytesAt('corrections-v23/manifest.json'));
    let owned;
    const expected = new Error('Synthetic v23 callback failure');
    await assert.rejects(withCorrectionV23Code(async temporary => {
      owned = temporary;
      for (const [path, digest] of Object.entries(archived.code_sha256)) assert.equal(sha(await readFile(resolve(temporary, path))), digest, path);
      assert.equal(sha(await readFile(resolve(temporary, E, 'historical-execution-policy-v1.mjs'))), POLICY);
      throw expected;
    }, ROOT), error => error === expected);
    assert(owned);
    await assert.rejects(readFile(resolve(owned, 'package.json')), { code: 'ENOENT' });
  });

  const temporary = await realpath(await mkdtemp(resolve(tmpdir(), 'anxin-v7-v24-current-negative-')));
  try {
    for (const path of ['lib', 'scripts', 'experiments', 'docs', 'package.json']) await cp(resolve(ROOT, path), resolve(temporary, path), { recursive: true });
    const target = resolve(temporary, E, 'corrections-v24/manifest.json');
    const refused = expected => {
      let failure;
      try {
        // v24 stays outside the historical target lists. Its current
        // controller restores v23 in-process, then uses the narrow v23 bridge.
        execFileSync(process.execPath, [resolve(temporary, E, 'corrective-assessment-v24.mjs'), '--check'],
          { cwd: temporary, stdio: 'pipe', timeout: 960000, maxBuffer: 16 * 1024 ** 2 });
      } catch (error) { failure = error; }
      assert(failure, 'Changed current v24 bytes passed their sealed binding.');
      assert.equal(failure.status, 1, 'Refusal must be a verifier result, not fixture timeout.');
      assert.match(String(failure.stderr), expected);
    };
    await t.test('the actual v24 CLI refuses JSON-equivalent current manifest whitespace', async () => {
      const altered = Buffer.concat([manifestBytes, Buffer.from('\n')]);
      assert.deepEqual(JSON.parse(altered), manifest);
      assert.notEqual(sha(altered), sha(manifestBytes));
      await writeFile(target, altered);
      refused(/Correction v24 manifest bytes changed/u);
      await writeFile(target, manifestBytes);
    });
    await t.test('the actual v24 CLI refuses comment-only event cue guard drift after archived v23 verification', async () => {
      const guard = resolve(temporary, 'lib/material-fact-event-review.ts');
      await writeFile(guard, Buffer.concat([await readFile(guard), Buffer.from('\n// Synthetic current event cue guard byte drift.\n')]));
      refused(/Correction v24 manifest changed/u);
    });
  } finally { await rm(temporary, { recursive: true, force: true }); }
  for (const [path, digest] of Object.entries(before)) assert.equal(sha(await bytesAt(path)), digest, path);
  console.log(JSON.stringify({ evidence: 'v24_author_gate_protected_bytes_unchanged', manifests: before, model_requests: 0 }));
});
