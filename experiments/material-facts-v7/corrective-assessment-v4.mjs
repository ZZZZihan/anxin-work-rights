// A fourth, explicitly post-freeze assessment of the SAME original outputs.
// Preserve corrections v1, v2 and v3 and verify its exact archived code before proceeding.
import assert from 'node:assert/strict';
import { publishArtifacts } from './publish-artifacts.mjs';
import { runHistoricalCheckSync } from './historical-execution-v1.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { computeCorrectionV3 } from './corrective-assessment-v3.mjs';
import { EXPERIMENT, ROOT, isMainModule, sha, same } from './freeze.mjs';

export async function computeCorrectionV4(root = ROOT) {
  const base = resolve(root, EXPERIMENT);
  const previous = JSON.parse(runHistoricalCheckSync(resolve(base, 'verify-correction-v3.mjs'), [], {
    cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 ** 2,
  }));
  assert.equal(previous.status, 'PASS');
  const { artifacts, manifest } = await computeCorrectionV3(root);
  artifacts['comparison.json'] = { ...artifacts['comparison.json'], schema: 'material-facts-v7-postfreeze-correction/4',
    previous_correction_manifest_sha256: previous.correction_manifest_sha256,
    change_reason: 'Do not expose an operand as the exact amount when its attached multiplier or arithmetic expression has been cropped.' };
  const code = [`${EXPERIMENT}/verify-correction-v3.mjs`, `${EXPERIMENT}/corrective-assessment-v4.mjs`];
  const next = { ...manifest, schema: 'material-facts-v7-postfreeze-correction-manifest/4',
    previous_correction_manifest_sha256: previous.correction_manifest_sha256,
    code_sha256: { ...manifest.code_sha256, ...Object.fromEntries(await Promise.all(code.map(async path => [path, sha(await readFile(resolve(root, path)))]))) },
    files: Object.fromEntries(Object.entries(artifacts).map(([path, value]) => [path, sha(JSON.stringify(value, null, 2) + '\n')])) };
  return { artifacts, manifest: next };
}

if (await isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  assert(args.length === 1 && ['--write', '--check'].includes(args[0]), 'Expected --write or --check');
  const { artifacts, manifest } = await computeCorrectionV4();
  const directory = resolve(ROOT, EXPERIMENT, 'corrections-v4');
  if (args[0] === '--write') {
    await publishArtifacts(directory, { ...artifacts, 'manifest.json': manifest });
  } else {
    same((await readdir(directory)).sort(), [...Object.keys(artifacts), 'manifest.json'].sort(), 'Correction v4 file set changed');
    same(JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')), manifest, 'Correction v4 manifest changed');
    for (const [path, value] of Object.entries(artifacts)) {
      assert.equal(sha(await readFile(resolve(directory, path))), manifest.files[path], `Correction v4 bytes changed: ${path}`);
      same(JSON.parse(await readFile(resolve(directory, path), 'utf8')), value, `Correction v4 recomputation differs: ${path}`);
    }
  }
  console.log(JSON.stringify({ status: 'PASS', operation: args[0], first_run_and_corrections_v1_v2_v3_preserved: true,
    model_requests: 0, new_holdout_run: false, original_manifest_sha256: manifest.first_result_manifest_sha256,
    previous_correction_manifest_sha256: manifest.previous_correction_manifest_sha256,
    corrected_models: artifacts['comparison.json'].models }));
}
