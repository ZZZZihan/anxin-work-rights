import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, appendFile, lstat, realpath, rmdir, stat, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, dirname, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { extractRuleCandidates } from '../../lib/material-facts-v3.ts';
import { EXPERIMENT, RUN_HASH_FILES, deepseekReservation, priorDeepseekReservation, loadPolicy, QWEN_MEMORY } from './freeze.mjs';
import { verifyPreflight } from './verify.mjs';
import { withExperimentLock } from './experiment-lock.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const execute = promisify(execFile);

async function readablePath(path, directory, label) {
  try {
    const info = await stat(path);
    if (directory ? !info.isDirectory() : !info.isFile()) throw new Error('Wrong path type');
    await access(path, constants.R_OK | (directory ? constants.X_OK : 0));
    return info;
  } catch { throw new Error(`${label} must name a readable ${directory ? 'directory' : 'regular file'}`); }
}

async function backendPreflight(backend, options) {
  if (backend === 'rules') return null;
  if (backend === 'qwen') {
    if (!options['model-path']?.trim() || !options['integrity-dir']?.trim()) throw new Error('Qwen requires --model-path and --integrity-dir');
    await readablePath(options['model-path'], true, '--model-path');
    await readablePath(options['integrity-dir'], true, '--integrity-dir');
    // Inspect small required files only. The worker retains weight integrity,
    // package, memory and model-loading checks, and preserves any such failure.
    for (const path of [resolve(options['model-path'], 'config.json'), resolve(options['integrity-dir'], 'source-manifest.json'), resolve(options['integrity-dir'], 'weights-verification.json')]) {
      await readablePath(path, false, 'Qwen configuration/integrity file');
      try { JSON.parse(await readFile(path, 'utf8')); } catch { throw new Error('Qwen configuration/integrity file must be valid JSON'); }
    }
  } else {
    if (!options['key-file']?.trim()) throw new Error('DeepSeek requires --key-file');
    if (options['connect-port'] !== undefined && (!/^[0-9]+$/u.test(options['connect-port']) || Number(options['connect-port']) < 1 || Number(options['connect-port']) > 65535)) throw new Error('--connect-port must be an integer from 1 to 65535');
    const key = await readablePath(options['key-file'], false, '--key-file');
    if (key.mode & 0o077) throw new Error('--key-file must be private to its owner');
    if (!(await readFile(options['key-file'], 'utf8')).trim()) throw new Error('--key-file must not be empty');
  }
  await readablePath(resolve(root, 'scripts/fact-runtime-v2.py'), false, 'Worker script');
  const requested = options.python ?? 'python3';
  if (!requested.trim()) throw new Error('--python must name an executable Python interpreter');
  let python;
  for (const path of requested.includes('/') ? [resolve(requested)] : (process.env.PATH ?? '').split(delimiter).map(directory => resolve(directory, requested))) {
    try { if ((await stat(path)).isFile()) { await access(path, constants.R_OK | constants.X_OK); python = path; break; } }
    catch { /* Keep searching PATH without exposing process output or credentials. */ }
  }
  if (!python) throw new Error('--python must name an executable Python interpreter');
  try {
    const probe = await execute(python, ['-c', 'import sys; assert sys.version_info >= (3, 10); print("anxin-v7-python-ready")'], { timeout: 5000, maxBuffer: 4096 });
    if (probe.stdout.trim() !== 'anxin-v7-python-ready') throw new Error('Invalid interpreter response');
  } catch { throw new Error('Python executable failed its no-model preflight'); }
  return python;
}

