// Post-freeze correction of the SAME first outputs. No requests, new labels,
// retries or overwrite of the original reports. This is not another holdout run.
import assert from 'node:assert/strict';
import { publishArtifacts } from './publish-artifacts.mjs';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assess, readJsonl } from './assess.mjs';
import { BACKENDS, EXPERIMENT, ROOT, RUN_HASH_FILES, isMainModule, sha, same } from './freeze.mjs';
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const codePaths = [...RUN_HASH_FILES, `${EXPERIMENT}/verify-frozen.mjs`, `${EXPERIMENT}/corrective-assessment.mjs`, `${EXPERIMENT}/publish-artifacts.mjs`];

export async function computeCorrection(root = ROOT) {
  const base = resolve(root, EXPERIMENT);
  // Verify the immutable first run using its own code before reading evidence.
  const original = JSON.parse(execFileSync(process.execPath, [resolve(base, 'verify-frozen.mjs')], {
    cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 ** 2,
  }));
  assert.equal(original.status, 'PASS');
  const inputs = await readJsonl(resolve(base, 'data/holdout.inputs.jsonl'));
  const labels = await readJsonl(resolve(base, 'data/holdout.labels.provisional.jsonl'));
  const artifacts = {}, models = {}, evidence = {};
  for (const backend of BACKENDS) {
    const dir = resolve(base, `results/holdout-${backend}-1`);
    const rows = await readJsonl(resolve(dir, 'results.jsonl'));
    const first = await json(resolve(dir, 'report.json'));
    const corrected = assess(inputs, labels, rows);
    artifacts[`report-${backend}.json`] = corrected;
    evidence[backend] = { raw_sha256: sha(await readFile(resolve(dir, 'results.jsonl'))),
      first_report_sha256: sha(await readFile(resolve(dir, 'report.json'))) };
    models[backend] = { first_run_metrics: first.metrics, corrected_metrics: corrected.metrics,
      raw_candidates: corrected.raw_candidates, accepted_candidates: corrected.accepted_candidates,
      rejected_candidates: corrected.rejected_candidates,
      delta: Object.fromEntries(Object.keys(first.metrics).map(mode => [mode, Object.fromEntries(['tp','fp','fn'].map(key => [key, corrected.metrics[mode][key] - first.metrics[mode][key]]))])),
      changed_cases: corrected.cases.filter((row, index) => JSON.stringify(row) !== JSON.stringify(first.cases[index])).map(row => row.id) };
  }
  artifacts['comparison.json'] = { schema: 'material-facts-v7-postfreeze-correction/1', inference: false, new_holdout_run: false,
    labels: 'unchanged_provisional_non_expert', planned_per_backend: 12, expected_facts: 43,
    first_result_manifest_sha256: original.result_manifest_sha256, models };
  const files = Object.fromEntries(Object.entries(artifacts).map(([path, value]) => [path, sha(JSON.stringify(value, null, 2) + '\n')]));
  const manifest = { schema: 'material-facts-v7-postfreeze-correction-manifest/1', inference: false, training: false,
    freeze_sha256: sha(await readFile(resolve(base, 'freeze.json'))), first_result_manifest_sha256: original.result_manifest_sha256,
    input_sha256: sha(await readFile(resolve(base, 'data/holdout.inputs.jsonl'))),
    labels_sha256: sha(await readFile(resolve(base, 'data/holdout.labels.provisional.jsonl'))), evidence,
    code_sha256: Object.fromEntries(await Promise.all(codePaths.map(async path => [path, sha(await readFile(resolve(root, path)))]))), files };
  return { artifacts, manifest };
}

if (await isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  assert(args.length === 1 && ['--write', '--check'].includes(args[0]), 'Expected --write or --check');
  const { artifacts, manifest } = await computeCorrection();
  const directory = resolve(ROOT, EXPERIMENT, 'corrections');
  if (args[0] === '--write') {
    await publishArtifacts(directory, { ...artifacts, 'manifest.json': manifest });
  } else {
    same((await readdir(directory)).sort(), [...Object.keys(artifacts), 'manifest.json'].sort(), 'Correction file set changed');
    same(await json(resolve(directory, 'manifest.json')), manifest, 'Correction manifest changed');
    for (const [path, value] of Object.entries(artifacts)) {
      assert.equal(sha(await readFile(resolve(directory, path))), manifest.files[path], `Correction bytes changed: ${path}`);
      same(await json(resolve(directory, path)), value, `Correction recomputation differs: ${path}`);
    }
  }
  console.log(JSON.stringify({ status: 'PASS', operation: args[0], first_run_preserved: true, model_requests: 0,
    original_manifest_sha256: manifest.first_result_manifest_sha256, corrected_models: artifacts['comparison.json'].models }));
}
