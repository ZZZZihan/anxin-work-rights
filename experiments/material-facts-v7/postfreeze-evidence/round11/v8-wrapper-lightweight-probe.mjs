import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const implementation = resolve(process.env.V8_WRAPPER_IMPLEMENTATION);
const root = resolve(process.env.V8_ARCHIVE_ROOT);
const E = 'experiments/material-facts-v7';
const { withCorrectionV8Code } = await import(pathToFileURL(implementation));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = await readFile(resolve(root, E, 'corrections-v8/manifest.json'));
const manifest = JSON.parse(manifestBytes);
assert.equal(sha(manifestBytes), '8fa3100c348a94af0471e93a5a2dab8d405df2dd4debc603b3fe3dbe89fac06b');
assert.equal(Object.keys(manifest.code_sha256).length, 43);
const sandbox = await realpath(await mkdtemp(resolve(tmpdir(), 'anxin-v8-wrapper-author-')));
let passes = 0;
try {
  for (const directory of ['lib', 'scripts', 'docs', `${E}/corrections-v8`]) await mkdir(resolve(sandbox, directory), { recursive: true });
  await writeFile(resolve(sandbox, 'package.json'), '{}\n');
  await cp(resolve(root, E, 'correction-code-v8'), resolve(sandbox, E, 'correction-code-v8'), { recursive: true });
  await writeFile(resolve(sandbox, E, 'corrections-v8/manifest.json'), manifestBytes);
  for (const path of Object.keys(manifest.code_sha256)) {
    await mkdir(dirname(resolve(sandbox, path)), { recursive: true });
    await writeFile(resolve(sandbox, path), '// Synthetic current byte drift; no source is executed.\n');
  }
  let owned;
  await withCorrectionV8Code(async temporary => {
    owned = temporary;
    for (const [path, digest] of Object.entries(manifest.code_sha256)) assert.equal(sha(await readFile(resolve(temporary, path))), digest, path);
  }, sandbox);
  await assert.rejects(readFile(resolve(owned, 'package.json')), { code: 'ENOENT' });
  console.log('PASS: all 43 archived code bytes restored despite live drift; normal cleanup'); passes++;

  const callbackError = new Error('synthetic callback failure');
  await assert.rejects(withCorrectionV8Code(async temporary => { owned = temporary; throw callbackError; }, sandbox), error => error === callbackError);
  await assert.rejects(readFile(resolve(owned, 'package.json')), { code: 'ENOENT' });
  console.log('PASS: callback failure preserved and temporary tree removed'); passes++;

  const target = resolve(sandbox, E, 'correction-code-v8/lib/material-fact-currency-review.ts.snapshot');
  const codeBytes = await readFile(target);
  for (const change of ['missing', 'bytes', 'extra-path', 'manifest-whitespace']) {
    const archiveManifest = resolve(sandbox, E, 'correction-code-v8/manifest.json');
    const archiveBytes = await readFile(archiveManifest);
    try {
      if (change === 'missing') await rm(target);
      if (change === 'bytes') await writeFile(target, Buffer.concat([codeBytes, Buffer.from('\n// synthetic byte drift\n')]));
      if (change === 'extra-path') {
        const altered = JSON.parse(archiveBytes); altered.files['lib/extra.ts'] = 'f'.repeat(64);
        await writeFile(archiveManifest, JSON.stringify(altered));
      }
      if (change === 'manifest-whitespace') await writeFile(resolve(sandbox, E, 'corrections-v8/manifest.json'), Buffer.concat([manifestBytes, Buffer.from('\n')]));
      let entered = false;
      await assert.rejects(withCorrectionV8Code(async () => { entered = true; }, sandbox));
      assert.equal(entered, false);
      console.log(`PASS: ${change} refused before callback`); passes++;
    } finally {
      await writeFile(target, codeBytes);
      await writeFile(archiveManifest, archiveBytes);
      await writeFile(resolve(sandbox, E, 'corrections-v8/manifest.json'), manifestBytes);
    }
  }
  for (const [path, digest] of Object.entries(manifest.code_sha256)) assert.equal(sha(await readFile(resolve(root, E, 'correction-code-v8', `${path}.snapshot`))), digest, path);
  assert.deepEqual(await readFile(resolve(root, E, 'corrections-v8/manifest.json')), manifestBytes);
  console.log(JSON.stringify({ status: 'PASS', tests: passes, archived_code_paths: 43, models: 0, historical_cli_executions: 0, original_v8_bytes_unchanged: true }));
} finally { await rm(sandbox, { recursive: true, force: true }); }
