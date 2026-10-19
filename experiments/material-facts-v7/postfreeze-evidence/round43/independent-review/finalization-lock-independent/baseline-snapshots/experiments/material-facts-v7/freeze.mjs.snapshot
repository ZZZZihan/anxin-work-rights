import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkFileHashes, filesUnder, json, jsonl, safePath, same, sha } from '../material-facts-v6/freeze.mjs';
import { withExperimentLock } from './experiment-lock.mjs';

export { checkFileHashes, filesUnder, json, jsonl, safePath, same, sha };
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const EXPERIMENT = 'experiments/material-facts-v7';
export const LEGACY = 'experiments/material-facts-v6';
export const BACKENDS = ['rules', 'qwen', 'deepseek'];
export const COUNTS = { dev: 3, holdout: 12, dev_facts: 13, holdout_facts: 43, case_families: 15, source_documents: 7, natural_empty: 2 };
export const QWEN_MEMORY = { allocator_guideline_gib: 24, wired_gib: 20, cache_mib: 512, prefill_step_size: 128, kv_bits: 4, kv_group_size: 64, quantized_kv_start: 0, critical: 'immediate_stop', warning: '10_seconds', swap_growth_gib: 4, case_timeout_seconds: 600 };
export const RUN_HASH_FILES = ['lib/material-facts.ts', 'lib/material-fact-types.ts', 'lib/material-facts-v2.ts', 'lib/material-fact-types-v2.ts', 'lib/material-facts-v3.ts', 'lib/material-fact-types-v3.ts',
  'lib/material-money-v4.ts', 'lib/material-fact-range-review.ts', 'lib/material-fact-arithmetic-review.ts', 'lib/material-fact-extraction-v4.ts', 'lib/material-fact-source-review.ts', 'lib/material-fact-runtime-ingest.ts',
  'lib/material-fact-event-review.ts', 'lib/material-fact-currency-review.ts', 'lib/material-fact-coverage-review.ts',
  'scripts/fact-runtime-v2.py', 'scripts/fact_memory_runtime.py', 'scripts/fact_api_transport.py', `${EXPERIMENT}/run.mjs`, `${EXPERIMENT}/assess.mjs`, `${EXPERIMENT}/freeze.mjs`, `${EXPERIMENT}/experiment-lock.mjs`, `${EXPERIMENT}/verify.mjs`, `${EXPERIMENT}/summarize.mjs`, `${EXPERIMENT}/runtime-policy.json`, `${EXPERIMENT}/immutable-artifact-publication.mjs`];
export const REQUIRED_FILES = [...RUN_HASH_FILES, 'scripts/material-fact-conjunction-range.test.mjs', 'scripts/material-fact-named-arithmetic-subunits.test.mjs', 'scripts/material-fact-currency-computation-review.test.mjs', 'scripts/material-facts-v7-round11-money-independent.test.mjs', 'lib/material-money-v4.test.ts', 'lib/material-money-v4.independent.test.ts', 'lib/material-money-v4.review-regression.test.ts',
  'lib/material-fact-source-review.test.ts', 'lib/material-facts-v7-runtime-independent.test.ts', 'lib/material-fact-calendar-money.test.ts',
  'lib/material-fact-store.ts', 'scripts/fact-jobs.mjs', 'scripts/material-facts-v7-assessment-independent.test.mjs', 'scripts/material-facts-v7-freeze-independent.test.mjs', 'scripts/material-facts-v7-run-readiness.test.mjs', 'scripts/material-facts-v7-run-lifecycle.test.mjs', 'scripts/material-facts-v7-run-monitor-drain.test.mjs', 'scripts/material-facts-v7-monitor-independent.test.mjs', 'scripts/material-facts-v7-historical-execution.test.mjs', 'scripts/material-facts-v7-history-policy-independent.test.mjs', 'scripts/material-facts-v7-freeze-lock.test.mjs', 'scripts/material-facts-v7-freeze-atomic-publication.test.mjs', 'scripts/material-facts-v7-run-reserved-name.test.mjs', 'scripts/material-facts-v7-outcome-stream.test.mjs', 'scripts/material-facts-v7-http-regression.mjs',
  `${EXPERIMENT}/PROTOCOL.md`, `${EXPERIMENT}/ANNOTATION.md`, `${EXPERIMENT}/model-identity.json`, `${EXPERIMENT}/api-models-preflight.json`, `${EXPERIMENT}/annotation-review.independent.json`,
  `${EXPERIMENT}/technical-review.json`, `${EXPERIMENT}/technical-review.initial.json`, `${EXPERIMENT}/benchmark-review.independent.json`, `${EXPERIMENT}/benchmark-review.initial.json`, `${EXPERIMENT}/verify.mjs`, `${EXPERIMENT}/summarize.mjs`, `${EXPERIMENT}/SOURCE_REVIEW.md`, `${EXPERIMENT}/REVIEW.md`, `${EXPERIMENT}/DEVELOPMENT.md`,
  `${LEGACY}/verify.mjs`, `${LEGACY}/freeze.mjs`, `${LEGACY}/freeze.json`, `${LEGACY}/result-manifest.json`];
