import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { assess } from '../material-facts-v4/assess.mjs';

const base = fileURLToPath(new URL('./', import.meta.url));
const data = fileURLToPath(new URL('../material-facts-v4/data/', import.meta.url));
const jsonl = async path => (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const inputs = await jsonl(resolve(data, 'holdout.inputs.jsonl'));
const labels = await jsonl(resolve(data, 'holdout.labels.provisional.jsonl'));
export function stripExactOuterFence(raw) {
  if (typeof raw !== 'string') return raw;
  const match = /^\s*```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```\s*$/.exec(raw);
  return match && !match[1].includes('```') ? match[1] : raw;
}
const comparison = { scope: 'revealed_same_document_replication', training: false, documents: inputs.length,
  expected_facts: labels.reduce((n, row) => n + row.expected.length, 0), backends: {} };
for (const backend of ['rules', 'qwen', 'deepseek']) {
  const dir = resolve(base, 'results', `${backend}-1`);
  const rows = await jsonl(resolve(dir, 'results.jsonl'));
  const official = assess(inputs, labels, rows);
  const auxiliaryRows = rows.map(row => ({ ...row, raw_output: stripExactOuterFence(row.raw_output) }));
  const auxiliary = assess(inputs, labels, auxiliaryRows);
  const outcome = JSON.parse(await readFile(resolve(dir, 'outcome.json')));
  const events = backend === 'rules' ? [] : await jsonl(resolve(dir, 'events.jsonl'));
  const memory = events.filter(row => row.type === 'phase_memory');
  const usages = rows.map(row => row.usage).filter(Boolean);
  const summary = {
    planned: inputs.length, returned: rows.length, stopped_normally: official.completed,
    protocol_valid: official.protocol_valid, exact_documents: official.exact_documents,
    raw_candidates: official.raw_candidates, rejected_candidates: official.rejected_candidates,
    metrics: official.metrics,
    finish_reasons: rows.reduce((out, row) => ({ ...out, [row.finish_reason]: (out[row.finish_reason] ?? 0) + 1 }), {}),
    run_completed: outcome.completed,
    generation_seconds: rows.reduce((n, row) => n + (row.latency_seconds ?? 0), 0),
    processes_wall_seconds: outcome.attempts?.reduce((n, row) => n + row.seconds, 0) ?? null,
    connections_attempted: events.filter(row => row.type === 'transport' && row.event === 'transport_attempt').length,
    post_submissions_started: events.filter(row => row.type === 'transport' && row.event === 'send_started').length,
    max_mlx_peak_gib: memory.length ? Math.max(...memory.map(row => row.mlx_peak_bytes)) / 1024 ** 3 : null,
    observed_pressure_levels: [...new Set(memory.map(row => row.pressure_level))],
    billed_cost_verified: false,
    api_usage: usages.length ? usages.reduce((out, row) => {
      for (const key of ['prompt_tokens', 'completion_tokens', 'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens']) out[key] = (out[key] ?? 0) + (row[key] ?? 0);
      return out;
    }, {}) : null,
    auxiliary_fence_only: { changed_documents: rows.filter((row, i) => row.raw_output !== auxiliaryRows[i].raw_output).length,
      protocol_valid: auxiliary.protocol_valid, completed: auxiliary.completed, metrics: auxiliary.metrics,
      label: 'diagnostic_only_not_official_score_no_regeneration' },
  };
  const artifacts = { 'assessment.json': official, 'fence-only-assessment.json': auxiliary };
  for (const [name, content] of Object.entries(artifacts)) {
    const bytes = JSON.stringify(content, null, 2) + '\n';
    if (process.argv.includes('--check')) {
      if (await readFile(resolve(dir, name), 'utf8') !== bytes) throw new Error(`Assessment mismatch: ${backend}/${name}`);
    } else await writeFile(resolve(dir, name), bytes);
  }
  comparison.backends[backend] = summary;
}
const bytes = JSON.stringify(comparison, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (await readFile(resolve(base, 'comparison.json'), 'utf8') !== bytes) throw new Error('Comparison mismatch');
} else await writeFile(resolve(base, 'comparison.json'), bytes);
console.log(bytes);
