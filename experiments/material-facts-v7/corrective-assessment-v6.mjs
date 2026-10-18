// A sixth, explicitly post-freeze assessment of the SAME original outputs.
// Preserve corrections v1, v2, v3, v4 and v5 and verify their exact archived code before proceeding.
import assert from 'node:assert/strict';
import { publishArtifacts } from './publish-artifacts.mjs';
import { runHistoricalCheckSync } from './historical-execution-v1.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { computeCorrection } from './corrective-assessment.mjs';
import { EXPERIMENT, ROOT, isMainModule, sha, same } from './freeze.mjs';

export async function computeCorrectionV6(root = ROOT) {
  const base = resolve(root, EXPERIMENT);
  const previous = JSON.parse(runHistoricalCheckSync(resolve(base, 'verify-correction-v5.mjs'), [], {
    cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 ** 2,
  }));
  assert.equal(previous.status, 'PASS');
  const { artifacts, manifest } = await computeCorrection(root);
  artifacts['comparison.json'] = { ...artifacts['comparison.json'], schema: 'material-facts-v7-postfreeze-correction/6',
    previous_correction_manifest_sha256: previous.correction_manifest_sha256,
    change_reason: 'Reject finite source currency attribution, wage-noun arithmetic and explicit wage-rate labels; preserve incomplete worker streams as failures.' };
  // The archived v5 check already verifies the entire old chain. Reassess once
  // with the current base scorer, instead of recursively reassessing it per version.
  const previousBytes = await readFile(resolve(base, 'corrections-v5/manifest.json'));
  assert.equal(sha(previousBytes), previous.correction_manifest_sha256);
  const code = [...Object.keys(JSON.parse(previousBytes).code_sha256),
    `${EXPERIMENT}/verify-correction-v5.mjs`, `${EXPERIMENT}/corrective-assessment-v6.mjs`];
  const next = { ...manifest, schema: 'material-facts-v7-postfreeze-correction-manifest/6',
    previous_correction_manifest_sha256: previous.correction_manifest_sha256,
    code_sha256: { ...manifest.code_sha256, ...Object.fromEntries(await Promise.all(code.map(async path => [path, sha(await readFile(resolve(root, path)))]))) },
    files: Object.fromEntries(Object.entries(artifacts).map(([path, value]) => [path, sha(JSON.stringify(value, null, 2) + '\n')])) };
  return { artifacts, manifest: next };
}

if (await isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  assert(args.length === 1 && ['--write', '--check'].includes(args[0]), 'Expected --write or --check');
  const { artifacts, manifest } = await computeCorrectionV6();
  const directory = resolve(ROOT, EXPERIMENT, 'corrections-v6');
  if (args[0] === '--write') {
    await publishArtifacts(directory, { ...artifacts, 'manifest.json': manifest });
  } else {
    same((await readdir(directory)).sort(), [...Object.keys(artifacts), 'manifest.json'].sort(), 'Correction v6 file set changed');
    same(JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')), manifest, 'Correction v6 manifest changed');
    for (const [path, value] of Object.entries(artifacts)) {
      assert.equal(sha(await readFile(resolve(directory, path))), manifest.files[path], `Correction v6 bytes changed: ${path}`);
      same(JSON.parse(await readFile(resolve(directory, path), 'utf8')), value, `Correction v6 recomputation differs: ${path}`);
    }
  }
  console.log(JSON.stringify({ status: 'PASS', operation: args[0], first_run_and_corrections_v1_v2_v3_v4_v5_preserved: true,
    model_requests: 0, new_holdout_run: false, original_manifest_sha256: manifest.first_result_manifest_sha256,
    previous_correction_manifest_sha256: manifest.previous_correction_manifest_sha256,
    corrected_models: artifacts['comparison.json'].models }));
}
