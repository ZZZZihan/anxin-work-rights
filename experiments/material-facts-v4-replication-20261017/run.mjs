import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { buildExtractionMessages, extractRuleCandidates } from '../../lib/material-facts.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) { if (!args[i].startsWith('--') || args[i + 1] === undefined) throw new Error('Expected --key value'); options[args[i].slice(2)] = args[i + 1]; }
const mode = options.mode ?? 'diagnostic';
if (!['diagnostic', 'replication'].includes(mode)) throw new Error('Invalid mode');
const backend = options.backend, out = resolve(options.out), inputPath = resolve(options.inputs);
if (!['rules', 'qwen', 'deepseek'].includes(backend)) throw new Error('Invalid backend');
const sha = value => createHash('sha256').update(value).digest('hex');
const inputBytes = await readFile(inputPath);
const inputs = inputBytes.toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
if (!inputs.length || inputs.length > 12 || new Set(inputs.map(r => r.id)).size !== inputs.length) throw new Error('Invalid input set');
const messages = inputs.map(input => ({ id: input.id, messages: buildExtractionMessages(input.source) }));
if (mode === 'replication') {
  const freeze = JSON.parse(await readFile(resolve(root, 'experiments/material-facts-v4-replication-20261017/freeze.json')));
  for (const [path, hash] of Object.entries(freeze.files)) { if (sha(await readFile(resolve(root, path))) !== hash) throw new Error(`Frozen code/data changed: ${path}`); }
  if (sha(inputBytes) !== freeze.input_sha256 || sha(messages.map(row => JSON.stringify(row)).join('\n') + '\n') !== freeze.messages_sha256) throw new Error('Replication inputs/messages differ');
}
await mkdir(out); // Refuse to overwrite earlier attempts.
const save = (name, value) => writeFile(resolve(out, name), JSON.stringify(value, null, 2) + '\n');
const hashes = {};
for (const file of ['lib/material-facts.ts', 'lib/material-fact-types.ts', 'scripts/fact-runtime-v2.py', 'scripts/fact_memory_runtime.py', 'scripts/fact_api_transport.py', 'experiments/material-facts-v4-replication-20261017/run.mjs', 'experiments/material-facts-v4/assess.mjs']) hashes[file] = sha(await readFile(resolve(root, file)));
await save('protocol.json', { at: new Date().toISOString(), backend, mode, training: false, adapters: null, input_sha256: sha(inputBytes), case_ids: inputs.map(r => r.id), hashes,
  temperature: 0, max_output_tokens: 4096, max_qwen_total_tokens: 12288, max_cases: 12, gold_sent: false, context_reset: true, calls_per_case: 1, post_retries: 0, connect_attempts_per_case: 3, concurrency: 1,
  process_isolation: backend === 'qwen' ? 'fresh_process_per_document' : 'sequential_requests', qwen_batch_stop: 'first_memory_guard_or_monitor_failure',
  qwen_memory: { allocator_guideline_gib: 24, wired_gib: 20, cache_mib: 512, prefill_step_size: 128, kv_bits: 4, kv_group_size: 64, quantized_kv_start: 0, critical: 'immediate_stop', warning: '10_seconds', swap_growth_gib: 4, case_timeout_seconds: 600 },
  deepseek: { model: 'deepseek-v4-pro', thinking: 'disabled', absolute_case_timeout_seconds: 180, socket_timeout_seconds: 120, connect_timeout_seconds: 10, connect_backoff_seconds: [0.5, 1], max_attempts_before_any_http_send: 3, egress: options['connect-port'] ? 'temporary_loopback_ssh_test_host' : 'direct', tls_host: 'api.deepseek.com', certificate_verification: true, stop_after_total_errors: 3, reserved_upper_usd: 2, pricing_source: 'https://api-docs.deepseek.com/quick_start/pricing/', pricing_checked: '2026-10-17', input_usd_per_million: 1.32, output_usd_per_million: 3.96 },
  comparison: 'same_revealed_documents_replication_prompt_only_JSON_no_constrained_decoding', scope: 'public_document_text_candidates_only_not_OCR_or_user_confirmation' });
