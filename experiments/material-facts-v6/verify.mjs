import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BACKENDS, EXPERIMENT, REQUIRED_FILES, ROOT, RUN_HASH_FILES, checkFileHashes, filesUnder, json, jsonl, messageBytes, same, sha, validateData, verifyLegacy } from './freeze.mjs';

const GIB = 1024 ** 3;
const QWEN_MEMORY = { allocator_guideline_gib: 24, wired_gib: 20, cache_mib: 512, prefill_step_size: 128, kv_bits: 4, kv_group_size: 64, quantized_kv_start: 0, critical: 'immediate_stop', warning: '10_seconds', swap_growth_gib: 4, case_timeout_seconds: 600 };
const pythonJson = value => Array.isArray(value) ? `[${value.map(pythonJson).join(', ')}]` : value && typeof value === 'object' ? `{${Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)}: ${pythonJson(entry)}`).join(', ')}}` : JSON.stringify(value);
const optionalJsonl = async path => { try { return await jsonl(path); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } };
const prefix = (ids, expected) => ids.every((id, index) => id === expected[index]);

export async function verifyPreflight(root = ROOT) {
  const freeze = await json(resolve(root, EXPERIMENT, 'freeze.json'));
  assert.equal(freeze.schema, 'material-facts-v6-freeze/1'); assert.equal(freeze.schemaVersion, 3);
  assert.equal(freeze.training, false); assert.equal(freeze.adapters, null); assert.equal(freeze.formal_calls_started, false);
  assert.equal(freeze.dev, 3); assert.equal(freeze.holdout, 8);
  assert.equal(freeze.deepseek_egress, 'direct');
  assert(Number.isFinite(Date.parse(freeze.frozen_at)), 'Invalid freeze time');
  assert(REQUIRED_FILES.every(path => Object.hasOwn(freeze.files, path)), 'Freeze omits a required artifact');
  await checkFileHashes(root, freeze.files);
  const dataPaths = await filesUnder(root, `${EXPERIMENT}/data`);
  same(Object.keys(freeze.files).filter(path => path.startsWith(`${EXPERIMENT}/data/`)).sort(), dataPaths, 'Data file coverage changed after freeze');
  const validation = await validateData(root);
  const legacy = verifyLegacy(root);
  same(legacy, freeze.legacy, 'Old v5 verification receipt changed');
  same(freeze.qwen, await json(resolve(root, EXPERIMENT, 'model-identity.json')), 'Frozen Qwen identity changed');
  for (const split of ['dev', 'holdout']) {
    const ids = validation.sets[split].inputs.map(row => row.id), key = split === 'holdout' ? '' : 'dev_';
    same(ids, freeze[`${key}case_ids`], `${split} IDs changed`);
    assert.equal(sha(await readFile(resolve(root, EXPERIMENT, `data/${split}.inputs.jsonl`))), freeze[`${key}input_sha256`], `${split} input hash changed`);
    assert.equal(sha(messageBytes(validation.sets[split].inputs, validation.domain)), freeze[`${key}messages_sha256`], `${split} prompt messages changed`);
  }
  return { freeze, ...validation };
}

function checkOutcome(backend, outcome, rows, ids) {
  assert(typeof outcome.completed === 'boolean', `${backend} missing terminal outcome`);
  if (backend === 'rules') { assert.equal(rows.length, ids.length); assert.equal(outcome.completed, rows.every(row => row.finish_reason === 'stop'), 'Rules completion differs from terminal rows'); return; }
  assert(Array.isArray(outcome.attempts) && outcome.attempts.length > 0, `${backend} missing process attempts`);
  assert.equal(outcome.isolation ?? (backend === 'qwen' ? 'fresh_process_per_document' : 'sequential_requests'), backend === 'qwen' ? 'fresh_process_per_document' : 'sequential_requests');
  if (backend === 'qwen') {
    assert(outcome.attempts.every(attempt => Array.isArray(attempt.ids) && attempt.ids.length === 1), 'Qwen must isolate one material per process');
    assert(prefix(outcome.attempts.flatMap(attempt => attempt.ids), ids), 'Qwen attempts are repeated or out of order');
  } else { assert.equal(outcome.attempts.length, 1); same(outcome.attempts[0].ids, ids, 'DeepSeek batch IDs differ'); }
  const attempted = new Set(outcome.attempts.flatMap(attempt => attempt.ids));
  assert(rows.every(row => attempted.has(row.id)), `${backend} result has no process attempt`);
  for (const attempt of outcome.attempts) {
    const completed = attempt.code === 0 && !attempt.stop_reason && attempt.ids.every(id => rows.some(row => row.id === id && row.finish_reason === 'stop'));
    assert.equal(attempt.completed, completed, `${backend} process completion receipt is inconsistent`);
  }
  assert.equal(outcome.completed, outcome.attempts.length === (backend === 'qwen' ? ids.length : 1) && outcome.attempts.every(attempt => attempt.completed), `${backend} batch completion is inconsistent`);
}

function checkEvents(backend, events, rows, outcome, ids) {
  for (const event of events) if (event.id !== undefined) assert(ids.includes(event.id), `${backend} event has an unexpected id`);
  const results = events.filter(event => event.type === 'result');
  assert.equal(new Set(results.map(row => row.id)).size, results.length, `${backend} duplicate terminal event`);
  same(results.map(row => row.id), rows.map(row => row.id), `${backend} terminal events/results differ`);
  for (const row of rows) {
    const event = results.find(event => event.id === row.id);
    if (row.original_finish_reason !== undefined) {
      assert.equal(row.original_finish_reason, event.finish_reason, `${backend} original finish reason changed`);
      const attempt = outcome.attempts.find(attempt => attempt.ids.includes(row.id));
      assert(attempt && (!attempt.completed && (attempt.stop_reason || attempt.code !== 0)), `${backend} invalid terminal override`);
      assert.equal(row.finish_reason, attempt.stop_reason ?? 'process_error', `${backend} terminal override lacks its stop reason`);
      same(row, { ...event, original_finish_reason: event.finish_reason, finish_reason: row.finish_reason }, `${backend} altered worker result`);
    } else same(row, event, `${backend} worker result changed`);
  }
}

function checkQwen(events, rows, freeze) {
  for (const event of events.filter(row => row.type === 'load')) {
    assert.equal(event.model?.repository, freeze.qwen.repository, 'Qwen repository changed');
    assert.equal(event.model?.revision, freeze.qwen.revision, 'Qwen revision changed');
    same(event.packages, freeze.qwen.packages, 'Qwen packages changed');
    assert.equal(event.model?.source_manifest_sha256, freeze.qwen['source-manifest.json'].sha256, 'Qwen source manifest changed');
    assert.equal(event.model?.weights_verification_sha256, freeze.qwen['weights-verification.json'].sha256, 'Qwen weights receipt changed');
  }
  for (const id of freeze.case_ids) for (const type of ['load', 'generating', 'wired_policy']) assert(events.filter(event => event.type === type && event.id === id).length <= 1, `Repeated Qwen ${type}`);
  for (const row of rows.filter(row => ['stop', 'length'].includes(row.finish_reason))) {
    assert.equal(row.model, freeze.qwen.repository, 'Qwen output model changed');
    for (const type of ['load', 'generating', 'wired_policy']) assert.equal(events.filter(event => event.type === type && event.id === row.id).length, 1, `Missing Qwen ${type}`);
    assert(Array.isArray(row.output_token_ids) && row.output_token_ids.length === row.output_tokens && row.output_tokens <= 4096, 'Qwen token receipt differs');
    assert(Number.isInteger(row.input_tokens) && row.input_tokens > 0 && row.input_tokens + 4096 <= 12288, 'Qwen context bound differs');
  }
  for (const event of events.filter(row => row.type === 'wired_policy')) {
    assert.equal(event.wired_limit_bytes, 20 * GIB); assert.equal(event.wired_observed_bytes, 20 * GIB); assert.equal(event.allocator_guideline_bytes, 24 * GIB);
  }
}

async function checkDeepseek(root, dir, protocol, messages, events, rows, ids) {
  const transport = await optionalJsonl(resolve(dir, 'transport-attempts.jsonl'));
  same(transport, events.filter(row => row.type === 'transport'), 'DeepSeek transport log differs from events');
  const requests = events.filter(row => row.type === 'requesting');
  assert.equal(new Set(requests.map(row => row.id)).size, requests.length, 'Repeated DeepSeek model call');
  assert(prefix(requests.map(row => row.id), ids), 'DeepSeek requests are not the planned prefix');
  let reserve = 0;
  const route = protocol.deepseek.egress === 'temporary_loopback_ssh_test_host' ? 'loopback_forward' : 'official';
  assert(['temporary_loopback_ssh_test_host', 'direct'].includes(protocol.deepseek.egress), 'Unknown DeepSeek egress');
  for (const request of requests) {
    const record = messages.find(row => row.id === request.id);
    const payload = pythonJson({ model: 'deepseek-v4-pro', messages: record.messages, temperature: 0, max_tokens: 4096, stream: false, thinking: { type: 'disabled' } });
    const payloadHash = sha(payload);
    assert.equal(request.payload_sha256, payloadHash, 'DeepSeek payload differs from frozen messages');
    const upper = record.messages.reduce((n, row) => n + Buffer.byteLength(row.content), 0) + 1024;
    const cost = upper * 1.32 / 1e6 + 4096 * 3.96 / 1e6;
    assert(upper <= 85000 && Math.abs(request.reserved_usd_upper - cost) < 1e-12, 'DeepSeek reservation differs'); reserve += cost;
    const attempts = transport.filter(row => row.id === request.id);
    const connects = attempts.filter(row => row.event === 'transport_attempt');
    assert(connects.length <= 3, 'DeepSeek exceeded connection attempts');
    connects.forEach((row, index) => { assert.equal(row.connect_attempts, index + 1); assert.equal(row.request_sha256, payloadHash); });
    for (const name of ['send_started', 'body_sent', 'http_response']) assert(attempts.filter(row => row.event === name).length <= 1, `Repeated DeepSeek ${name}`);
    for (const row of attempts) {
      assert.equal(row.transport_route, route);
      assert(Number.isInteger(row.post_attempts) && row.post_attempts >= 0 && row.post_attempts <= 1 && Number.isInteger(row.connect_attempts) && row.connect_attempts >= 1 && row.connect_attempts <= 3, 'DeepSeek transport counters exceed policy');
      if (row.request_sha256 !== undefined) assert.equal(row.request_sha256, payloadHash, 'DeepSeek transport payload hash differs');
    }
    const send = attempts.findIndex(row => row.event === 'send_started');
    if (send >= 0) {
      assert(attempts.slice(0, send).some(row => row.event === 'connect' && row.completed === true && row.certificate_verified === true), 'DeepSeek sent before verified TLS');
      assert(!attempts.slice(send + 1).some(row => row.event === 'transport_attempt'), 'DeepSeek reconnected after HTTP submission began');
    }
  }
  assert(reserve <= 2, 'DeepSeek batch exceeded reserved budget');
  assert(transport.every(row => requests.some(request => request.id === row.id)), 'Transport attempt has no model request');
  for (const row of rows) {
    assert.equal(row.request_model, 'deepseek-v4-pro');
    assert(requests.some(request => request.id === row.id), 'DeepSeek result has no request');
    if (['stop', 'length'].includes(row.original_finish_reason ?? row.finish_reason)) {
      assert.equal(row.response_model, 'deepseek-v4-pro', 'DeepSeek returned another model identity');
      assert(row.transport_receipt?.submission_started === true && row.transport_receipt.request_body_sent === true && row.transport_receipt.post_attempts === 1, 'DeepSeek success has no single POST receipt');
      assert(row.transport_receipt.http_status >= 200 && row.transport_receipt.http_status < 300 && row.transport_receipt.connect_attempts >= 1 && row.transport_receipt.connect_attempts <= 3, 'DeepSeek success transport is invalid');
      assert.equal(row.transport_receipt.transport_route, route);
      // Use the event objects here so their positions bind to the complete log.
      // The independently loaded transport log was compared with these above.
      const chain = events.filter(event => event.type === 'transport' && event.id === row.id);
      const attempts = chain.filter(event => event.event === 'transport_attempt');
      const tls = chain.filter(event => event.event === 'connect' && event.completed === true && event.certificate_verified === true);
      const send = chain.filter(event => event.event === 'send_started');
      const body = chain.filter(event => event.event === 'body_sent');
      const response = chain.filter(event => event.event === 'http_response');
      assert(attempts.length >= 1 && attempts.length <= 3, 'DeepSeek success is missing connection-attempt evidence');
      for (const [name, entries] of [['TLS connect', tls], ['POST submission', send], ['body send', body], ['HTTP response', response]]) assert.equal(entries.length, 1, `DeepSeek success requires exactly one ${name}`);
      const requestIndex = events.findIndex(event => event.type === 'requesting' && event.id === row.id);
      const resultIndex = events.findIndex(event => event.type === 'result' && event.id === row.id);
      const positions = [requestIndex, ...attempts.map(event => events.indexOf(event)), events.indexOf(tls[0]), events.indexOf(send[0]), events.indexOf(body[0]), events.indexOf(response[0]), resultIndex];
      assert(positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1])), 'DeepSeek success transport chain is missing or out of order');
      assert.equal(tls[0].connect_attempts, attempts.length); assert.equal(send[0].connect_attempts, attempts.length);
      assert.equal(send[0].post_attempts, 1); assert.equal(send[0].submission_started, true); assert.equal(send[0].request_body_sent, false);
      for (const event of [body[0], response[0]]) { assert.equal(event.post_attempts, 1); assert.equal(event.connect_attempts, attempts.length); assert.equal(event.submission_started, true); assert.equal(event.request_body_sent, true); }
      assert.equal(row.transport_receipt.connect_attempts, attempts.length, 'DeepSeek receipt connection count differs from events');
      assert.equal(row.transport_receipt.post_attempts, send[0].post_attempts, 'DeepSeek receipt POST count differs from events');
      assert.equal(row.transport_receipt.http_status, response[0].http_status, 'DeepSeek receipt HTTP status differs from events');
    }
  }
  for (const event of events.filter(row => row.type === 'outcome')) if (event.reserved_peak_usd_upper !== undefined) assert(Math.abs(event.reserved_peak_usd_upper - reserve) < 1e-12, 'DeepSeek reserved total differs');
  if (route === 'loopback_forward') {
    const egress = await json(resolve(dir, 'egress.json'));
    assert.equal(egress.route, 'temporary_loopback_ssh_test_host'); assert.equal(egress.tls_host, 'api.deepseek.com');
    assert.equal(egress.credential_copied_to_server, false); assert.equal(egress.global_network_changed, false); assert.equal(egress.ssh_closed, true);
  }
}

export async function verifyExperiment(root = ROOT, { preflight = false, writeManifest = false } = {}) {
  assert(!(preflight && writeManifest), 'Preflight cannot write a result manifest');
  const validation = await verifyPreflight(root), { freeze, sets, domain } = validation;
  if (preflight) return { status: 'PASS', preflight: true, ...validation.summary, frozen_files: Object.keys(freeze.files).length, inference: false, training: false };
  const resultRoot = resolve(root, EXPERIMENT, 'results');
  same((await readdir(resultRoot)).filter(name => name.startsWith('holdout-')).sort(), BACKENDS.map(backend => `holdout-${backend}-1`).sort(), 'Unexpected formal attempt directories');
  const scorer = await import(pathToFileURL(resolve(root, EXPERIMENT, 'assess.mjs')).href);
  const runs = [];
  let artifactPaths = [];
  for (const backend of BACKENDS) {
    const name = `holdout-${backend}-1`, directory = `${EXPERIMENT}/results/${name}`, dir = resolve(root, directory);
    const protocol = await json(resolve(dir, 'protocol.json')), rows = await jsonl(resolve(dir, 'results.jsonl')), outcome = await json(resolve(dir, 'outcome.json'));
    assert.equal(protocol.backend, backend); assert.equal(protocol.mode, 'holdout'); assert.equal(protocol.training, false); assert.equal(protocol.adapters, null);
    assert(Number.isFinite(Date.parse(protocol.at)) && Date.parse(protocol.at) >= Date.parse(freeze.frozen_at), `${backend} was not started after freezing`);
    for (const [key, value] of Object.entries({ temperature: 0, max_output_tokens: 4096, max_qwen_total_tokens: 12288, max_cases: 12, gold_sent: false, context_reset: true, calls_per_case: 1, post_retries: 0, connect_attempts_per_case: 3, concurrency: 1 })) assert.equal(protocol[key], value, `${backend} policy differs: ${key}`);
    same(protocol.qwen_memory, QWEN_MEMORY, `${backend} Qwen memory policy differs`);
    for (const [key, value] of Object.entries({ model: 'deepseek-v4-pro', thinking: 'disabled', absolute_case_timeout_seconds: 180, socket_timeout_seconds: 120, connect_timeout_seconds: 10, max_attempts_before_any_http_send: 3, tls_host: 'api.deepseek.com', certificate_verification: true, stop_after_total_errors: 3, reserved_upper_usd: 2, input_usd_per_million: 1.32, output_usd_per_million: 3.96 })) assert.equal(protocol.deepseek?.[key], value, `${backend} DeepSeek policy differs: ${key}`);
    same(protocol.deepseek.connect_backoff_seconds, [0.5, 1], `${backend} connection backoff differs`);
    if (backend === 'deepseek') assert.equal(protocol.deepseek.egress, freeze.deepseek_egress, 'DeepSeek route differs from frozen choice');
    assert.equal(protocol.input_sha256, freeze.input_sha256); same(protocol.case_ids, freeze.case_ids, `${backend} planned IDs differ`);
    assert(RUN_HASH_FILES.every(path => Object.hasOwn(protocol.hashes, path)), `${backend} omits code hashes`);
    for (const [path, hash] of Object.entries(protocol.hashes)) assert.equal(hash, freeze.files[path], `${backend} code hash changed: ${path}`);
    const messages = await jsonl(resolve(dir, 'messages.jsonl'));
    assert.equal(sha(await readFile(resolve(dir, 'messages.jsonl'))), freeze.messages_sha256, `${backend} messages changed`);
    assert.equal(await readFile(resolve(dir, 'messages.jsonl'), 'utf8'), messageBytes(sets.holdout.inputs, domain), `${backend} messages differ from current builder`);
    assert.equal(new Set(rows.map(row => row.id)).size, rows.length, `${backend} duplicate result`);
    assert(prefix(rows.map(row => row.id), freeze.case_ids), `${backend} result IDs differ from the planned prefix`);
    assert(rows.every(row => row.backend === backend && typeof row.raw_output === 'string' && typeof row.finish_reason === 'string'), `${backend} invalid result schema`);
    checkOutcome(backend, outcome, rows, freeze.case_ids);
    if (backend !== 'rules') {
      const events = await optionalJsonl(resolve(dir, 'events.jsonl'));
      checkEvents(backend, events, rows, outcome, freeze.case_ids);
      if (backend === 'qwen') checkQwen(events, rows, freeze);
      else await checkDeepseek(root, dir, protocol, messages, events, rows, freeze.case_ids);
    }
    const report = scorer.assess(sets.holdout.inputs, sets.holdout.labels, rows);
    same(report, await json(resolve(dir, 'report.json')), `${backend} report differs from independent recomputation`);
    assert.equal(report.planned_documents, 8); assert.equal(report.expected_facts, sets.holdout.facts);
    runs.push({ name, backend, split: 'holdout', planned: 8, returned: rows.length, completed: report.completed, protocol_valid: report.protocol_valid });
    artifactPaths.push(...await filesUnder(root, directory));
  }
  const files = {};
  for (const path of artifactPaths.sort()) files[path.slice(`${EXPERIMENT}/`.length)] = sha(await readFile(resolve(root, path)));
  const manifest = { schema: 'material-facts-v6-results/1', training: false, freeze_sha256: sha(await readFile(resolve(root, EXPERIMENT, 'freeze.json'))), runs, files };
  const destination = resolve(root, EXPERIMENT, 'result-manifest.json');
  if (writeManifest) await writeFile(destination, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  else same(await json(destination), manifest, 'Result manifest differs or omits artifacts');
  return { status: 'PASS', preflight: false, planned_per_backend: 8, runs, result_files: Object.keys(files).length, result_manifest_sha256: sha(await readFile(destination)), inference: false, training: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = process.argv.slice(2);
    assert(options.every(option => ['--preflight', '--write-manifest'].includes(option)) && new Set(options).size === options.length, 'Expected --preflight or --write-manifest');
    console.log(JSON.stringify(await verifyExperiment(ROOT, { preflight: options.includes('--preflight'), writeManifest: options.includes('--write-manifest') })));
  } catch (error) { console.error(JSON.stringify({ status: 'FAIL', error: error.message })); process.exitCode = 1; }
}
