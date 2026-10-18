// A seventh, explicitly post-freeze assessment of the SAME original outputs.
// Preserve corrections v1, v2, v3, v4, v5 and v6 and verify their exact archived code before proceeding.
import assert from 'node:assert/strict';
import { publishArtifacts } from './publish-artifacts.mjs';
import { runHistoricalCheckSync } from './historical-execution-v1.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { computeCorrection } from './corrective-assessment.mjs';
import { EXPERIMENT, ROOT, isMainModule, sha, same } from './freeze.mjs';

export async function computeCorrectionV7(root = ROOT) {
  const base = resolve(root, EXPERIMENT);
  const previous = JSON.parse(runHistoricalCheckSync(resolve(base, 'verify-correction-v6.mjs'), [], {
    cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 ** 2,
  }));
  assert.equal(previous.status, 'PASS');
  const { artifacts, manifest } = await computeCorrection(root);
  artifacts['comparison.json'] = { ...artifacts['comparison.json'], schema: 'material-facts-v7-postfreeze-correction/7',
    previous_correction_manifest_sha256: previous.correction_manifest_sha256,
    change_reason: 'Publish freeze atomically without overwriting evidence; reject reserved control names and verify canonical manifest bytes.' };
  // The archived v6 check already verifies the entire old chain. Reassess once
  // with the current base scorer, instead of recursively reassessing it per version.
  const previousBytes = await readFile(resolve(base, 'corrections-v6/manifest.json'));
  assert.equal(sha(previousBytes), previous.correction_manifest_sha256);
  const code = [...Object.keys(JSON.parse(previousBytes).code_sha256),
    `${EXPERIMENT}/verify-correction-v6.mjs`, `${EXPERIMENT}/corrective-assessment-v7.mjs`];
  const next = { ...manifest, schema: 'material-facts-v7-postfreeze-correction-manifest/7',
    previous_correction_manifest_sha256: previous.correction_manifest_sha256,
    code_sha256: { ...manifest.code_sha256, ...Object.fromEntries(await Promise.all(code.map(async path => [path, sha(await readFile(resolve(root, path)))]))) },
    files: Object.fromEntries(Object.entries(artifacts).map(([path, value]) => [path, sha(JSON.stringify(value, null, 2) + '\n')])) };
  return { artifacts, manifest: next };
}

if (await isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  assert(args.length === 1 && ['--write', '--check'].includes(args[0]), 'Expected --write or --check');
  const { artifacts, manifest } = await computeCorrectionV7();
  const directory = resolve(ROOT, EXPERIMENT, 'corrections-v7');
  if (args[0] === '--write') {
    await publishArtifacts(directory, { ...artifacts, 'manifest.json': manifest });
  } else {
    same((await readdir(directory)).sort(), [...Object.keys(artifacts), 'manifest.json'].sort(), 'Correction v7 file set changed');
    const manifestBytes = await readFile(resolve(directory, 'manifest.json'));
    same(JSON.parse(manifestBytes), manifest, 'Correction v7 manifest changed');
    assert.equal(sha(manifestBytes), sha(JSON.stringify(manifest, null, 2) + '\n'), 'Correction v7 manifest bytes changed');
    for (const [path, value] of Object.entries(artifacts)) {
      assert.equal(sha(await readFile(resolve(directory, path))), manifest.files[path], `Correction v7 bytes changed: ${path}`);
      same(JSON.parse(await readFile(resolve(directory, path), 'utf8')), value, `Correction v7 recomputation differs: ${path}`);
    }
  }
  console.log(JSON.stringify({ status: 'PASS', operation: args[0], first_run_and_corrections_v1_v2_v3_v4_v5_v6_preserved: true,
    model_requests: 0, new_holdout_run: false, original_manifest_sha256: manifest.first_result_manifest_sha256,
    previous_correction_manifest_sha256: manifest.previous_correction_manifest_sha256,
    corrected_models: artifacts['comparison.json'].models }));
}
