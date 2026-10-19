import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const E = 'experiments/material-facts-v7';
const { withCorrectionV24Code } = await import(pathToFileURL(resolve(ROOT, E, 'verify-correction-v24.mjs')));
const { runHistoricalV24CheckSync } = await import(pathToFileURL(resolve(ROOT, E, 'historical-v24-execution.mjs')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bytesAt = path => readFile(resolve(ROOT, E, path));
const ORIGINAL = '3733e4c6939184fbe79b56e4a4bdc2db35f4e6f99a20fc91c48bd24913ce53ee';
const V23 = 'e41acaf87e52dda27236aabbddd0c509c1d9762eaf46ef2e46314030e7f1b56c';
const V24 = '86560d13902cba7458cae1d5c1b9175c01442c404a4d47bd17305950206e795e';

// Historical adaptation of the author-prepared v24 gate: another agent can
// independently review it. No inference, publication or historical byte edits.
test('archived v24 preserves v23 and its 91 exact dependencies without accepting byte drift', { timeout: 960000 }, async t => {
  const protectedNames = ['freeze.json', 'result-manifest.json', 'corrections/manifest.json',
    ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24].map(version => `corrections-v${version}/manifest.json`),
    'correction-code-v23/manifest.json', 'correction-code-v24/manifest.json',
    'historical-execution-v1.mjs', 'historical-execution-policy-v1.mjs', 'historical-v23-execution.mjs'];
  const before = Object.fromEntries(await Promise.all(protectedNames.map(async path => [path, sha(await bytesAt(path))])));
  assert.equal(before['result-manifest.json'], ORIGINAL);
  assert.equal(before['corrections-v23/manifest.json'], V23);
  assert.equal(before['corrections-v24/manifest.json'], V24);
  const manifestBytes = await bytesAt('corrections-v24/manifest.json'), manifest = JSON.parse(manifestBytes);

  await t.test('the archived v24 manifest binds 91 exact dependencies in the v7 experiment family', async () => {
    assert.equal(manifest.schema, 'material-facts-v7-postfreeze-correction-manifest/24');
    assert.equal(JSON.parse(await bytesAt('corrections-v24/comparison.json')).schema, 'material-facts-v7-postfreeze-correction/24');
    assert.deepEqual(manifestBytes, Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
    assert.equal(manifest.previous_correction_manifest_sha256, V23);
    assert.equal(manifest.first_result_manifest_sha256, ORIGINAL);
    assert.equal(manifest.inference, false);
    assert.equal(Object.keys(manifest.code_sha256).length, 91);
    for (const path of ['lib/material-money-v4.ts', 'lib/material-fact-source-review.ts', `${E}/verify-correction-v23.mjs`, `${E}/corrective-assessment-v24.mjs`,
      `${E}/historical-execution-v1.mjs`, `${E}/historical-execution-policy-v1.mjs`])
      assert(path in manifest.code_sha256, path);
    for (const [path, digest] of Object.entries(manifest.code_sha256))
      assert.equal(sha(await bytesAt(`correction-code-v24/${path}.snapshot`)), digest, path);
  });

  await t.test('the real v24 wrapper refuses rewritten historical manifests and changed source before callback', async () => {
    for (const change of ['manifest', 'snapshot']) {
      const temporary = await realpath(await mkdtemp(resolve(tmpdir(), 'anxin-v7-v24-history-negative-')));
      try {
        await mkdir(resolve(temporary, E, 'corrections-v24'), { recursive: true });
        await cp(resolve(ROOT, E, 'correction-code-v24'), resolve(temporary, E, 'correction-code-v24'), { recursive: true });
        const altered = change === 'manifest' ? Buffer.concat([manifestBytes, Buffer.from('\n')]) : manifestBytes;
        assert.deepEqual(JSON.parse(altered), manifest);
        await writeFile(resolve(temporary, E, 'corrections-v24/manifest.json'), altered);
        if (change === 'snapshot') {
          const target = resolve(temporary, E, 'correction-code-v24/lib/material-fact-source-review.ts.snapshot');
          await writeFile(target, Buffer.concat([await readFile(target), Buffer.from('\n// Independent archived byte drift.\n')]));
        }
        let entered = false;
        await assert.rejects(withCorrectionV24Code(async () => { entered = true; }, temporary), /Correction code changed|Expected values to be strictly equal/u);
        assert.equal(entered, false, change);
      } finally { await rm(temporary, { recursive: true, force: true }); }
    }
  });

  await withCorrectionV24Code(async temporary => {
    const target = resolve(temporary, E, 'corrections-v24/manifest.json');
    const refused = expected => {
      let failure;
      try {
        runHistoricalV24CheckSync(resolve(temporary, E, 'corrective-assessment-v24.mjs'), ['--check'],
          { cwd: temporary, stdio: 'pipe', timeout: 180000, maxBuffer: 16 * 1024 ** 2 });
      } catch (error) { failure = error; }
      assert(failure, 'Changed archived bytes passed their sealed binding.');
      assert.equal(failure.status, 1, 'Refusal must be a verifier result, not fixture timeout.');
      assert.match(String(failure.stderr), expected);
    };
    await t.test('the actual archived v24 CLI refuses JSON-equivalent manifest whitespace', async () => {
      const altered = Buffer.concat([manifestBytes, Buffer.from('\n')]);
      assert.deepEqual(JSON.parse(altered), manifest);
      assert.notEqual(sha(altered), sha(manifestBytes));
      await writeFile(target, altered);
      refused(/Correction v24 manifest bytes changed/u);
      await writeFile(target, manifestBytes);
    });
    await t.test('the actual archived v24 CLI refuses comment-only execution-adapter drift after historical verification', async () => {
      const adapter = resolve(temporary, E, 'historical-execution-v1.mjs');
      await writeFile(adapter, Buffer.concat([await readFile(adapter), Buffer.from('\n// Independent archived execution adapter byte drift.\n')]));
      refused(/Correction v24 manifest changed/u);
    });
  }, ROOT);
  for (const [path, digest] of Object.entries(before)) assert.equal(sha(await bytesAt(path)), digest, path);
  console.log(JSON.stringify({ evidence: 'v24_archived_gate_protected_bytes_unchanged', manifests: before, model_requests: 0 }));
});
