import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const prepared = process.env.V7_PREPARED_ROOT;
assert(prepared, 'V7_PREPARED_ROOT is required');
const experiment = 'experiments/material-facts-v7';
const { withCorrectionV27Code } = await import(pathToFileURL(resolve(prepared, experiment, 'verify-correction-v27.mjs')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fixture = await mkdtemp(resolve(tmpdir(), 'anxin-data-v28-wrapper-fixture-'));
let restoredRoot;
const sentinel = new Error('independent-v28-wrapper-callback-sentinel');
try {
  for (const path of ['lib', 'scripts', 'experiments', 'docs']) await mkdir(resolve(fixture, path), { recursive: true });
  await writeFile(resolve(fixture, 'package.json'), '{"private":true,"type":"module"}\n');
  const correction = resolve(fixture, experiment, 'corrections-v27/manifest.json');
  await mkdir(dirname(correction), { recursive: true });
  await cp(resolve(prepared, experiment, 'corrections-v27/manifest.json'), correction);
  await cp(resolve(prepared, experiment, 'correction-code-v27'), resolve(fixture, experiment, 'correction-code-v27'), { recursive: true });
  const manifest = JSON.parse(await readFile(correction, 'utf8'));
  assert.equal(Object.keys(manifest.code_sha256).length, 100);
  const overwritten = Object.keys(manifest.code_sha256).find(path => path.startsWith('lib/'));
  assert(overwritten);
  await mkdir(dirname(resolve(fixture, overwritten)), { recursive: true });
  await writeFile(resolve(fixture, overwritten), 'independent live fixture placeholder\n');
  let caught;
  try {
    await withCorrectionV27Code(async restored => {
      restoredRoot = restored;
      for (const [path, expected] of Object.entries(manifest.code_sha256)) {
        assert.equal(hash(await readFile(resolve(restored, path))), expected, path);
      }
      assert.notEqual(hash(await readFile(resolve(fixture, overwritten))), manifest.code_sha256[overwritten]);
      throw sentinel;
    }, fixture);
  } catch (error) { caught = error; }
  assert.equal(caught, sentinel, 'Original callback error identity must survive');
  assert(restoredRoot);
  await assert.rejects(stat(restoredRoot), { code: 'ENOENT' });
  await assert.rejects(stat(resolve(restoredRoot, 'package.json')), { code: 'ENOENT' });
  console.log(JSON.stringify({ status: 'PASS', restored_paths: 100, callback_error_identity_preserved: true,
    owned_restore_directory_removed: true, caller_fixture_unchanged: true,
    historical_cli_executions: 0, model_requests: 0 }));
} finally {
  await rm(fixture, { recursive: true, force: true });
}
