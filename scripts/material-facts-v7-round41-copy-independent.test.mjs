import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? fileURLToPath(new URL('../', import.meta.url)));
const E = 'experiments/material-facts-v7';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const { withCorrectionV30Code } = await import(pathToFileURL(resolve(ROOT, E, 'verify-correction-v30.mjs')));
const expected = JSON.parse(await readFile(resolve(ROOT, E, 'corrections-v30/manifest.json'))).code_sha256;

test('bounded independent restoration keeps execution dependencies and omits only diagnostic attachments', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'anxin-r41-independent-copy-'));
  const owned = [];
  const sentinels = [
    [`${E}/postfreeze-evidence/private/sentinel.bin`, Buffer.from('diagnostic only')],
    [`${E}/postfreeze-evidence-kept/sentinel.bin`, Buffer.from('similar directory is retained')],
    [`${E}/review-evidence/independent-boundary.bin`, Buffer.from('review input retained')],
    ['docs/postfreeze-evidence/sentinel.bin', Buffer.from('same leaf name outside excluded root retained')],
  ];
  try {
    for (const dir of ['lib', 'scripts', 'experiments', 'docs']) await mkdir(resolve(fixture, dir), { recursive: true });
    for (const path of [...Object.keys(expected), 'package.json']) {
      await mkdir(dirname(resolve(fixture, path)), { recursive: true });
      await cp(resolve(ROOT, path), resolve(fixture, path));
    }
    for (const version of [29, 30]) {
      for (const path of [`${E}/correction-code-v${version}`, `${E}/corrections-v${version}/manifest.json`]) {
        await mkdir(dirname(resolve(fixture, path)), { recursive: true });
        await cp(resolve(ROOT, path), resolve(fixture, path), { recursive: true });
      }
    }
    for (const [path, bytes] of sentinels) {
      await mkdir(dirname(resolve(fixture, path)), { recursive: true });
      await writeFile(resolve(fixture, path), bytes, { flag: 'wx' });
    }
    // Current code must be restored from sealed bytes, not silently used as history.
    await writeFile(resolve(fixture, 'lib/material-money-v4.ts'), '// deliberate current fixture drift\n');
    await withCorrectionV30Code(async temporary => {
      owned.push(temporary);
      await assert.rejects(stat(resolve(temporary, E, 'postfreeze-evidence')), { code: 'ENOENT' });
      for (const [path, bytes] of sentinels.slice(1)) assert.deepEqual(await readFile(resolve(temporary, path)), bytes);
      for (const [path, digest] of Object.entries(expected)) assert.equal(hash(await readFile(resolve(temporary, path))), digest, path);
      const nestedPath = resolve(temporary, E, 'verify-correction-v29.mjs');
      const archivedSource = await readFile(nestedPath, 'utf8');
      assert(!archivedSource.includes('filter: source =>'), 'The restored historical wrapper must retain original unfiltered bytes');
      const { withCorrectionV29Code } = await import(pathToFileURL(nestedPath));
      await withCorrectionV29Code(async nested => {
        owned.push(nested);
        await assert.rejects(stat(resolve(nested, E, 'postfreeze-evidence')), { code: 'ENOENT' });
        for (const [path, bytes] of sentinels.slice(1)) assert.deepEqual(await readFile(resolve(nested, path)), bytes);
      }, temporary);
    }, fixture);
    for (const directory of owned) await assert.rejects(stat(directory), { code: 'ENOENT' });
    for (const [path, bytes] of sentinels) assert.deepEqual(await readFile(resolve(fixture, path)), bytes);

    const marker = new Error('independent callback failure');
    await assert.rejects(withCorrectionV30Code(async temporary => { owned.push(temporary); throw marker; }, fixture), error => error === marker);
    for (const directory of owned) await assert.rejects(stat(directory), { code: 'ENOENT' });

    const archivePath = resolve(fixture, E, 'correction-code-v30/lib/material-money-v4.ts.snapshot');
    await writeFile(archivePath, '// tampered sealed archive\n');
    let callbackCalled = false;
    await assert.rejects(withCorrectionV30Code(async () => { callbackCalled = true; }, fixture), /Correction code changed/);
    assert.equal(callbackCalled, false);
    assert.equal(await readFile(resolve(fixture, 'lib/material-money-v4.ts'), 'utf8'), '// deliberate current fixture drift\n');
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
