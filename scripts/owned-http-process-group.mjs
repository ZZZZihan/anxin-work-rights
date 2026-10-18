import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';

// Only children created here may be signalled. Register close before returning
// the child: a launcher can exit before its caller installs readiness handlers.
const owned = new WeakMap();
const pause = ms => new Promise(done => setTimeout(done, ms));

export function spawnOwnedChild(command, args, options = {}) {
  const child = spawn(command, args, { stdio: 'ignore', ...options, detached: process.platform !== 'win32' });
  const state = { closed: false };
  child.once('close', () => { state.closed = true; });
  child.once('error', () => {}); // The caller still handles startup errors.
  owned.set(child, state);
  return child;
}

export function signalOwnedChild(child, signal) {
  if (!child) return;
  assert(owned.has(child), 'Only runner-owned detached children may be signalled.');
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) { if (error.code !== 'ESRCH') throw error; }
}

function processTable(timeoutMs) {
  return new Promise((resolve, reject) => {
    let completed = false, hardTimer;
    const finish = (error, stdout) => {
      if (completed) return;
      completed = true; clearTimeout(hardTimer);
      if (error) reject(error); else resolve(stdout);
    };
    // No arguments, environment, or command lines are collected. execFile's
    // callback waits for close; SIGKILL bounds a stuck query, including pipes.
    const child = execFile('/bin/ps', ['-axo', 'pid=,pgid=,stat='], {
      encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
    }, finish);
    hardTimer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('Owned process-group inspection did not close within its deadline.'));
    }, timeoutMs + 500);
  });
}

export async function ownedGroupAlive(child, timeoutMs = 1000) {
  assert(owned.has(child), 'Only runner-owned process groups may be inspected.');
  if (!child.pid) return false;
  if (process.platform === 'win32') return child.exitCode === null && child.signalCode === null;
  // Group signal probes can report EPERM after the group has disappeared on
  // macOS. The bounded, validated process table below establishes live members;
  // a signal error or a failed/empty table never counts as successful cleanup.
  const table = await processTable(Math.max(1, Math.min(1000, timeoutMs)));
  assert(table.trim(), 'Empty process table cannot establish owned-group cleanup.');
  let alive = false;
  for (const line of table.trim().split('\n')) {
    const fields = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*$/u.exec(line);
    assert(fields && Number.isSafeInteger(Number(fields[1])) && Number(fields[1]) > 0 && Number.isSafeInteger(Number(fields[2])), 'Cannot parse owned process-group inspection.');
    // kill(-pgid, 0) succeeds for unreaped zombies under Linux PID 1. They hold
    // no listening sockets and cannot be killed again; their owner must reap.
    if (Number(fields[2]) === child.pid && !/^[ZX]/iu.test(fields[3])) alive = true;
  }
  return alive;
}

export async function stopChild(child, name, { graceMs = 5000, killMs = 5000 } = {}) {
  if (!child) return;
  const state = owned.get(child);
  assert(state, 'Only runner-owned children may be stopped.');
  assert(Number.isFinite(graceMs) && graceMs > 0 && Number.isFinite(killMs) && killMs > 0, 'Cleanup deadlines must be finite positive durations.');
  const stoppedBy = async deadline => {
    while (Date.now() < deadline) {
      // Keep the query's own bounded budget. Passing the last 1ms of the TERM
      // grace period to ps would turn a healthy query into a cleanup failure.
      // A phase can exceed its polling deadline by at most this one query.
      if (state.closed && !await ownedGroupAlive(child)) return true;
      await pause(Math.max(1, Math.min(20, deadline - Date.now())));
    }
    return false;
  };
  try {
    if (state.closed && !await ownedGroupAlive(child)) return;
    signalOwnedChild(child, 'SIGTERM');
    if (await stoppedBy(Date.now() + graceMs)) return;
    // close alone cannot establish completion: a descendant may redirect stdio
    // and ignore TERM after the launcher has already exited.
    signalOwnedChild(child, 'SIGKILL');
    if (!await stoppedBy(Date.now() + killMs)) throw new Error(`${name} did not close or retained a live process-group member after SIGKILL.`);
  } catch (error) {
    // An inspection failure is never proof of cleanup. Still kill our group,
    // retain the original error, and let the runner preserve its private state.
    try { signalOwnedChild(child, 'SIGKILL'); }
    catch (killError) { throw new AggregateError([error, killError], `${name} cleanup and forced termination both failed.`); }
    throw error;
  }
}