const canonicalUrl = value => { if (!value) return null; const url = new URL(value); url.hash = ''; url.search = ''; return url.href; };

export async function isMainModule(moduleUrl) {
  if (!process.argv[1]) return false;
  try { return moduleUrl === pathToFileURL(await realpath(resolve(process.argv[1]))).href; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export function verifyLegacy(root) {
  // Preserve the entire immutable v6 verifier, including its recursive v5/v4 checks.
  const output = execFileSync(process.execPath, [resolve(root, LEGACY, 'verify.mjs')], { cwd: root, encoding: 'utf8', stdio: 'pipe', maxBuffer: 16 * 1024 ** 2, timeout: 60000 });
  const receipt = JSON.parse(output.trim());
  assert.equal(receipt.status, 'PASS', 'Complete old v6 verification failed');
  return { script: `${LEGACY}/verify.mjs`, status: 'PASS', output_sha256: sha(output), result_files: receipt.result_files, result_manifest_sha256: receipt.result_manifest_sha256 };
}

export async function loadPolicy(root = ROOT) {
  const policy = await json(resolve(root, EXPERIMENT, 'runtime-policy.json'));
  assert.equal(policy.schema, 'material-facts-v7-runtime-policy/1', 'Unsupported runtime-policy schema');
  assert(Number.isFinite(Date.parse(policy.checked_at)), 'Runtime policy has no dated verification');
  const fixed = { model: 'deepseek-v4-pro', thinking: 'disabled', reserved_upper_usd: 2, input_usd_per_million: 1.32, output_usd_per_million: 3.96 };
  for (const [key, expected] of Object.entries(fixed)) assert.equal(policy.deepseek?.[key], expected, `Verified DeepSeek policy differs from bounded worker: ${key}`);
  assert(['direct', 'temporary_loopback_ssh_test_host'].includes(policy.deepseek.egress), 'Unverified egress route');
  assert(/^https:\/\/api-docs\.deepseek\.com\//u.test(policy.deepseek.pricing_source), 'Pricing requires an official source');
  assert(/^\d{4}-\d{2}-\d{2}$/u.test(policy.deepseek.pricing_checked), 'Missing dated pricing verification');
  assert.equal(policy.deepseek.availability_receipt, 'api-models-preflight.json', 'Unknown availability receipt');
  const availability = await json(resolve(root, EXPERIMENT, policy.deepseek.availability_receipt));
  assert(Number.isFinite(Date.parse(availability.at)), 'Availability check has no date');
  assert.equal(availability.method, 'GET'); assert.equal(availability.endpoint, 'https://api.deepseek.com/models');
  assert.equal(availability.http_status, 200); assert.equal(availability.generation_requests, 0); assert.equal(availability.certificate_verification, true);
  assert.equal(availability.egress, policy.deepseek.egress, 'Availability route differs from selected route');
  assert(availability.models?.includes(policy.deepseek.model), 'Selected model is not in the official model listing');
  return policy;
}

export async function validateQwenIdentity(root = ROOT) {
  const current = await json(resolve(root, EXPERIMENT, 'model-identity.json'));
  const legacy = await json(resolve(root, LEGACY, 'model-identity.json'));
  for (const key of ['repository', 'revision', 'packages', 'source-manifest.json', 'weights-verification.json']) same(current[key], legacy[key], `Qwen verified identity differs from v6: ${key}`);
  assert(Number.isFinite(Date.parse(current.verified_at)), 'Qwen requires a current dated identity check');
  assert.equal(current.current_file_stat_fingerprints_verified, true, 'Current Qwen file fingerprints are not verified');
  assert.equal(current.generation_requests, 0, 'Identity receipt must come from the no-generation preflight');
  return current;
}

export function deepseekReservation(messages, policy) {
  return messages.reduce((sum, row) => {
    assert(Array.isArray(row.messages) && row.messages.every(message => typeof message.content === 'string'), 'Invalid request messages');
    const upper = row.messages.reduce((bytes, message) => bytes + Buffer.byteLength(message.content), 0) + 1024;
    assert(upper <= 85000, 'DeepSeek input exceeds worker reservation bound');
    return sum + upper * policy.deepseek.input_usd_per_million / 1e6 + 4096 * policy.deepseek.output_usd_per_million / 1e6;
  }, 0);
}

/** Conservatively reserve every planned request, including stopped/failed batches.
 * Call while holding the runner's directory lock when adding a new attempt.
 */
export async function priorDeepseekReservation(root, policy) {
  let entries;
  try { entries = await readdir(resolve(root, EXPERIMENT, 'results'), { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
  let total = 0;
  for (const entry of entries) {
    if (entry.name === '.deepseek-budget.lock') continue;
    assert(entry.isDirectory() && !entry.isSymbolicLink(), 'Unexpected result entry or symlink');
    const directory = resolve(root, EXPERIMENT, 'results', entry.name);
    const protocol = await json(resolve(directory, 'protocol.json'));
    assert(BACKENDS.includes(protocol.backend), 'Existing attempt has no backend identity');
    if (protocol.backend !== 'deepseek') continue;
    for (const key of ['model', 'input_usd_per_million', 'output_usd_per_million']) assert.equal(protocol.deepseek?.[key], policy.deepseek[key], 'Existing attempt has incompatible cost policy');
    total += deepseekReservation(await jsonl(resolve(directory, 'messages.jsonl')), policy);
  }
  assert(total <= policy.deepseek.reserved_upper_usd, 'Earlier v7 attempts exhausted the total reserved budget');
  return total;
}

/** Data are inspected programmatically; no holdout candidate, quote or label is printed. */
export async function validateData(root, { dataDirectory = resolve(root, EXPERIMENT, 'data') } = {}) {
  const domain = await import(pathToFileURL(resolve(root, 'lib/material-facts-v3.ts')).href);
  const scorer = await import(pathToFileURL(resolve(root, EXPERIMENT, 'assess.mjs')).href);
  const selected = await json(resolve(dataDirectory, 'sources.selected.json'));
  assert(Array.isArray(selected.sources) && selected.sources.length === 15, 'Expected fifteen selected case records');
  assert.equal(new Set(selected.sources.map(row => row.id)).size, 15, 'Duplicate selected source ID');
  assert.equal(new Set(selected.sources.map(row => canonicalUrl(row.url))).size, 7, 'Expected seven source-document dependencies');
  const sets = {};
  for (const split of ['dev', 'holdout']) {
    const inputs = await jsonl(resolve(dataDirectory, `${split}.inputs.jsonl`));
    const labels = await jsonl(resolve(dataDirectory, `${split}.labels.provisional.jsonl`));
    assert.equal(inputs.length, COUNTS[split], `Wrong ${split} document count`);
    assert.equal(new Set(inputs.map(row => row.id)).size, inputs.length, `Duplicate ${split} ID`);
    same(inputs.map(row => row.id), labels.map(row => row.id), `${split} input/label IDs differ`);
    let facts = 0, alternatives = 0;
    for (let index = 0; index < inputs.length; index++) {
      const input = inputs[index], label = labels[index];
      assert(typeof input.id === 'string' && input.id && typeof input.family_id === 'string' && input.family_id, `${split} missing identifiers`);
      domain.validateFactSource(input.source);
      assert.equal(input.source.ready, true, `${split} source is not ready`);
      assert.equal(input.source.sha256, sha(input.source.blocks.map(block => block.text).join('\n\n')), `${split} excerpt hash mismatch`);
      const source = selected.sources.find(row => row.id === input.source_id);
      assert(source && source.split === split && source.family_id === input.family_id && source.material_id === input.id, `${split} selected case binding differs`);
      assert.equal(source.excerpt_sha256, input.source.sha256, `${split} selected excerpt differs`);
      assert.equal(canonicalUrl(source.url), canonicalUrl(input.origin?.url), `${split} source URL differs`);
      assert(typeof input.origin?.case_id === 'string' && input.origin.case_id, `${split} case identity is missing`);
      assert.equal(source.case_id, input.origin.case_id, `${split} selected case identity differs`);
      assert.equal(label.schemaVersion, 3); assert.equal(label.label_status, 'provisional_non_expert');
      scorer.validateLabel(input, label);
      for (const alternative of label.acceptable_alternatives ?? []) {
        assert(typeof alternative.reason === 'string' && alternative.reason.trim(), `${split} alternative lacks a predeclared rationale`);
        alternatives += alternative.candidates.length;
      }
      facts += label.expected.length;
    }
    assert.equal(facts, COUNTS[`${split}_facts`], `${split} fixed fact denominator changed`);
    sets[split] = { inputs, labels, facts, alternatives };
  }
  const current = [...sets.dev.inputs, ...sets.holdout.inputs];
  assert.equal([...sets.dev.labels, ...sets.holdout.labels].filter(label => !label.expected.length).length, COUNTS.natural_empty, 'Natural-empty denominator changed');
  for (const field of ['id', 'source_id', 'family_id']) assert.equal(new Set(current.map(row => row[field])).size, 15, `Case/split overlap: ${field}`);
  assert.equal(new Set(current.map(row => row.origin.case_id)).size, 15, 'Case identities overlap');
  assert.equal(new Set(current.map(row => row.source.sha256)).size, 15, 'New excerpts repeat');
  const oldInputs = [];
  for (const version of [4, 5, 6]) for (const split of ['dev', 'holdout']) oldInputs.push(...await jsonl(resolve(root, `experiments/material-facts-v${version}/data/${split}.inputs.jsonl`)));
  for (const field of ['id', 'source_id', 'family_id']) {
    const old = new Set(oldInputs.map(row => row[field]).filter(Boolean));
    assert(current.every(row => !old.has(row[field])), `New cases overlap v4-v6: ${field}`);
  }
  const oldCases = new Set(oldInputs.map(row => row.origin?.case_id).filter(Boolean));
  const oldExcerpts = new Set(oldInputs.map(row => row.source?.sha256).filter(Boolean));
  assert(current.every(row => !oldCases.has(row.origin.case_id) && !oldExcerpts.has(row.source.sha256)), 'New case or excerpt overlaps v4-v6');
  const review = await json(resolve(root, EXPERIMENT, 'annotation-review.independent.json'));
  assert.equal(review.status, 'passed_non_expert_pre_run_technical_review');
  assert.equal(review.no_model_answers_read, true); assert.equal(review.no_model_requests_made, true); assert.equal(review.no_training_or_deployment, true);
  assert(Array.isArray(review.blocking_source_or_label_issues) && !review.blocking_source_or_label_issues.length, 'Independent annotation review has blockers');
  for (const [file, hash] of Object.entries(review.reviewed_data_sha256 ?? {})) assert.equal(sha(await readFile(safePath(dataDirectory, file))), hash, 'Data changed after independent annotation review');
  const requiredReviewed = ['dev.inputs.jsonl', 'dev.labels.provisional.jsonl', 'holdout.inputs.jsonl', 'holdout.labels.provisional.jsonl', 'sources.selected.json'];
  assert(requiredReviewed.every(path => Object.hasOwn(review.reviewed_data_sha256 ?? {}, path)), 'Independent review omits data or labels');
  return { sets, domain, summary: { ...COUNTS, alternatives: sets.dev.alternatives + sets.holdout.alternatives } };
}

export async function messageBytes(inputs, root = ROOT) {
  const { buildExtractionMessagesV4 } = await import(pathToFileURL(resolve(root, 'lib/material-fact-extraction-v4.ts')).href);
  assert(typeof buildExtractionMessagesV4 === 'function', 'New extraction prompt is missing');
  return inputs.map(input => JSON.stringify({ id: input.id, messages: buildExtractionMessagesV4(input.source) })).join('\n') + '\n';
}

/** Completion is transport/process readiness, never a candidate-quality filter. */
export async function validateDevelopmentCompletion(directory, protocol) {
  const { backend, case_ids: ids } = protocol;
  assert(BACKENDS.includes(backend), 'Unknown development backend');
  assert(Array.isArray(ids) && ids.length > 0 && new Set(ids).size === ids.length, 'Development protocol has invalid case IDs');
  const outcome = await json(resolve(directory, 'outcome.json'));
  assert.equal(outcome.completed, true, 'Development outcome is not successfully complete');
  const bytes = await readFile(resolve(directory, 'results.jsonl'), 'utf8');
  assert(bytes.trim() && bytes.endsWith('\n'), 'Development terminal results are empty or truncated');
  const rows = bytes.slice(0, -1).split('\n').map(line => { assert(line.trim(), 'Development terminal results contain an empty record'); return JSON.parse(line); });
  same(rows.map(row => row?.id), ids, 'Development terminal results do not cover protocol case IDs exactly once in order');
  assert(rows.every(row => row.backend === backend && row.finish_reason === 'stop' && typeof row.raw_output === 'string'
    && !Object.hasOwn(row, 'original_finish_reason')), 'Development terminal result is failed or differs from its backend protocol');
  assert(!(await readdir(directory)).some(name => /^partial-stdout-\d+\.txt$/u.test(name)), 'Development worker stdout is truncated');
  if (backend !== 'rules') {
    const isolation = backend === 'qwen' ? 'fresh_process_per_document' : 'sequential_requests';
    assert.equal(outcome.isolation ?? isolation, isolation, 'Development process isolation differs');
    assert(Array.isArray(outcome.attempts) && outcome.attempts.length === (backend === 'qwen' ? ids.length : 1), 'Development process attempts are incomplete');
    const batches = backend === 'qwen' ? ids.map(id => [id]) : [ids];
    for (let index = 0; index < batches.length; index++) {
      const attempt = outcome.attempts[index];
      same(attempt.ids, batches[index], 'Development process attempt IDs differ from protocol');
      assert(attempt.completed === true && attempt.code === 0 && attempt.signal == null && attempt.stop_reason == null
        && attempt.incomplete_stdout === false, 'Development process attempt did not finish successfully and completely');
    }
  }
  return { backend, cases: rows.length };
}

export async function validateDevelopment(root, inputs, { allowFormal = false } = {}) {
  const entries = await readdir(resolve(root, EXPERIMENT, 'results'), { withFileTypes: true });
  const expectedInput = sha(await readFile(resolve(root, EXPERIMENT, 'data/dev.inputs.jsonl')));
  const expectedMessages = await messageBytes(inputs, root), expectedIds = inputs.map(row => row.id);
  const current = Object.fromEntries(await Promise.all(RUN_HASH_FILES.map(async path => [path, sha(await readFile(safePath(root, path)))])));
  const verifiedBackends = new Set();
  const notReady = [];
  for (const entry of entries) {
    assert(entry.isDirectory() && !entry.isSymbolicLink(), 'Unexpected development result entry');
    if (allowFormal && BACKENDS.some(backend => entry.name === `holdout-${backend}-1`)) continue;
    assert(!entry.name.startsWith('holdout-'), 'Formal attempt exists before freezing');
    const directory = resolve(root, EXPERIMENT, 'results', entry.name), protocol = await json(resolve(directory, 'protocol.json'));
    assert.equal(protocol.mode, 'diagnostic', 'Pre-freeze attempt is not diagnostic');
    assert(BACKENDS.includes(protocol.backend), 'Unknown development backend');
    assert.equal(protocol.input_sha256, expectedInput, 'Pre-freeze attempt used inputs other than the registered development cases');
    same(protocol.case_ids, expectedIds, 'Pre-freeze attempt used non-development IDs');
    assert.equal(await readFile(resolve(directory, 'messages.jsonl'), 'utf8'), expectedMessages, 'Pre-freeze messages differ from registered development cases/prompt');
    // Preserve failed historical attempts; they cannot establish readiness even
    // when their protocol was written with the current code hash.
    try {
      await validateDevelopmentCompletion(directory, protocol);
      if (RUN_HASH_FILES.every(path => protocol.hashes?.[path] === current[path])) verifiedBackends.add(protocol.backend);
    } catch { notReady.push(entry.name); }
  }
  assert(BACKENDS.every(backend => verifiedBackends.has(backend)), `Every backend needs a successful complete development attempt using the final pre-freeze code; not ready: ${notReady.join(', ')}`);
  return { backends: [...verifiedBackends].sort(), input_sha256: expectedInput, messages_sha256: sha(expectedMessages) };
}

export async function createFreeze(root = ROOT) {
  // Diagnostic runners hold the same lock through their terminal writes. This
  // snapshot cannot race a new allocation or a still-running attempt's output.
  return withExperimentLock(root, 'freeze', async () => {
  const destination = resolve(root, EXPERIMENT, 'freeze.json');
  try { await lstat(destination); throw new Error('freeze.json already exists; never overwrite a frozen experiment'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let results = [];
  try { results = await readdir(resolve(root, EXPERIMENT, 'results')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert(!results.some(name => name.startsWith('holdout-')), 'A formal attempt exists before freezing');
  assert(!results.includes('.deepseek-budget.lock'), 'An active or interrupted DeepSeek reservation requires reconciliation');
  const validation = await validateData(root), legacy = verifyLegacy(root), policy = await loadPolicy(root);
  const developmentValidation = await validateDevelopment(root, validation.sets.dev.inputs);
  const plannedMessages = (await messageBytes([...validation.sets.dev.inputs, ...validation.sets.holdout.inputs], root)).trim().split('\n').map(JSON.parse);
  const plannedUpper = deepseekReservation(plannedMessages, policy);
  const priorUpper = await priorDeepseekReservation(root, policy);
  const holdoutMessages = (await messageBytes(validation.sets.holdout.inputs, root)).trim().split('\n').map(JSON.parse);
  assert(priorUpper + deepseekReservation(holdoutMessages, policy) <= policy.deepseek.reserved_upper_usd, 'Formal requests would exceed the total v7 budget');
  assert(plannedUpper <= policy.deepseek.reserved_upper_usd, 'Planned development plus holdout exceeds budget');
  for (const path of ['SOURCE_REVIEW.md', 'REVIEW.md', 'DEVELOPMENT.md']) assert((await readFile(resolve(root, EXPERIMENT, path), 'utf8')).trim(), `Missing review: ${path}`);
  const qwen = await validateQwenIdentity(root);
  const review = await json(resolve(root, EXPERIMENT, 'technical-review.json'));
  assert.equal(review.status, 'passed_independent_pre_run_technical_review');
  assert(Array.isArray(review.blocking_findings) && !review.blocking_findings.length, 'Technical review has blockers');
  await checkFileHashes(root, review.reviewed_sha256);
  const benchmarkReview = await json(resolve(root, EXPERIMENT, 'benchmark-review.independent.json'));
  assert.equal(benchmarkReview.status, 'passed_independent_pre_run_benchmark_review');
  assert(Array.isArray(benchmarkReview.blocking_findings) && !benchmarkReview.blocking_findings.length, 'Benchmark review has blockers');
  await checkFileHashes(root, benchmarkReview.reviewed_sha256);
  const files = {};
  const development = results.length ? await filesUnder(root, `${EXPERIMENT}/results`) : [];
  const reviewEvidence = await filesUnder(root, `${EXPERIMENT}/review-evidence`);
  for (const path of [...new Set([...REQUIRED_FILES, ...await filesUnder(root, `${EXPERIMENT}/data`), ...development, ...reviewEvidence])].sort()) files[path] = sha(await readFile(safePath(root, path)));
  const freeze = { schema: 'material-facts-v7-freeze/1', schemaVersion: 3, frozen_at: new Date().toISOString(), formal_calls_started: false, training: false, adapters: null,
    scope: 'new_case_grouped_public_text_holdout_v4', labels: 'provisional_non_expert', deepseek_egress: policy.deepseek.egress, policy,
    development: developmentValidation, deepseek_budget: { planned_dev_and_holdout_upper_usd: plannedUpper, prior_reserved_upper_usd: priorUpper, total_limit_usd: policy.deepseek.reserved_upper_usd }, ...validation.summary,
    case_ids: validation.sets.holdout.inputs.map(row => row.id), dev_case_ids: validation.sets.dev.inputs.map(row => row.id),
    input_sha256: sha(await readFile(resolve(root, EXPERIMENT, 'data/holdout.inputs.jsonl'))), messages_sha256: sha(await messageBytes(validation.sets.holdout.inputs, root)),
    dev_input_sha256: sha(await readFile(resolve(root, EXPERIMENT, 'data/dev.inputs.jsonl'))), dev_messages_sha256: sha(await messageBytes(validation.sets.dev.inputs, root)), qwen, legacy, files };
  // A direct exclusive write can leave a truncated immutable freeze on ENOSPC
  // or process death. Stage complete bytes in the same directory, then link to
  // the final name atomically. Unlike rename(), link() never replaces a prior
  // destination. The shared experiment lock covers staging through publication.
  const { open, link, unlink } = await import('node:fs/promises');
  const { randomUUID } = await import('node:crypto');
  const temporaryName = `.freeze-${process.pid}-${randomUUID()}`;
  const temporary = resolve(root, EXPERIMENT, `${temporaryName}.tmp`);
  const failureRecord = resolve(root, EXPERIMENT, `${temporaryName}.failure.json`);
  let handle = null, published = false, stage = 'open';
  try {
    handle = await open(temporary, 'wx', 0o600);
    stage = 'write'; await handle.writeFile(JSON.stringify(freeze, null, 2) + '\n');
    stage = 'sync'; await handle.sync();
    stage = 'close'; await handle.close(); handle = null;
    stage = 'publish'; await link(temporary, destination); published = true;
    stage = 'cleanup'; await unlink(temporary);
  } catch (error) {
    const failures = [error];
    if (handle) { try { await handle.close(); } catch (closeError) { failures.push(closeError); } }
    // Failed stages are evidence, never garbage to delete automatically. A
    // SIGKILL cannot write this receipt; its unique temp and owner lock remain.
    const describe = failure => ({ name: failure.name, code: failure.code, message: failure.message });
    let receiptWritten = false;
    try {
      await writeFile(failureRecord, JSON.stringify({ schema: 'material-facts-v7-freeze-publication-failure/1', at: new Date().toISOString(),
        temporary_file: `${temporaryName}.tmp`, stage, published, errors: failures.map(describe) }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      receiptWritten = true;
    } catch (receiptError) { failures.push(receiptError); }
    if (published) {
      // link() is the commit boundary. Cleanup cannot roll back or relabel this
      // complete immutable freeze as unpublished; retain evidence and report it.
      console.warn(JSON.stringify({ status: 'FROZEN_CLEANUP_WARNING', published: true, stage,
        temporary_file: `${temporaryName}.tmp`, failure_receipt: `${temporaryName}.failure.json`, receipt_written: receiptWritten, errors: failures.map(describe) }));
      return freeze;
    }
    const message = `Freeze publication failed at ${stage}: ${failures.map(failure => failure.message).join('; ')}. Retain ${temporaryName}.tmp and ${temporaryName}.failure.json for reconciliation.`;
    if (failures.length > 1) throw new AggregateError(failures, message);
    const failure = new Error(message, { cause: error }); failure.code = error.code; throw failure;
  }
  return freeze;
  });
}

if (await isMainModule(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 2, 'freeze.mjs takes no arguments and requires completed pre-run review');
    const freeze = await createFreeze();
    console.log(JSON.stringify({ status: 'FROZEN', dev: freeze.dev, holdout: freeze.holdout, frozen_files: Object.keys(freeze.files).length, inference: false, training: false }));
  } catch (error) { console.error(JSON.stringify({ status: 'FAIL', error: error.message })); process.exitCode = 1; }
}
