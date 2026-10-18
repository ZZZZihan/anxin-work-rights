import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CURRENT_ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const E = 'experiments/material-facts-v7';
const { withCorrectionV5Code } = await import(pathToFileURL(resolve(CURRENT_ROOT, E, 'verify-correction-v5.mjs')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// Only copies are changed. These are real read-only correction CLI calls,
// including its historical verification chain; no runner or model is invoked.
test('v5 seals the shared lock and bounded runner code without rewriting v4', { timeout: 360000 }, async t => withCorrectionV5Code(async ROOT => {
  const base = resolve(ROOT, E);
  const manifest = JSON.parse(await readFile(resolve(base, 'corrections-v5/manifest.json')));
  const paths = ['freeze.json', 'result-manifest.json', 'corrections/manifest.json',
    'corrections-v2/manifest.json', 'corrections-v3/manifest.json', 'corrections-v4/manifest.json', 'corrections-v5/manifest.json'];
  const protectedPaths = [...paths.map(path => `${E}/${path}`), ...Object.keys(manifest.code_sha256)];
  const before = Object.fromEntries(await Promise.all(protectedPaths.map(async path => [path, sha(await readFile(resolve(ROOT, path)))])));
  const fixture = await realpath(await mkdtemp(resolve(tmpdir(), 'anxin-v7-v5-independent-')));
  try {
    for (const path of ['lib', 'scripts', 'experiments', 'docs', 'package.json']) await cp(resolve(ROOT, path), resolve(fixture, path), { recursive: true });
    await t.test('the published version binds both new execution dependencies and the archived v4 manifest', async () => {
      for (const path of [`${E}/experiment-lock.mjs`, `${E}/run.mjs`, `${E}/verify-correction-v4.mjs`]) {
        assert.equal(manifest.code_sha256[path], before[path], path);
      }
      assert.equal(manifest.previous_correction_manifest_sha256, before[`${E}/corrections-v4/manifest.json`]);
    });
    for (const file of ['experiment-lock.mjs', 'run.mjs']) await t.test(`a comment-only current ${file} drift is refused by the real v5 check`, async () => {
      const path = resolve(fixture, E, file), original = await readFile(path);
      try {
        await writeFile(path, Buffer.concat([original, Buffer.from('\n// Independent hash drift; no behavior change.\n')]));
        let failure = null;
        try {
          execFileSync(process.execPath, [resolve(fixture, E, 'corrective-assessment-v5.mjs'), '--check'],
            { cwd: fixture, stdio: 'pipe', timeout: 120000, maxBuffer: 16 * 1024 ** 2 });
        } catch (error) { failure = error; }
        assert(failure, 'A changed current execution dependency passed the sealed v5 check.');
        assert.equal(failure.status, 1, 'The verifier must refuse, not be killed by a fixture deadline.');
        assert.match(String(failure.stderr), /Correction v5 manifest changed/u,
          'The historical chain failed before reaching the current code binding.');
        console.log(JSON.stringify({ evidence: 'v5_current_code_drift_refused', path: `${E}/${file}`,
          original_sha256: sha(original), altered_sha256: sha(await readFile(path)), refusal: 'Correction v5 manifest changed' }));
      } finally { await writeFile(path, original); }
    });
  } finally {
    await rm(fixture, { recursive: true, force: true });
    for (const [path, digest] of Object.entries(before)) assert.equal(sha(await readFile(resolve(ROOT, path))), digest, 'Independent fixture changed live bytes: ' + path);
    console.log(JSON.stringify({ evidence: 'source_and_historical_bytes_unchanged', v5_manifest_sha256: before[`${E}/corrections-v5/manifest.json`] }));
  }
}, CURRENT_ROOT));
