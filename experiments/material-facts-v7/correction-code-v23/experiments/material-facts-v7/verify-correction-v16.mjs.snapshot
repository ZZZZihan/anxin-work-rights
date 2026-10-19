// Preserve the sixteenth post-freeze correction when later runtime fixes change
// acceptance. Its results and code are restored only in an owned temp tree.
import assert from 'node:assert/strict';
import { runHistoricalV16CheckSync } from './historical-v16-execution.mjs';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const EXPERIMENT = 'experiments/material-facts-v7';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function withCorrectionV16Code(action, root = ROOT) {
  const base = resolve(root, EXPERIMENT), snapshot = resolve(base, 'correction-code-v16');
  const correctionBytes = await readFile(resolve(base, 'corrections-v16/manifest.json'));
  const correction = JSON.parse(correctionBytes);
  const manifest = JSON.parse(await readFile(resolve(snapshot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.schema, 'material-facts-v7-correction-code/16');
  assert.equal(manifest.correction_directory, 'corrections-v16');
  assert.equal(manifest.storage_suffix, '.snapshot');
  assert.equal(manifest.correction_manifest_sha256, hash(correctionBytes));
  const expected = Object.keys(correction.code_sha256).sort();
  assert.deepEqual(Object.keys(manifest.files).sort(), expected, 'Correction snapshot omits or adds code paths');
  const archived = [];
  for (const path of expected) {
    assert(!path.startsWith('/') && path.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe correction snapshot path');
    const bytes = await readFile(resolve(snapshot, `${path}.snapshot`));
    assert.equal(hash(bytes), correction.code_sha256[path], `Correction code changed: ${path}`);
    assert.equal(manifest.files[path], correction.code_sha256[path]);
    archived.push([path, bytes]);
  }
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'anxin-v7-correction-v16-')));
  try {
    for (const path of ['lib', 'scripts', 'experiments', 'docs', 'package.json']) await cp(resolve(root, path), resolve(temporary, path), { recursive: true });
    for (const [path, bytes] of archived) {
      const target = resolve(temporary, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
    return await action(temporary);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && await realpath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 2, 'Historical correction verification is read-only');
  const receipt = await withCorrectionV16Code(async temporary => {
    const output = runHistoricalV16CheckSync(resolve(temporary, EXPERIMENT, 'corrective-assessment-v16.mjs'), ['--check'], {
      cwd: temporary, encoding: 'utf8', maxBuffer: 16 * 1024 ** 2, timeout: 180000,
    });
    const result = JSON.parse(output); assert.equal(result.status, 'PASS');
    return { status: 'PASS', execution: 'archived_correction_v16_code', current_code_claim: false,
      correction_manifest_sha256: hash(await readFile(resolve(temporary, EXPERIMENT, 'corrections-v16/manifest.json'))), model_requests: 0 };
  });
  console.log(JSON.stringify(receipt));
}