const args = process.argv.slice(2), options = {};
const acceptedOptions = new Set(['mode', 'backend', 'inputs', 'out', 'python', 'model-path', 'integrity-dir', 'key-file', 'connect-port']);
for (let i = 0; i < args.length; i += 2) { const key = args[i].slice(2); if (!args[i].startsWith('--') || args[i + 1] === undefined || !acceptedOptions.has(key) || Object.hasOwn(options, key)) throw new Error('Expected unique supported --key value pairs'); options[key] = args[i + 1]; }
const mode = options.mode ?? 'diagnostic';
if (!['diagnostic', 'holdout'].includes(mode)) throw new Error('Invalid mode');
if (!options.out || !options.inputs) throw new Error('Expected --inputs and --out');
const backend = options.backend, requestedOut = resolve(options.out), inputPath = resolve(options.inputs);
const resultRoot = resolve(root, EXPERIMENT, 'results');
if (basename(dirname(requestedOut)) !== 'results' || await realpath(dirname(dirname(requestedOut))) !== resolve(root, EXPERIMENT)) throw new Error('All v7 attempt directories must be direct children of v7/results');
try { const info = await lstat(resultRoot); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Result root must be a real directory'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const out = resolve(resultRoot, basename(requestedOut));
if (mode === 'holdout' && basename(out) !== `holdout-${backend}-1`) throw new Error('Formal attempt directory must match the frozen backend');
if (mode !== 'holdout' && basename(out).startsWith('holdout-')) throw new Error('Diagnostic output cannot use a formal attempt name');
if (!['rules', 'qwen', 'deepseek'].includes(backend)) throw new Error('Invalid backend');
const python = await backendPreflight(backend, options);
const sha = value => createHash('sha256').update(value).digest('hex');
const inputBytes = await readFile(inputPath);
const inputs = inputBytes.toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
if (!inputs.length || inputs.length > 12 || new Set(inputs.map(r => r.id)).size !== inputs.length) throw new Error('Invalid input set');
const { buildExtractionMessagesV4 } = await import('../../lib/material-fact-extraction-v4.ts');
const policy = await loadPolicy(root);
if (backend === 'deepseek' && (options['connect-port'] ? 'temporary_loopback_ssh_test_host' : 'direct') !== policy.deepseek.egress) throw new Error('DeepSeek route differs from the verified runtime policy');
const messages = inputs.map(input => ({ id: input.id, messages: buildExtractionMessagesV4(input.source) }));
// Diagnostic attempts and freeze publication share a lock. Hold it through all
// terminal writes so a freeze cannot observe an allocated but unfinished run.
async function runAttempt() {
if (mode === 'holdout') {
  const { freeze } = await verifyPreflight(root);
  if (backend === 'deepseek' && (options['connect-port'] ? 'temporary_loopback_ssh_test_host' : 'direct') !== freeze.deepseek_egress) throw new Error('DeepSeek route differs from frozen choice');
  if (sha(inputBytes) !== freeze.input_sha256 || sha(messages.map(row => JSON.stringify(row)).join('\n') + '\n') !== freeze.messages_sha256) throw new Error('Holdout inputs/messages differ');
} else {
  try { await lstat(resolve(root, EXPERIMENT, 'freeze.json')); throw new Error('Diagnostic attempts are closed after freezing'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (inputs.length !== 3 || sha(inputBytes) !== sha(await readFile(resolve(root, EXPERIMENT, 'data/dev.inputs.jsonl')))) throw new Error('Diagnostic requests must use the complete preregistered three-case development input');
}
const save = (name, value) => writeFile(resolve(out, name), JSON.stringify(value, null, 2) + '\n');
const hashes = {};
for (const file of RUN_HASH_FILES) hashes[file] = sha(await readFile(resolve(root, file)));
await mkdir(resultRoot, { recursive: true });
const budgetLock = resolve(resultRoot, '.deepseek-budget.lock');
let locked = false, budget = null;
try {
  if (backend === 'deepseek') {
    await mkdir(budgetLock); locked = true; // Atomic reservation serialization; a stale lock fails closed.
    const prior = await priorDeepseekReservation(root, policy), planned = deepseekReservation(messages, policy);
    if (prior + planned > policy.deepseek.reserved_upper_usd) throw new Error('Total v7 development plus holdout reservation exceeds 2 USD');
    budget = { scope: 'all_v7_attempts', prior_reserved_upper_usd: prior, planned_reserved_upper_usd: planned,
      combined_reserved_upper_usd: prior + planned, total_limit_usd: policy.deepseek.reserved_upper_usd };
  }
  await mkdir(out); // Refuse to overwrite earlier attempts, including failures.
await save('protocol.json', { at: new Date().toISOString(), backend, mode, training: false, adapters: null, input_sha256: sha(inputBytes), case_ids: inputs.map(r => r.id), hashes,
  temperature: 0, max_output_tokens: 4096, max_qwen_total_tokens: 12288, max_cases: 12, gold_sent: false, context_reset: true, calls_per_case: 1, post_retries: 0, connect_attempts_per_case: 3, concurrency: 1,
  deepseek_budget: budget,
  process_isolation: backend === 'qwen' ? 'fresh_process_per_document' : 'sequential_requests', qwen_batch_stop: 'first_memory_guard_or_monitor_failure',
  qwen_memory: QWEN_MEMORY,
  deepseek: { ...policy.deepseek, absolute_case_timeout_seconds: 180, socket_timeout_seconds: 120, connect_timeout_seconds: 10, connect_backoff_seconds: [0.5, 1], max_attempts_before_any_http_send: 3, tls_host: 'api.deepseek.com', certificate_verification: true, stop_after_total_errors: 3 },
  comparison: 'new_case_grouped_materials_v4_event_bound_same_prompt_no_regeneration', scope: 'public_document_text_candidates_only_not_OCR_or_user_confirmation' });
await writeFile(resolve(out, 'messages.jsonl'), messages.map(row => JSON.stringify(row)).join('\n') + '\n');
await writeFile(resolve(out, 'results.jsonl'), '');
} finally { if (locked) await rmdir(budgetLock); }
if (backend === 'rules') {
  let completed = true;
  for (const input of inputs) {
    const start = performance.now();
    let row;
    try { row = { id: input.id, backend, raw_output: extractRuleCandidates(input.source), finish_reason: 'stop' }; }
    catch { completed = false; row = { id: input.id, backend, raw_output: '', finish_reason: 'rule_error' }; }
    await appendFile(resolve(out, 'results.jsonl'), JSON.stringify({ ...row, latency_seconds: (performance.now() - start) / 1000 }) + '\n');
  }
  await save('outcome.json', { completed });
  process.exitCode = completed ? 0 : 1;
} else {
  // The website launches one worker per material. Match that isolation so a
  // completed document cannot leave MLX allocations in the next document.
  const batches = backend === 'qwen' ? messages.map(message => [message]) : [messages];
  const attempts = [];
  for (const batch of batches) {
  const argv = [resolve(root, 'scripts/fact-runtime-v2.py'), '--backend', backend];
  if (backend === 'qwen') argv.push('--model-path', options['model-path'], '--integrity-dir', options['integrity-dir']);
  else { argv.push('--key-file', options['key-file']); if (options['connect-port']) argv.push('--connect-host', '127.0.0.1', '--connect-port', options['connect-port']); }
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
  let buffer = '', stdoutBytes = 0, stderrBytes = 0, stopReason = null, writeQueue = Promise.resolve(), writeFailure = null, lastEvent = Date.now();
  const outputLimit = 20_000_000; // Independent bounds for each stream, in raw bytes.
  const stdoutDecoder = new StringDecoder('utf8');
  const resultRows = [];
  const started = Date.now();
  // Each readable pauses before enqueueing its current chunk and resumes only
  // after its disk work settles. At most one chunk per stream can wait here;
  // output cannot create an unbounded chain of pending write promises.
  const queueWrite = (stream, operation) => {
    stream.pause();
    writeQueue = writeQueue.then(() => writeFailure ? undefined : operation()).catch(error => {
      writeFailure ??= error instanceof Error ? error : new Error('Worker output failed');
      stopReason ??= 'worker_output_error';
      terminate();
    }).finally(() => stream.resume()); // Keep draining pipes after failure/exit.
  };
  child.stdout.on('data', chunk => {
    if (writeFailure || stdoutBytes > outputLimit) return;
    stdoutBytes += chunk.length;
    if (stdoutBytes > outputLimit) { stopReason ??= 'output_limit'; terminate(); return; }
    queueWrite(child.stdout, async () => {
      buffer += stdoutDecoder.write(chunk);
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        await appendFile(resolve(out, 'events.jsonl'), line + '\n');
        const event = JSON.parse(line); lastEvent = Date.now();
        if (backend === 'deepseek' && event.type === 'requesting') {
          if (activeRequestId !== null) throw new Error('Overlapping request');
          activeRequestId = event.id;
          // A queued disk write may finish after exit/close. Retain its event
          // but never create a live request deadline for a dead worker.
          if (!exited && !closed) requestTimer = setTimeout(() => { interruptedRequestId = activeRequestId; stopReason = 'absolute_request_timeout'; terminate(); }, 180_000);
        }
        if (event.type === 'result') { if (!batch.some(row => row.id === event.id) || resultRows.some(row => row.id === event.id)) throw new Error('Duplicate or unexpected result'); resultRows.push(event); if (backend === 'deepseek') { clearTimeout(requestTimer); activeRequestId = null; } }
        if (event.type === 'transport') await appendFile(resolve(out, 'transport-attempts.jsonl'), line + '\n');
        if (!['telemetry', 'phase_memory'].includes(event.type)) console.log(JSON.stringify({ type: event.type, id: event.id, finish_reason: event.finish_reason, latency_seconds: event.latency_seconds, error_type: event.error_type }));
      }
    });
  });
  child.stderr.on('data', chunk => {
    if (writeFailure || stderrBytes > outputLimit) return;
    stderrBytes += chunk.length;
    if (stderrBytes > outputLimit) { stopReason ??= 'stderr_output_limit'; terminate(); return; }
    queueWrite(child.stderr, () => appendFile(resolve(out, 'worker.log'), chunk));
  });
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
  clearInterval(monitor); clearTimeout(hardTimeout); clearTimeout(requestTimer); clearTimeout(killTimer);
  try { await writeQueue; }
  finally {
    // Clear again after queued events, including any late requesting event.
    clearTimeout(requestTimer); clearTimeout(killTimer);
    process.removeListener('SIGTERM', cancelParent); process.removeListener('SIGINT', cancelParent);
  }
  buffer += stdoutDecoder.end();
  if (buffer) {
    await writeFile(resolve(out, `partial-stdout-${attempts.length + 1}.txt`), buffer);
    stopReason ??= 'incomplete_stdout';
  }
  for (const row of resultRows) {
    const failedWorker = (backend === 'qwen' && (stopReason || result.code !== 0)) || row.id === interruptedRequestId;
    const terminal = failedWorker ? { ...row, original_finish_reason: row.finish_reason, finish_reason: stopReason ?? 'process_error' } : row;
    await appendFile(resolve(out, 'results.jsonl'), JSON.stringify(terminal) + '\n');
  }
  attempts.push({ ids: batch.map(row => row.id), completed: result.code === 0 && !stopReason && !buffer && batch.every(item => resultRows.some(row => row.id === item.id && row.finish_reason === 'stop')), ...result, stop_reason: stopReason, ...(writeFailure ? { output_error_type: writeFailure.name ?? 'Error' } : {}), seconds: (Date.now() - started) / 1000, incomplete_stdout: !!buffer });
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
}

if (mode === 'diagnostic') await withExperimentLock(root, 'diagnostic', runAttempt);
else await runAttempt();
