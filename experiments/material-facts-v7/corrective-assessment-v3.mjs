// A third, explicitly post-freeze assessment of the SAME original outputs.
// Preserve corrections v1 and v2 and verify its exact archived code before proceeding.
import assert from 'node:assert/strict';
import { publishArtifacts } from './publish-artifacts.mjs';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { computeCorrectionV2 } from './corrective-assessment-v2.mjs';
import { EXPERIMENT, ROOT, isMainModule, sha, same } from './freeze.mjs';

export async function computeCorrectionV3(root = ROOT) {
  const base = resolve(root, EXPERIMENT);
  const previous = JSON.parse(execFileSync(process.execPath, [resolve(base, 'verify-correction-v2.mjs')], {
    cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 ** 2,
  }));
  assert.equal(previous.status, 'PASS');
  const { artifacts, manifest } = await computeCorrectionV2(root);
  artifacts['comparison.json'] = { ...artifacts['comparison.json'], schema: 'material-facts-v7-postfreeze-correction/3',
    previous_correction_manifest_sha256: previous.correction_manifest_sha256,
    change_reason: 'Validate backend prerequisites and completed development attempts, archive all frozen executables, and publish complete correction artifacts atomically.' };
  const code = [`${EXPERIMENT}/verify-correction-v2.mjs`, `${EXPERIMENT}/corrective-assessment-v3.mjs`];
  const next = { ...manifest, schema: 'material-facts-v7-postfreeze-correction-manifest/3',
    previous_correction_manifest_sha256: previous.correction_manifest_sha256,
    code_sha256: { ...manifest.code_sha256, ...Object.fromEntries(await Promise.all(code.map(async path => [path, sha(await readFile(resolve(root, path)))]))) },
    files: Object.fromEntries(Object.entries(artifacts).map(([path, value]) => [path, sha(JSON.stringify(value, null, 2) + '\n')])) };
  return { artifacts, manifest: next };
}

if (await isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  assert(args.length === 1 && ['--write', '--check'].includes(args[0]), 'Expected --write or --check');
  const { artifacts, manifest } = await computeCorrectionV3();
  const directory = resolve(ROOT, EXPERIMENT, 'corrections-v3');
  if (args[0] === '--write') {
    await publishArtifacts(directory, { ...artifacts, 'manifest.json': manifest });
  } else {
    same((await readdir(directory)).sort(), [...Object.keys(artifacts), 'manifest.json'].sort(), 'Correction v3 file set changed');
    same(JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')), manifest, 'Correction v3 manifest changed');
    for (const [path, value] of Object.entries(artifacts)) {
      assert.equal(sha(await readFile(resolve(directory, path))), manifest.files[path], `Correction v3 bytes changed: ${path}`);
      same(JSON.parse(await readFile(resolve(directory, path), 'utf8')), value, `Correction v3 recomputation differs: ${path}`);
    }
  }
  console.log(JSON.stringify({ status: 'PASS', operation: args[0], first_run_and_corrections_v1_v2_preserved: true,
    model_requests: 0, new_holdout_run: false, original_manifest_sha256: manifest.first_result_manifest_sha256,
    previous_correction_manifest_sha256: manifest.previous_correction_manifest_sha256,
    corrected_models: artifacts['comparison.json'].models }));
}
