// A fifth, explicitly post-freeze assessment of the SAME original outputs.
// Preserve corrections v1, v2, v3 and v4 and verify their exact archived code before proceeding.
import assert from 'node:assert/strict';
import { publishArtifacts } from './publish-artifacts.mjs';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { computeCorrectionV4 } from './corrective-assessment-v4.mjs';
import { EXPERIMENT, ROOT, isMainModule, sha, same } from './freeze.mjs';

export async function computeCorrectionV5(root = ROOT) {
  const base = resolve(root, EXPERIMENT);
  const previous = JSON.parse(execFileSync(process.execPath, [resolve(base, 'verify-correction-v4.mjs')], {
    cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 ** 2,
  }));
  assert.equal(previous.status, 'PASS');
  const { artifacts, manifest } = await computeCorrectionV4(root);
  artifacts['comparison.json'] = { ...artifacts['comparison.json'], schema: 'material-facts-v7-postfreeze-correction/5',
    previous_correction_manifest_sha256: previous.correction_manifest_sha256,
    change_reason: 'Bound runner failure cleanup and diagnostics; serialize diagnostic runs and freeze publication, and bind original manifest bytes.' };
  const code = [`${EXPERIMENT}/verify-correction-v4.mjs`, `${EXPERIMENT}/corrective-assessment-v5.mjs`];
  const next = { ...manifest, schema: 'material-facts-v7-postfreeze-correction-manifest/5',
    previous_correction_manifest_sha256: previous.correction_manifest_sha256,
    code_sha256: { ...manifest.code_sha256, ...Object.fromEntries(await Promise.all(code.map(async path => [path, sha(await readFile(resolve(root, path)))]))) },
    files: Object.fromEntries(Object.entries(artifacts).map(([path, value]) => [path, sha(JSON.stringify(value, null, 2) + '\n')])) };
  return { artifacts, manifest: next };
}

if (await isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  assert(args.length === 1 && ['--write', '--check'].includes(args[0]), 'Expected --write or --check');
  const { artifacts, manifest } = await computeCorrectionV5();
  const directory = resolve(ROOT, EXPERIMENT, 'corrections-v5');
  if (args[0] === '--write') {
    await publishArtifacts(directory, { ...artifacts, 'manifest.json': manifest });
  } else {
    same((await readdir(directory)).sort(), [...Object.keys(artifacts), 'manifest.json'].sort(), 'Correction v5 file set changed');
    same(JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')), manifest, 'Correction v5 manifest changed');
    for (const [path, value] of Object.entries(artifacts)) {
      assert.equal(sha(await readFile(resolve(directory, path))), manifest.files[path], `Correction v5 bytes changed: ${path}`);
      same(JSON.parse(await readFile(resolve(directory, path), 'utf8')), value, `Correction v5 recomputation differs: ${path}`);
    }
  }
  console.log(JSON.stringify({ status: 'PASS', operation: args[0], first_run_and_corrections_v1_v2_v3_v4_preserved: true,
    model_requests: 0, new_holdout_run: false, original_manifest_sha256: manifest.first_result_manifest_sha256,
    previous_correction_manifest_sha256: manifest.previous_correction_manifest_sha256,
    corrected_models: artifacts['comparison.json'].models }));
}