await writeFile(resolve(out, 'messages.jsonl'), messages.map(row => JSON.stringify(row)).join('\n') + '\n');
await writeFile(resolve(out, 'results.jsonl'), '');
if (backend === 'rules') {
  for (const input of inputs) {
    const start = performance.now();
    let row;
    try { row = { id: input.id, backend, raw_output: extractRuleCandidates(input.source), finish_reason: 'stop' }; }
    catch { row = { id: input.id, backend, raw_output: '', finish_reason: 'rule_error' }; }
    await appendFile(resolve(out, 'results.jsonl'), JSON.stringify({ ...row, latency_seconds: (performance.now() - start) / 1000 }) + '\n');
  }
  await save('outcome.json', { completed: true });
} else {
  // The website launches one worker per material. Match that isolation so a
  // completed document cannot leave MLX allocations in the next document.
  const batches = backend === 'qwen' ? messages.map(message => [message]) : [messages];
  const attempts = [];
  for (const batch of batches) {
  const python = options.python || 'python3';
  const argv = [resolve(root, 'scripts/fact-runtime-v2.py'), '--backend', backend];
  if (backend === 'qwen') argv.push('--model-path', options['model-path'], '--integrity-dir', options['integrity-dir']);
  else { argv.push('--key-file', options['key-file']); if (options['connect-port']) argv.push('--connect-host', '127.0.0.1', '--connect-port', options['connect-port']); }
  const execute = promisify(execFile);
  const memory = async () => {
    const [pressure, swap] = await Promise.all([execute('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], { timeout: 2000 }), execute('sysctl', ['-n', 'vm.swapusage'], { timeout: 2000 })]);
    const level = Number(pressure.stdout), match = /used\s*=\s*([\d.]+)([MG])/.exec(swap.stdout);
    const used = match ? Number(match[1]) * (match[2] === 'G' ? 1024 ** 3 : 1024 ** 2) : NaN;
    if (![1, 2, 4].includes(level) || !Number.isFinite(used)) throw new Error('Invalid memory state');
    return { level, used };
  };
  let before;
  if (backend === 'qwen') {
    try { before = await memory(); if (before.level !== 1) throw new Error('Initial pressure'); }
    catch { attempts.push({ ids: batch.map(row => row.id), completed: false, stop_reason: 'initial_memory_state' }); await save('outcome.json', { completed: false, attempts }); break; }
  }
  const child = spawn(python, argv, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_IMPLICIT_TOKEN: '1', HF_HUB_DISABLE_TELEMETRY: '1', PYTHONUNBUFFERED: '1' } });
  let requestTimer = null, activeRequestId = null, interruptedRequestId = null;
  let buffer = '', bytes = 0, stopReason = null, writeQueue = Promise.resolve(), writeFailure = null, lastEvent = Date.now();
  const stdoutDecoder = new StringDecoder('utf8');
  const resultRows = [];
  const started = Date.now();
  // Handle each rejection immediately: a rejected log/parse promise must not
  // exit this parent while its inference process is still running.
  const queueWrite = operation => {
    writeQueue = writeQueue.then(() => writeFailure ? undefined : operation()).catch(error => {
      writeFailure ??= error instanceof Error ? error : new Error('Worker output failed');
      stopReason ??= 'worker_output_error';
      terminate();
    });
  };
  child.stdout.on('data', chunk => {
    if (writeFailure) return;
    bytes += chunk.length; if (bytes > 20_000_000) { stopReason = 'output_limit'; terminate(); return; }
    buffer += stdoutDecoder.write(chunk);
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      queueWrite(async () => {
        await appendFile(resolve(out, 'events.jsonl'), line + '\n');
        const event = JSON.parse(line); lastEvent = Date.now();
        if (backend === 'deepseek' && event.type === 'requesting') {
          if (activeRequestId !== null) throw new Error('Overlapping request');
          activeRequestId = event.id;
          requestTimer = setTimeout(() => { interruptedRequestId = activeRequestId; stopReason = 'absolute_request_timeout'; terminate(); }, 180_000);
        }
        if (event.type === 'result') { if (!batch.some(row => row.id === event.id) || resultRows.some(row => row.id === event.id)) throw new Error('Duplicate or unexpected result'); resultRows.push(event); if (backend === 'deepseek') { clearTimeout(requestTimer); activeRequestId = null; } }
        if (event.type === 'transport') await appendFile(resolve(out, 'transport-attempts.jsonl'), line + '\n');
        if (!['telemetry', 'phase_memory'].includes(event.type)) console.log(JSON.stringify({ type: event.type, id: event.id, finish_reason: event.finish_reason, latency_seconds: event.latency_seconds, error_type: event.error_type }));
      });
    }
  });
  child.stderr.on('data', chunk => { queueWrite(() => appendFile(resolve(out, 'worker.log'), chunk)); });
  child.stdin.on('error', () => {});
  child.stdin.end(batch.map(row => JSON.stringify(row)).join('\n') + '\n');
  // External monitor also covers model loading and prefill, before a token is produced.
  let monitoring = false, warningAt = null, killTimer = null, closed = false, exited = false;
  const terminate = () => { if (exited || closed) return; if (backend === 'deepseek' && activeRequestId !== null) interruptedRequestId ??= activeRequestId; child.kill('SIGTERM'); killTimer ??= setTimeout(() => { if (!exited && !closed) child.kill('SIGKILL'); }, 3000); };
  const cancelParent = () => { stopReason ??= 'parent_cancel'; terminate(); };
  process.once('SIGTERM', cancelParent); process.once('SIGINT', cancelParent);
  const hardTimeout = setTimeout(() => { stopReason = 'absolute_worker_timeout'; terminate(); }, backend === 'qwen' ? 600_000 : 2400_000);
  const monitor = setInterval(async () => {
    if (monitoring || exited || closed) return;
    monitoring = true;
    try {
      if (Date.now() - started > 3600_000 || Date.now() - lastEvent > 620_000) stopReason = 'total_or_stage_timeout';
      if (backend === 'qwen') {
        const { level, used } = await memory();
        if (exited || closed) return;
        warningAt = level >= 2 ? warningAt ?? Date.now() : null;
        const sample = { at: new Date().toISOString(), ids: batch.map(row => row.id), level, swap_used_bytes: used };
        await appendFile(resolve(out, 'memory.jsonl'), JSON.stringify(sample) + '\n');
        if (exited || closed) return;
        if (level >= 4 || (warningAt && Date.now() - warningAt >= 10000) || used - before.used > 4 * 1024 ** 3) stopReason = 'external_memory_guard';
      }
      if (stopReason) terminate();
    } catch { if (!exited && !closed) { stopReason = 'monitor_error'; terminate(); } }
    finally { monitoring = false; }
  }, 2000);
  const result = await new Promise(resolveExit => { child.once('error', () => { stopReason = 'spawn_or_process_error'; terminate(); }); child.once('exit', () => { exited = true; clearInterval(monitor); clearTimeout(hardTimeout); clearTimeout(requestTimer); clearTimeout(killTimer); }); child.once('close', (code, signal) => { closed = true; resolveExit({ code, signal }); }); });
  clearInterval(monitor); clearTimeout(hardTimeout); clearTimeout(requestTimer); clearTimeout(killTimer); await writeQueue;
  process.removeListener('SIGTERM', cancelParent); process.removeListener('SIGINT', cancelParent);
  buffer += stdoutDecoder.end();
  if (buffer) await writeFile(resolve(out, `partial-stdout-${attempts.length + 1}.txt`), buffer);
  for (const row of resultRows) {
    const failedWorker = (backend === 'qwen' && (stopReason || result.code !== 0)) || row.id === interruptedRequestId;
    const terminal = failedWorker ? { ...row, original_finish_reason: row.finish_reason, finish_reason: stopReason ?? 'process_error' } : row;
    await appendFile(resolve(out, 'results.jsonl'), JSON.stringify(terminal) + '\n');
  }
  attempts.push({ ids: batch.map(row => row.id), completed: result.code === 0 && !stopReason && batch.every(item => resultRows.some(row => row.id === item.id && row.finish_reason === 'stop')), ...result, stop_reason: stopReason, ...(writeFailure ? { output_error_type: writeFailure.name ?? 'Error' } : {}), seconds: (Date.now() - started) / 1000, incomplete_stdout: !!buffer });
  await save('outcome.json', { completed: attempts.length === batches.length && attempts.every(row => row.completed), isolation: backend === 'qwen' ? 'fresh_process_per_document' : 'sequential_requests', attempts });
  if (backend === 'qwen' && (stopReason || result.code !== 0)) break;
  if (backend === 'qwen' && attempts.length < batches.length) {
    // Stop the batch if the host has not recovered; never relax the guard.
    let normal = false;
    for (let check = 0; check < 15; check++) {
      const pressure = await memory();
      if (pressure.level === 1) { normal = true; break; }
      await new Promise(resolveWait => setTimeout(resolveWait, 2000));
    }
    if (!normal) break;
  }
  }
  process.exitCode = attempts.length === batches.length && attempts.every(row => row.completed) ? 0 : 1;
}
