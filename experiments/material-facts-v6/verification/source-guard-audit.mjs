// Post-freeze production diagnostics only. Never edits formal scores or model output.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { validateCandidateOutput } from '../../../lib/material-facts-v3.ts';
import { reviewCandidateAgainstSource } from '../../../lib/material-fact-source-review.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const experiment = resolve(root, 'experiments/material-facts-v6');
const rows = async path => (await readFile(path, 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
const sha = value => createHash('sha256').update(value).digest('hex');
const inputs = await rows(resolve(experiment, 'data/holdout.inputs.jsonl'));
const inputsById = new Map(inputs.map(input => [input.id, input]));
const report = { scope: 'post_freeze_source_guard_diagnostic_not_formal_metric', training: false, model_calls: 0,
  formal_scores_changed: false, expected_documents: inputs.length, code_sha256: {}, models: {} };
for (const path of ['lib/material-fact-source-review.ts', 'lib/material-facts-v3.ts']) report.code_sha256[path] = sha(await readFile(resolve(root, path)));
for (const backend of ['rules', 'qwen', 'deepseek']) {
  const resultPath = resolve(experiment, `results/holdout-${backend}-1/results.jsonl`);
  const results = await rows(resultPath);
  const diagnostic = { results_sha256: sha(await readFile(resultPath)), returned: results.length, completed: 0, candidates: 0, changed_candidates: 0,
    precision_downgrades: 0, added_issue_counts: {}, changes: [], skipped: [] };
  for (const result of results) {
    assert(inputsById.has(result.id), 'Unexpected case in post-freeze audit');
    if (result.finish_reason !== 'stop') { diagnostic.skipped.push({ id: result.id, finish_reason: result.finish_reason }); continue; }
    const input = inputsById.get(result.id);
    let batch;
    try { batch = validateCandidateOutput(result.raw_output, input.source); }
    catch { diagnostic.skipped.push({ id: result.id, finish_reason: result.finish_reason, reason: 'invalid_protocol' }); continue; }
    diagnostic.completed++;
    for (const candidate of batch.candidates) {
      diagnostic.candidates++;
      const guarded = reviewCandidateAgainstSource(candidate, input.source);
      const originalCodes = new Set(candidate.reviewIssues.map(issue => issue.code));
      const added = guarded.reviewIssues.filter(issue => !originalCodes.has(issue.code));
      const downgraded = candidate.amount !== null && guarded.amount === null;
      if (!added.length && !downgraded) continue;
      diagnostic.changed_candidates++;
      if (downgraded) diagnostic.precision_downgrades++;
      for (const issue of added) diagnostic.added_issue_counts[issue.code] = (diagnostic.added_issue_counts[issue.code] ?? 0) + 1;
      diagnostic.changes.push({ id: result.id, candidate_id: candidate.id, value: candidate.value,
        original_amount: candidate.amount, guarded_amount: guarded.amount,
        original_normalization: candidate.normalization.status, guarded_normalization: guarded.normalization?.status ?? null,
        added_issues: added });
    }
  }
  report.models[backend] = diagnostic;
}
await writeFile(resolve(experiment, 'verification/source-guard-audit.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(report.models).map(([key, value]) => [key, {
  returned: value.returned, completed: value.completed, changed_candidates: value.changed_candidates,
  precision_downgrades: value.precision_downgrades, added_issue_counts: value.added_issue_counts,
}]))));
