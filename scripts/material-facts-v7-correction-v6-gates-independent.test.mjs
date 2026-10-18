import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CURRENT_ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const E = 'experiments/material-facts-v7';
const { withCorrectionV5Code } = await import(pathToFileURL(resolve(CURRENT_ROOT, E, 'verify-correction-v5.mjs')));
const { withCorrectionV6Code } = await import(pathToFileURL(resolve(CURRENT_ROOT, E, 'verify-correction-v6.mjs')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// No runner or model is invoked. Only disposable copies are altered; the real
// historical wrapper and the current read-only correction CLI enforce refusal.
test('v6 preserves the v5 archive and binds its current arithmetic dependency', { timeout: 300000 }, async t => withCorrectionV6Code(async ROOT => {
  const bytesAt = path => readFile(resolve(ROOT, E, path));
  const protectedNames = ['freeze.json', 'result-manifest.json', 'corrections/manifest.json',
    ...[2, 3, 4, 5, 6].map(version => `corrections-v${version}/manifest.json`)];
  const before = Object.fromEntries(await Promise.all(protectedNames.map(async path => [path, sha(await bytesAt(path))])));
  const manifest = JSON.parse(await bytesAt('corrections-v6/manifest.json'));
  const archive = JSON.parse(await bytesAt('correction-code-v5/manifest.json'));
  await t.test('current v6 seals its historical verifier and the same original outputs', async () => {
    assert.equal(manifest.previous_correction_manifest_sha256, before['corrections-v5/manifest.json']);
    assert.equal(manifest.first_result_manifest_sha256, before['result-manifest.json']);
    assert.equal(manifest.inference, false);
    for (const path of [`${E}/verify-correction-v5.mjs`, `${E}/corrective-assessment-v6.mjs`, 'lib/material-fact-arithmetic-review.ts'])
      assert.equal(manifest.code_sha256[path], sha(await readFile(resolve(ROOT, path))), path);
  });
  for (const change of ['snapshot', 'manifest']) await t.test(`the real v5 wrapper rejects ${change} changes before entering its callback`, async () => {
    const temporary = await realpath(await mkdtemp(resolve(tmpdir(), 'anxin-v7-v6-history-negative-')));
    try {
      await mkdir(resolve(temporary, E, 'corrections-v5'), { recursive: true });
      await cp(resolve(ROOT, E, 'correction-code-v5'), resolve(temporary, E, 'correction-code-v5'), { recursive: true });
      const previous = await bytesAt('corrections-v5/manifest.json');
      await writeFile(resolve(temporary, E, 'corrections-v5/manifest.json'), previous);
      if (change === 'manifest') {
        const altered = JSON.stringify(JSON.parse(previous));
        assert.deepEqual(JSON.parse(altered), JSON.parse(previous));
        assert.notEqual(sha(altered), sha(previous));
        await writeFile(resolve(temporary, E, 'corrections-v5/manifest.json'), altered);
      } else {
        const path = Object.keys(archive.files).sort()[0], target = resolve(temporary, E, 'correction-code-v5', path + '.snapshot');
        await writeFile(target, Buffer.concat([await readFile(target), Buffer.from('\n// altered historical bytes\n')]));
      }
      let entered = false;
      await assert.rejects(withCorrectionV5Code(async () => { entered = true; }, temporary), /Correction code changed|Expected values to be strictly equal/u);
      assert.equal(entered, false);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });
  await t.test('a comment-only current helper drift fails the actual v6 check after the historical chain passes', async () => {
    const temporary = await realpath(await mkdtemp(resolve(tmpdir(), 'anxin-v7-v6-current-negative-')));
    try {
      for (const path of ['lib', 'scripts', 'experiments', 'docs', 'package.json'])
        await cp(resolve(ROOT, path), resolve(temporary, path), { recursive: true });
      const helper = resolve(temporary, 'lib/material-fact-arithmetic-review.ts');
      await writeFile(helper, Buffer.concat([await readFile(helper), Buffer.from('\n// Independent byte-only dependency drift.\n')]));
      let failure;
      try { execFileSync(process.execPath, [resolve(temporary, E, 'corrective-assessment-v6.mjs'), '--check'],
        { cwd: temporary, stdio: 'pipe', timeout: 180000, maxBuffer: 16 * 1024 ** 2 }); }
      catch (error) { failure = error; }
      assert(failure, 'Changed helper passed its sealed current-code binding.');
      assert.equal(failure.status, 1, 'Refusal must be a verifier result, not the fixture timeout.');
      assert.match(String(failure.stderr), /Correction v6 manifest changed/u);
      console.log(JSON.stringify({ evidence: 'v6_current_helper_hash_refused', refusal: 'Correction v6 manifest changed' }));
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });
  for (const [path, digest] of Object.entries(before)) assert.equal(sha(await bytesAt(path)), digest, path);
  console.log(JSON.stringify({ evidence: 'v6_independent_gate_protected_bytes_unchanged', manifests: before }));
}, CURRENT_ROOT));
