// Descriptive aggregation only. Matching and runtime decisions remain in assess.mjs.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { BACKENDS, COUNTS, EXPERIMENT, ROOT, isMainModule, json, jsonl, same } from './freeze.mjs';
import { withExperimentLock } from './experiment-lock.mjs';
import { publishImmutableFile } from './immutable-artifact-publication.mjs';

const counts = values => values.reduce((result, value) => { result[value] = (result[value] ?? 0) + 1; return result; }, {});
const optionalLines = async path => { try { return await jsonl(path); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } };
const metricNames = ['raw_basic', 'accepted_basic', 'raw_relational', 'accepted_relational', 'raw_strict', 'accepted_strict'];

/** Reads reports and receipts, never source/label files or model credentials. */
export async function buildSummary(root = ROOT) {
  const summary = { schema: 'material-facts-v7-comparison/1', scope: 'frozen_new_case_grouped_public_text_v4_event_bound',
    training: false, labels: 'provisional_non_expert', dev_documents: COUNTS.dev, dev_facts: COUNTS.dev_facts,
    holdout_documents: COUNTS.holdout, holdout_facts: COUNTS.holdout_facts, case_families: COUNTS.case_families,
    source_documents: COUNTS.source_documents, natural_empty_documents: COUNTS.natural_empty, models: {} };
  for (const backend of BACKENDS) {
    const directory = resolve(root, EXPERIMENT, `results/holdout-${backend}-1`);
    const report = await json(resolve(directory, 'report.json')), outcome = await json(resolve(directory, 'outcome.json'));
    const rows = await jsonl(resolve(directory, 'results.jsonl')), events = await optionalLines(resolve(directory, 'events.jsonl'));
    assert.equal(report.planned_documents, COUNTS.holdout, `${backend} planned denominator differs`);
    assert.equal(report.expected_facts, COUNTS.holdout_facts, `${backend} fact denominator differs`);
    assert(Array.isArray(report.cases) && report.cases.length === COUNTS.holdout, `${backend} report is missing planned cases`);
    same(Object.keys(report.metrics).sort(), [...metricNames].sort(), `${backend} must report all six metrics`);
    const cases = report.cases, defense = cases.flatMap(row => row.production_defense);
    assert(defense.every(row => row && row.calculation_authorized === false), `${backend} comparison cannot grant calculation authorization`);
    const value = {
      planned: report.planned_documents, returned: report.returned, completed: report.completed,
      native_json: report.native_json, protocol_valid: report.protocol_valid, exact_documents: report.exact_documents,
      raw_candidates: report.raw_candidates, accepted_candidates: report.accepted_candidates, rejected_candidates: report.rejected_candidates,
      review_issues: report.review_issues, metrics: report.metrics,
      event_alignment: Object.fromEntries(['raw', 'accepted'].map(layer => [layer, counts(cases.flatMap(row => row.event_alignment[layer].map(event => event.status)))])),
      production_defense: { candidates: defense.length, kind: counts(defense.map(row => row.kind)),
        normalization_status: counts(defense.map(row => row.normalization)), issue_codes: counts(defense.flatMap(row => row.issues)),
        amount_present: defense.filter(row => row.amount !== null).length,
        exact_money_without_review_issue: defense.filter(row => row.exact_money_without_review_issue).length,
        calculation_authorized: 0, calculation_not_authorized: defense.length },
      coverage_status: counts(cases.map(row => row.coverage?.status ?? 'unavailable')),
      normalization_status: counts(cases.flatMap(row => row.normalization.map(item => item.status))),
      review_issue_codes: counts(cases.flatMap(row => row.review_issues.map(issue => issue.code))),
      unique_attribute_mismatches: counts(cases.flatMap(row => row.attribute_errors.flatMap(pair => pair.mismatches))),
      ambiguous_attribute_pairs: cases.flatMap(row => row.attribute_errors).filter(pair => pair.ambiguous).length,
      rejection_reasons: counts(cases.flatMap(row => row.rejected.map(item => item.reason))),
      case_errors: counts(cases.flatMap(row => row.errors)), finish_reasons: counts(rows.map(row => row.finish_reason)),
      latency_sum_seconds: rows.reduce((sum, row) => sum + (row.latency_seconds ?? 0), 0),
      process_seconds: (outcome.attempts ?? []).reduce((sum, row) => sum + (row.seconds ?? 0), 0), batch_completed: outcome.completed,
    };
    if (backend === 'qwen') {
      const memory = await optionalLines(resolve(directory, 'memory.jsonl'));
      value.memory = { pressure_levels: [...new Set(memory.map(row => row.level))], samples: memory.length,
        swap_first_bytes: memory[0]?.swap_used_bytes ?? null, swap_max_bytes: memory.length ? Math.max(...memory.map(row => row.swap_used_bytes)) : null,
        peak_mlx_gib: Math.max(0, ...events.filter(row => row.type === 'phase_memory').map(row => (row.mlx_peak_bytes ?? 0) / 1024 ** 3),
          ...rows.map(row => row.peak_memory_gib ?? row.peak_memory_gb ?? 0)) };
    }
    if (backend === 'deepseek') {
      const protocol = await json(resolve(directory, 'protocol.json')), transport = await optionalLines(resolve(directory, 'transport-attempts.jsonl'));
      value.transport = { route: protocol.deepseek.egress, connection_attempts: transport.filter(row => row.event === 'transport_attempt').length,
        post_attempts: transport.filter(row => row.event === 'send_started').length,
        ssh_closed: protocol.deepseek.egress === 'direct' ? null : (await json(resolve(directory, 'egress.json'))).ssh_closed };
      value.usage = rows.reduce((sum, row) => ({ prompt_tokens: sum.prompt_tokens + (row.usage?.prompt_tokens ?? 0),
        completion_tokens: sum.completion_tokens + (row.usage?.completion_tokens ?? 0) }), { prompt_tokens: 0, completion_tokens: 0 });
      value.reserved_peak_usd_upper = Math.max(0, ...events.filter(row => row.type === 'outcome').map(row => row.reserved_peak_usd_upper ?? 0));
    }
    summary.models[backend] = value;
  }
  return summary;
}

if (await isMainModule(import.meta.url)) {
  try {
    const options = process.argv.slice(2);
    assert(options.length <= 1 && options.every(value => value === '--check'), 'Expected no arguments or --check');
    await withExperimentLock(ROOT, 'summary', async () => {
      const summary = await buildSummary(), destination = resolve(ROOT, EXPERIMENT, 'comparison.json');
      if (options.includes('--check')) same(await json(destination), summary, 'Comparison changed');
      else {
        const publication = await publishImmutableFile(destination, JSON.stringify(summary, null, 2) + '\n');
        if (!publication.temporary_removed) console.warn(JSON.stringify({ status: 'PUBLISHED_CLEANUP_WARNING', publication }));
      }
      console.log(JSON.stringify(summary, null, 2));
    });
  } catch (error) { console.error(JSON.stringify({ status: 'FAIL', error: error.message })); process.exitCode = 1; }
}
