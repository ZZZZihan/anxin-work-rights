// A thirty-second, explicitly post-freeze assessment of the SAME original outputs.
// Restore v31 before checking it with a narrow adapter. The immutable v1 policy
// and older versioned bridges keep all children inside the same absolute deadline.
import assert from 'node:assert/strict';
import { publishArtifacts } from './publish-artifacts.mjs';
import { runHistoricalV31CheckSync } from './historical-v31-execution.mjs';
import { withCorrectionV31Code } from './verify-correction-v31.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { computeCorrection } from './corrective-assessment.mjs';
import { EXPERIMENT, ROOT, isMainModule, sha, same } from './freeze.mjs';

export async function computeCorrectionV32(root = ROOT) {
  const base = resolve(root, EXPERIMENT);
  const previous = await withCorrectionV31Code(async temporary => {
    const result = JSON.parse(runHistoricalV31CheckSync(resolve(temporary, EXPERIMENT, 'corrective-assessment-v31.mjs'), ['--check'], {
      cwd: temporary, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 ** 2,
    }));
    assert.equal(result.status, 'PASS');
    return { status: 'PASS', correction_manifest_sha256: sha(await readFile(resolve(temporary, EXPERIMENT, 'corrections-v31/manifest.json'))) };
  }, root);
  const { artifacts, manifest } = await computeCorrection(root);
  artifacts['comparison.json'] = { ...artifacts['comparison.json'], schema: 'material-facts-v7-postfreeze-correction/32',
    previous_correction_manifest_sha256: previous.correction_manifest_sha256,
    change_reason: "Assessment CLI publication repair only: stage and sync complete report bytes, atomically publish without replacing an existing path or following a destination symlink, and retain failed staging evidence. Preserve all original outputs, labels, archived code, scores and failures; no new inference or training." };
  // The archived v31 check verifies the complete previous chain. Compute the
  // current acceptance assessment once, without re-inference or score rewriting.
  const previousBytes = await readFile(resolve(base, 'corrections-v31/manifest.json'));
  assert.equal(sha(previousBytes), previous.correction_manifest_sha256);
  const code = [...Object.keys(JSON.parse(previousBytes).code_sha256),
    `${EXPERIMENT}/verify-correction-v31.mjs`, `${EXPERIMENT}/corrective-assessment-v32.mjs`,
    `${EXPERIMENT}/historical-v31-execution.mjs`, `${EXPERIMENT}/immutable-artifact-publication.mjs`];
  const next = { ...manifest, schema: 'material-facts-v7-postfreeze-correction-manifest/32',
    previous_correction_manifest_sha256: previous.correction_manifest_sha256,
    code_sha256: { ...manifest.code_sha256, ...Object.fromEntries(await Promise.all(code.map(async path => [path, sha(await readFile(resolve(root, path)))]))) },
    files: Object.fromEntries(Object.entries(artifacts).map(([path, value]) => [path, sha(JSON.stringify(value, null, 2) + '\n')])) };
  return { artifacts, manifest: next };
}

if (await isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  assert(args.length === 1 && ['--write', '--check'].includes(args[0]), 'Expected --write or --check');
  const { artifacts, manifest } = await computeCorrectionV32();
  const directory = resolve(ROOT, EXPERIMENT, 'corrections-v32');
  if (args[0] === '--write') {
    await publishArtifacts(directory, { ...artifacts, 'manifest.json': manifest });
  } else {
    same((await readdir(directory)).sort(), [...Object.keys(artifacts), 'manifest.json'].sort(), 'Correction v32 file set changed');
    const manifestBytes = await readFile(resolve(directory, 'manifest.json'));
    same(JSON.parse(manifestBytes), manifest, 'Correction v32 manifest changed');
    assert.equal(sha(manifestBytes), sha(JSON.stringify(manifest, null, 2) + '\n'), 'Correction v32 manifest bytes changed');
    for (const [path, value] of Object.entries(artifacts)) {
      assert.equal(sha(await readFile(resolve(directory, path))), manifest.files[path], `Correction v32 bytes changed: ${path}`);
      same(JSON.parse(await readFile(resolve(directory, path), 'utf8')), value, `Correction v32 recomputation differs: ${path}`);
    }
  }
  console.log(JSON.stringify({ status: 'PASS', operation: args[0], first_run_and_corrections_v1_v2_v3_v4_v5_v6_v7_v8_v9_v10_v11_v12_v13_v14_v15_v16_v17_v18_v19_v20_v21_v22_v23_v24_v25_v26_v27_v28_v29_v30_v31_preserved: true,
    model_requests: 0, new_holdout_run: false, original_manifest_sha256: manifest.first_result_manifest_sha256,
    previous_correction_manifest_sha256: manifest.previous_correction_manifest_sha256,
    corrected_models: artifacts['comparison.json'].models }));
}
