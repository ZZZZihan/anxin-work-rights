// Explicit execution-only policy for archived, read-only checks. Archived source
// bytes and scoring stay unchanged. This module does nothing without its state.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const POLICY_ID = 'material-facts-v7-historical-execution/1';
export const STATE_ENV = 'ANXIN_MFV7_HISTORICAL_EXECUTION_V1';
export const ROOT_BUDGET_MS = 15 * 60 * 1000;
export const CLEANUP_RESERVE_MS = 2000;
export const POLICY_URL = import.meta.url;
export const POLICY_SHA256 = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex');
// Temporary copies can import the same policy through another file URL. Keep
// one real native function and one preload per process, rather than wrapping an
// already patched function or restarting the shared budget in the second copy.
const registryKey = Symbol.for('anxin.material-facts-v7.historical-execution/1');
const existing = globalThis[registryKey];
if (existing && existing.policy_sha256 !== POLICY_SHA256) throw new Error('Conflicting historical execution policy bytes in one process');
const registry = existing ?? { policy_sha256: POLICY_SHA256, native: childProcess.execFileSync,
  preload_url: POLICY_URL, patched: false, started_ms: null };
globalThis[registryKey] = registry;
export const nativeExecFileSync = registry.native;
export function rootBudgetStartedMs() { return registry.started_ms ??= Date.now(); }

export function historicalTarget(script, args) {
  if (typeof script !== 'string' || !Array.isArray(args) || !args.every(arg => typeof arg === 'string')) return null;
  const path = resolve(script), name = basename(path);
  if (!dirname(path).endsWith(`${sep}experiments${sep}material-facts-v7`)) return null;
  if ((name === 'verify.mjs' || name === 'verify-frozen.mjs' || /^verify-correction-v[1-7]\.mjs$/u.test(name)) && args.length === 0)
    return `experiments/material-facts-v7/${name}`;
  if ((name === 'summarize.mjs' || /^corrective-assessment(?:-v[2-8])?\.mjs$/u.test(name)) && args.length === 1 && args[0] === '--check')
    return `experiments/material-facts-v7/${name}`;
  return null;
}

export function readExecutionState(env = process.env) {
  if (!env[STATE_ENV]) return null;
  const state = JSON.parse(env[STATE_ENV]);
  if (state.policy !== POLICY_ID || state.policy_sha256 !== POLICY_SHA256
    || !Number.isSafeInteger(state.started_ms) || !Number.isSafeInteger(state.root_deadline_ms)
    || !Number.isSafeInteger(state.deadline_ms) || state.root_deadline_ms <= state.started_ms
    || state.root_deadline_ms - state.started_ms > ROOT_BUDGET_MS || state.deadline_ms > state.root_deadline_ms
    || !Number.isSafeInteger(state.depth) || state.depth < 0 || state.depth > 256
    || typeof state.receipt_path !== 'string' || !isAbsolute(state.receipt_path)) {
    throw new Error('Invalid historical execution policy state');
  }
  return state;
}

export function recordExecutionEvent(state, event) {
  appendFileSync(state.receipt_path, JSON.stringify({ policy: POLICY_ID, pid: process.pid, ...event }) + '\n');
}

export function prepareHistoricalOptions(script, args, options, state) {
  const target = historicalTarget(script, args);
  if (!target) throw new Error('Historical execution policy only accepts exact read-only v7 verification commands');
  const now = Date.now(), deadline = state.deadline_ms - CLEANUP_RESERVE_MS;
  const remaining = deadline - now;
  if (remaining <= 0) {
    recordExecutionEvent(state, { event: 'budget_exhausted', target, depth: state.depth + 1, deadline_ms: deadline });
    const error = new Error('Shared historical execution deadline exhausted before starting another check');
    error.code = 'ETIMEDOUT';
    throw error;
  }
  const next = { ...state, deadline_ms: deadline, depth: state.depth + 1 };
  const env = { ...(options.env ?? process.env) };
  // fileURL has percent-encoded spaces. NODE_OPTIONS is interpreted by Node,
  // never a shell, and the same absolute preload is inherited by old children.
  const preload = `--import=${registry.preload_url}`;
  env.NODE_OPTIONS = (env.NODE_OPTIONS ?? '').split(/\s+/u).includes(preload)
    ? env.NODE_OPTIONS : [env.NODE_OPTIONS, preload].filter(Boolean).join(' ');
  env[STATE_ENV] = JSON.stringify(next);
  recordExecutionEvent(state, { event: 'child_budget', target, args, depth: next.depth,
    requested_timeout_ms: options.timeout ?? null, effective_timeout_ms: remaining,
    parent_deadline_ms: state.deadline_ms, child_deadline_ms: deadline,
    cleanup_reserve_ms: CLEANUP_RESERVE_MS });
  return { ...options, env, timeout: remaining };
}

const active = readExecutionState();
if (active && !registry.patched) {
  registry.patched = true;
  recordExecutionEvent(active, { event: 'preload_active', depth: active.depth, policy_sha256: POLICY_SHA256 });
  childProcess.execFileSync = function execFileSyncWithHistoricalBudget(file, args, options) {
    if (file !== process.execPath || !Array.isArray(args) || !historicalTarget(args[0], args.slice(1)))
      return nativeExecFileSync(file, args, options);
    return nativeExecFileSync(file, args, prepareHistoricalOptions(args[0], args.slice(1), options ?? {}, readExecutionState()));
  };
  // Old snapshots import the named ESM builtin. Keep that binding synchronized
  // with this explicit execution policy; no source transformation is involved.
  syncBuiltinESMExports();
}
