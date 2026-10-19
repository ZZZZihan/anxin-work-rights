// A seventeenth, explicitly post-freeze assessment of the SAME original outputs.
// Restore v16 before checking it with a narrow adapter. The immutable v1 policy
// and older versioned bridges keep all children inside the same absolute deadline.
import assert from 'node:assert/strict';
import { publishArtifacts } from './publish-artifacts.mjs';
import { runHistoricalV16CheckSync } from './historical-v16-execution.mjs';
import { withCorrectionV16Code } from './verify-correction-v16.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { computeCorrection } from './corrective-assessment.mjs';
import { EXPERIMENT, ROOT, isMainModule, sha, same } from './freeze.mjs';

export async function computeCorrectionV17(root = ROOT) {
  const base = resolve(root, EXPERIMENT);
  const previous = await withCorrectionV16Code(async temporary => {
    const result = JSON.parse(runHistoricalV16CheckSync(resolve(temporary, EXPERIMENT, 'corrective-assessment-v16.mjs'), ['--check'], {
      cwd: temporary, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 ** 2,
    }));
    assert.equal(result.status, 'PASS');
    return { status: 'PASS', correction_manifest_sha256: sha(await readFile(resolve(temporary, EXPERIMENT, 'corrections-v16/manifest.json'))) };
  }, root);
  const { artifacts, manifest } = await computeCorrection(root);
  artifacts['comparison.json'] = { ...artifacts['comparison.json'], schema: 'material-facts-v7-postfreeze-correction/17',
    previous_correction_manifest_sha256: previous.correction_manifest_sha256,
    change_reason: 'Preserve exact amounts before explicit ordinary suffix words such as 起诉/多次/余额/许可 without weakening real post-amount bounds; keep explicit preposed wage denominators outside the supported RateUnit enum unavailable as payable totals, and do not let a supplied model subject consume an attached unsupported rate label; distinguish a complete numeric yuan amount followed by explicit 年终奖/年終獎 or 年假补偿/補償/工资/工資 payment purposes from ordinary 元年 and other compounds; preserve complete Unicode letter/number name boundaries consistently on Node 24 and Node 26 without authenticating a supplied subject. Also parse the finite traditional numeral aliases 兩/億 in a parsing copy while retaining range and crop guards; align comparison keys with the existing finite boundary qualifiers without merging strict upper/lower bounds; distinguish explicit weekday wage periods from daily rates; allow simplified/traditional spellings of the same finite wage-noun event wrappers. Additionally guard compact maximum/minimum and inside bounds, reject complete amount-free ratio and traditional wage descriptions, support only explicit RMB denomination/subunit literals with existing uncertainty safeguards, and keep HTTP interrupt handling active through cleanup. Also retain postposed uncertainty markers from original source context; keep traditional group/role detection aligned; recognize only explicit RMB conversion results and bounded recurring payment days; align traditional wage wrappers in deduplication and refuse named rate formula operands. Preserve raw evidence and all earlier results without new inference or calculation.' };
  // The archived v16 check verifies the complete previous chain. Compute the
  // current acceptance assessment once, without re-inference or score rewriting.
  const previousBytes = await readFile(resolve(base, 'corrections-v16/manifest.json'));
  assert.equal(sha(previousBytes), previous.correction_manifest_sha256);
  const code = [...Object.keys(JSON.parse(previousBytes).code_sha256),
    `${EXPERIMENT}/verify-correction-v16.mjs`, `${EXPERIMENT}/corrective-assessment-v17.mjs`,
    `${EXPERIMENT}/historical-v16-execution.mjs`];
  const next = { ...manifest, schema: 'material-facts-v7-postfreeze-correction-manifest/17',
    previous_correction_manifest_sha256: previous.correction_manifest_sha256,
    code_sha256: { ...manifest.code_sha256, ...Object.fromEntries(await Promise.all(code.map(async path => [path, sha(await readFile(resolve(root, path)))]))) },
    files: Object.fromEntries(Object.entries(artifacts).map(([path, value]) => [path, sha(JSON.stringify(value, null, 2) + '\n')])) };
  return { artifacts, manifest: next };
}

if (await isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  assert(args.length === 1 && ['--write', '--check'].includes(args[0]), 'Expected --write or --check');
  const { artifacts, manifest } = await computeCorrectionV17();
  const directory = resolve(ROOT, EXPERIMENT, 'corrections-v17');
  if (args[0] === '--write') {
    await publishArtifacts(directory, { ...artifacts, 'manifest.json': manifest });
  } else {
    same((await readdir(directory)).sort(), [...Object.keys(artifacts), 'manifest.json'].sort(), 'Correction v17 file set changed');
    const manifestBytes = await readFile(resolve(directory, 'manifest.json'));
    same(JSON.parse(manifestBytes), manifest, 'Correction v17 manifest changed');
    assert.equal(sha(manifestBytes), sha(JSON.stringify(manifest, null, 2) + '\n'), 'Correction v17 manifest bytes changed');
    for (const [path, value] of Object.entries(artifacts)) {
      assert.equal(sha(await readFile(resolve(directory, path))), manifest.files[path], `Correction v17 bytes changed: ${path}`);
      same(JSON.parse(await readFile(resolve(directory, path), 'utf8')), value, `Correction v17 recomputation differs: ${path}`);
    }
  }
  console.log(JSON.stringify({ status: 'PASS', operation: args[0], first_run_and_corrections_v1_v2_v3_v4_v5_v6_v7_v8_v9_v10_v11_v12_v13_v14_v15_v16_preserved: true,
    model_requests: 0, new_holdout_run: false, original_manifest_sha256: manifest.first_result_manifest_sha256,
    previous_correction_manifest_sha256: manifest.previous_correction_manifest_sha256,
    corrected_models: artifacts['comparison.json'].models }));
}
