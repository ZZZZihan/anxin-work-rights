// A narrow execution-only bridge for the archived v34 check. The immutable v1
// preload and older versioned bridges handle older children; neither is expanded here.
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLEANUP_RESERVE_MS, POLICY_ID, POLICY_SHA256, POLICY_URL, ROOT_BUDGET_MS, STATE_ENV,
  nativeExecFileSync, readExecutionState, recordExecutionEvent, rootBudgetStartedMs } from './historical-execution-policy-v1.mjs';

export function historicalV34Target(script, args) {
  if (typeof script !== 'string' || !Array.isArray(args) || args.length !== 1 || args[0] !== '--check') return null;
  const path = resolve(script);
  return basename(path) === 'corrective-assessment-v34.mjs'
    && dirname(path).endsWith(`${sep}experiments${sep}material-facts-v7`)
    ? 'experiments/material-facts-v7/corrective-assessment-v34.mjs' : null;
}

export function prepareHistoricalV34Options(script, args, options, state) {
  const target = historicalV34Target(script, args);
  if (!target) throw new Error('Historical v34 execution only accepts the exact read-only v34 assessment check');
  // Validate inherited state with the unchanged v1 contract before deriving a
  // child. No state or environment mutation occurs in this process.
  if (!readExecutionState({ [STATE_ENV]: JSON.stringify(state) })) throw new Error('Invalid historical execution policy state');
  const deadline = state.deadline_ms - CLEANUP_RESERVE_MS, remaining = deadline - Date.now();
  if (remaining <= 0) {
    recordExecutionEvent(state, { event: 'budget_exhausted', target, depth: state.depth + 1, deadline_ms: deadline });
    const error = new Error('Shared historical execution deadline exhausted before starting another check');
    error.code = 'ETIMEDOUT';
    throw error;
  }
  const next = { ...state, deadline_ms: deadline, depth: state.depth + 1 };
  const env = { ...(options.env ?? process.env) }, preload = `--import=${POLICY_URL}`;
  env.NODE_OPTIONS = (env.NODE_OPTIONS ?? '').split(/\s+/u).includes(preload)
    ? env.NODE_OPTIONS : [env.NODE_OPTIONS, preload].filter(Boolean).join(' ');
  env[STATE_ENV] = JSON.stringify(next);
  recordExecutionEvent(state, { event: 'child_budget', target, args, depth: next.depth,
    requested_timeout_ms: options.timeout ?? null, effective_timeout_ms: remaining,
    parent_deadline_ms: state.deadline_ms, child_deadline_ms: deadline,
    cleanup_reserve_ms: CLEANUP_RESERVE_MS, execution_adapter: 'historical-v34-execution/1' });
  return { ...options, env, timeout: remaining };
}

export function runHistoricalV34CheckSync(scriptPath, args = ['--check'], options = {}) {
  const script = resolve(options.cwd ?? process.cwd(), scriptPath);
  if (!historicalV34Target(script, args)) throw new Error('Expected the exact read-only historical v34 assessment check');
  let state = readExecutionState(), directory;
  if (!state) {
    const localStartedMs = rootBudgetStartedMs();
    directory = mkdtempSync(join(tmpdir(), 'anxin-v7-history-v34-policy-'));
    const receiptPath = join(directory, 'execution.jsonl');
    writeFileSync(receiptPath, '', { flag: 'wx', mode: 0o600 });
    state = { policy: POLICY_ID, policy_sha256: POLICY_SHA256, started_ms: localStartedMs,
      root_deadline_ms: localStartedMs + ROOT_BUDGET_MS, deadline_ms: localStartedMs + ROOT_BUDGET_MS,
      depth: 0, receipt_path: receiptPath };
  }
  let failure;
  try {
    return nativeExecFileSync(process.execPath, [script, ...args], prepareHistoricalV34Options(script, args, options, state));
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (directory) {
      try {
        const events = readFileSync(state.receipt_path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
        writeSync(2, JSON.stringify({ execution_policy: POLICY_ID, policy_sha256: POLICY_SHA256,
          execution_adapter: 'historical-v34-execution/1', budget_mode: 'shared_absolute_deadline',
          maximum_root_budget_ms: ROOT_BUDGET_MS, cleanup_reserve_per_level_ms: CLEANUP_RESERVE_MS,
          target: historicalV34Target(script, args), status: failure ? 'FAIL' : 'PASS',
          scoring_semantics_changed: false, archived_source_bytes_changed: false, events }) + '\n');
      } catch (error) {
        if (failure) failure.executionPolicyReceiptError = error;
        else throw error;
      } finally {
        try { rmSync(directory, { recursive: true, force: true }); }
        catch (error) { if (failure) failure.executionPolicyCleanupError = error; else throw error; }
      }
    }
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [script, ...args] = process.argv.slice(2);
  if (!script) throw new Error('Expected the read-only historical v34 assessment path');
  const output = runHistoricalV34CheckSync(script, args, { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 16 * 1024 ** 2 });
  process.stdout.write(output);
}
