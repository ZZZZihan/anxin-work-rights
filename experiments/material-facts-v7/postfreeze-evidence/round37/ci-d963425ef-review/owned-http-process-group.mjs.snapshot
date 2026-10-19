import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Only children created here may be signalled. Register close before returning
// the child: a launcher can exit before its caller installs readiness handlers.
const owned = new WeakMap();
const pause = ms => new Promise(done => setTimeout(done, ms));
const ownershipKey = 'ANXIN_OWNED_HTTP_NONCE';

export function spawnOwnedChild(command, args, options = {}) {
  // Windows has no POSIX process group. Killing only the launcher (or using
  // taskkill after that launcher exits) cannot prove its descendants are gone.
  // Until a native owned-tree implementation is available and tested, refuse
  // before spawning so a failed runner cannot leave a worker behind.
  if (process.platform === 'win32') throw Object.assign(new Error('Windows HTTP runners require a verified owned process-tree implementation; no child was started.'), { code: 'ERR_OWNED_HTTP_PLATFORM_UNSUPPORTED' });
  const nonce = randomUUID();
  const child = spawn(command, args, { stdio: 'ignore', ...options, detached: true,
    env: { ...options.env ?? process.env, [ownershipKey]: nonce } });
  const state = { exited: false, closed: false, cleaned: false, nonce };
  child.once('exit', () => { state.exited = true; });
  child.once('close', () => { state.closed = true; });
  child.once('error', () => {}); // The caller still handles startup errors.
  owned.set(child, state);
  return child;
}

export function signalOwnedChild(child, signal) {
  if (!child) return;
  assert(owned.has(child), 'Only runner-owned detached children may be signalled.');
  const state = owned.get(child);
  if (!child.pid || state.cleaned) return;
  // A closed launcher's numeric PGID can have been reused. Revalidate an
  // inherited ownership nonce before EVERY later signal, including escalation.
  // This bounds accidental reuse; inspection and POSIX kill are not atomic.
  if ((state.exited || state.closed) && !verifyClosedGroupIdentity(child, state)) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) { if (error.code !== 'ESRCH') throw error; }
}

function parseMembers(table, pgid) {
  assert(table.trim(), 'Empty process table cannot establish owned-group cleanup.');
  const members = [];
  for (const line of table.trim().split('\n')) {
    const fields = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*$/u.exec(line);
    assert(fields && Number.isSafeInteger(Number(fields[1])) && Number(fields[1]) > 0 && Number.isSafeInteger(Number(fields[2])), 'Cannot parse owned process-group inspection.');
    if (Number(fields[2]) === pgid && !/^[ZX]/iu.test(fields[3])) members.push(Number(fields[1]));
  }
  return members;
}

function verifyClosedGroupIdentity(child, state) {
  try {
    const deadline = Date.now() + 2000;
    const table = execFileSync('/bin/ps', ['-axo', 'pid=,pgid=,stat='], { encoding: 'utf8', timeout: 1000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    const members = parseMembers(table, child.pid);
    if (!members.length) { if (state.closed) state.cleaned = true; return false; }
    assert(members.length <= 1024, 'Owned process group is too large to inspect.');
    const token = `${ownershipKey}=${state.nonce}`;
    for (const pid of members) {
      assert(Date.now() < deadline, 'Owned process identity inspection timed out.');
      try {
        // Environment data stays in this function and is never returned or
        // attached to errors. Only an exact non-secret ownership token matters.
        if (process.platform === 'linux') {
          const environment = readFileSync(`/proc/${pid}/environ`, 'utf8');
          if (environment.split('\0').includes(token)) return true;
        } else if (process.platform === 'darwin') {
          const environment = execFileSync('/bin/ps', ['-Eww', '-p', String(pid), '-o', 'command='], {
            encoding: 'utf8', timeout: Math.max(1, Math.min(1000, deadline - Date.now())), killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
          });
          if (environment.split(/\s+/u).includes(token)) return true;
        }
      } catch { /* A vanished or unreadable member is not identity proof. */ }
    }
  } catch { /* Never expose subprocess stdout/stderr or private environment. */ }
  throw Object.assign(new Error('Cannot establish the closed launcher process-group identity; no signal was sent.'), { code: 'ERR_OWNED_HTTP_IDENTITY_UNVERIFIED' });
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
  const state = owned.get(child);
  if (!child.pid || state.cleaned) return false;
  // Group signal probes can report EPERM after the group has disappeared on
  // macOS. The bounded, validated process table below establishes live members;
  // a signal error or a failed/empty table never counts as successful cleanup.
  const table = await processTable(Math.max(1, Math.min(1000, timeoutMs)));
  // Unreaped zombies own no listening sockets and cannot be killed again.
  const alive = parseMembers(table, child.pid).length > 0;
  if (state.closed && !alive) state.cleaned = true;
  return alive;
}

export async function stopChild(child, name, { graceMs = 5000, killMs = 5000 } = {}) {
  if (!child) return;
  const state = owned.get(child);
  assert(state, 'Only runner-owned children may be stopped.');
  if (state.cleaned) return;
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
    // Inspection failure is not cleanup. A closed group must still pass its
    // identity check before forced termination; a stale PGID gets no signal.
    try { signalOwnedChild(child, 'SIGKILL'); }
    catch (killError) { throw new AggregateError([error, killError], `${name} cleanup and forced termination both failed.`); }
    throw error;
  }
}
