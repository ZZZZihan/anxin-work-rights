// Public current entrypoints call this execution-only adapter before entering
// unchanged archived source. Receipts go to stderr, leaving stdout JSON intact.
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLEANUP_RESERVE_MS, POLICY_ID, POLICY_SHA256, ROOT_BUDGET_MS, historicalTarget,
  nativeExecFileSync, prepareHistoricalOptions, readExecutionState, rootBudgetStartedMs } from './historical-execution-policy-v1.mjs';

export function runHistoricalCheckSync(scriptPath, args = [], options = {}) {
  const script = resolve(options.cwd ?? process.cwd(), scriptPath);
  if (!historicalTarget(script, args)) throw new Error('Expected an exact read-only historical v7 check');
  let state = readExecutionState(), directory;
  if (!state) {
    // Sequential entrypoint calls share this process's one absolute budget.
    // A later sibling gets only the remaining time, never another 15 minutes.
    const localStartedMs = rootBudgetStartedMs();
    directory = mkdtempSync(join(tmpdir(), 'anxin-v7-history-policy-'));
    const receiptPath = join(directory, 'execution.jsonl');
    writeFileSync(receiptPath, '', { flag: 'wx', mode: 0o600 });
    state = { policy: POLICY_ID, policy_sha256: POLICY_SHA256, started_ms: localStartedMs,
      root_deadline_ms: localStartedMs + ROOT_BUDGET_MS, deadline_ms: localStartedMs + ROOT_BUDGET_MS,
      depth: 0, receipt_path: receiptPath };
  }
  let failure;
  try {
    return nativeExecFileSync(process.execPath, [script, ...args], prepareHistoricalOptions(script, args, options, state));
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (directory) {
      try {
        const events = readFileSync(state.receipt_path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
        writeSync(2, JSON.stringify({ execution_policy: POLICY_ID, policy_sha256: POLICY_SHA256,
          budget_mode: 'shared_absolute_deadline', maximum_root_budget_ms: ROOT_BUDGET_MS,
          cleanup_reserve_per_level_ms: CLEANUP_RESERVE_MS, target: historicalTarget(script, args),
          status: failure ? 'FAIL' : 'PASS', scoring_semantics_changed: false, archived_source_bytes_changed: false, events }) + '\n');
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
  if (!script) throw new Error('Expected a read-only historical v7 check path');
  const output = runHistoricalCheckSync(script, args, { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 16 * 1024 ** 2 });
  process.stdout.write(output);
}
