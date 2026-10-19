import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const helperPath = resolve(root, 'scripts/owned-http-process-group.mjs');
console.log(JSON.stringify({ evidence: 'round33_owned_identity_implementation', path: helperPath,
  sha256: createHash('sha256').update(fs.readFileSync(helperPath)).digest('hex') }));

// Directly import the unmodified ESM helper. The native API boundary is replaced
// for this controlled PGID-reuse test: no OS child is created and no real signal
// is sent. This is not a kernel PID-reuse experiment or a real HTTP test.
let fixtureNumber = 0;
async function fixture(run, { closed = false, alive = true, owner = true, ignoreTerm = false, callerEnv } = {}) {
  const original = { spawn: childProcess.spawn, execFile: childProcess.execFile,
    execFileSync: childProcess.execFileSync, readFileSync: fs.readFileSync, kill: process.kill };
  const fakePid = 43123456, memberPid = fakePid + 1;
  const child = Object.assign(new EventEmitter(), { pid: fakePid, exitCode: null });
  const observed = { signals: [], spawns: [], tables: 0, environmentReads: 0 };
  const state = { alive, owner, ignoreTerm };
  const table = () => { observed.tables++; return `1 1 S\n${state.alive ? `${memberPid} ${fakePid} S\n` : ''}`; };
  const environment = () => {
    observed.environmentReads++;
    const token = observed.spawns[0]?.options.env?.ANXIN_OWNED_HTTP_NONCE;
    return `SYNTHETIC_FIXTURE_ONLY=1\0ANXIN_OWNED_HTTP_NONCE=${state.owner ? token : 'unrelated-current-group'}\0`;
  };
  try {
    childProcess.spawn = (command, args, options) => { observed.spawns.push({ command, args, options }); return child; };
    childProcess.execFile = (command, args, options, callback) => {
      assert.equal(command, '/bin/ps'); assert.deepEqual(args, ['-axo', 'pid=,pgid=,stat=']);
      queueMicrotask(() => callback(null, table()));
      return { kill: () => { throw new Error('The synthetic immediate query must not reach a timeout.'); } };
    };
    childProcess.execFileSync = (command, args) => {
      assert.equal(command, '/bin/ps');
      if (args.includes('-axo')) return table();
      assert.deepEqual(args, ['-Eww', '-p', String(memberPid), '-o', 'command=']);
      return environment().replaceAll('\0', ' ');
    };
    fs.readFileSync = (path, ...args) => String(path) === `/proc/${memberPid}/environ` ? environment() : original.readFileSync(path, ...args);
    process.kill = (pid, signal) => {
      assert.equal(pid, -fakePid, 'Only the synthetic owned group may receive a simulated signal.');
      observed.signals.push(signal);
      if (!state.ignoreTerm || signal === 'SIGKILL') {
        state.alive = false; child.exitCode = 0; child.emit('exit', 0, null); child.emit('close', 0, null);
      }
    };
    syncBuiltinESMExports();
    const api = await import(pathToFileURL(helperPath).href + '?independent-fixture=' + (++fixtureNumber));
    const options = callerEnv ? { env: callerEnv } : {};
    const owned = api.spawnOwnedChild('synthetic-no-child', [], options);
    assert.equal(owned, child); assert.equal(observed.spawns[0].options.detached, true);
    if (closed) { child.exitCode = 0; child.emit('exit', 0, null); child.emit('close', 0, null); }
    await run({ api, child, state, observed });
  } finally {
    childProcess.spawn = original.spawn; childProcess.execFile = original.execFile;
    childProcess.execFileSync = original.execFileSync; fs.readFileSync = original.readFileSync;
    process.kill = original.kill; syncBuiltinESMExports();
  }
}

test('a completed cleanup is terminal even when its numeric PGID later has unrelated members', async () => {
  await fixture(async ({ api, child, state, observed }) => {
    await api.stopChild(child, 'first successful cleanup', { graceMs: 25, killMs: 25 });
    const queriesAfterCleanup = observed.tables;
    state.alive = true; state.owner = false;
    await api.stopChild(child, 'repeat cleanup', { graceMs: 25, killMs: 25 });
    api.signalOwnedChild(child, 'SIGKILL');
    assert.deepEqual(observed.signals, []); assert.equal(observed.tables, queriesAfterCleanup);
    assert.equal(state.alive, true, 'An unrelated synthetic group must remain untouched.');
  }, { closed: true, alive: false });
});

test('a closed launcher cannot signal a different group reusing its numeric PGID', async () => {
  await fixture(async ({ api, child, state, observed }) => {
    await assert.rejects(api.stopChild(child, 'reused numeric group', { graceMs: 25, killMs: 25 }));
    assert.deepEqual(observed.signals, []); assert.equal(state.alive, true);
  }, { closed: true, owner: false });
});

test('exit observed before pipe close already requires current group identity', async () => {
  await fixture(async ({ api, child, observed }) => {
    child.emit('exit', 0, null);
    assert.throws(() => api.signalOwnedChild(child, 'SIGTERM'));
    assert.deepEqual(observed.signals, []);
  }, { owner: false });
});

test('an orphan retaining the inherited ownership marker can still be cleaned', async () => {
  await fixture(async ({ api, child, observed, state }) => {
    await api.stopChild(child, 'owned orphan', { graceMs: 25, killMs: 25 });
    assert.deepEqual(observed.signals, ['SIGTERM']); assert.equal(state.alive, false);
  }, { closed: true });
});

test('identity must be rechecked before escalation after the first signal', async () => {
  await fixture(async ({ api, child, state, observed }) => {
    api.signalOwnedChild(child, 'SIGTERM');
    assert.deepEqual(observed.signals, ['SIGTERM']);
    state.owner = false;
    await assert.rejects(api.stopChild(child, 'group changed before escalation', { graceMs: 25, killMs: 25 }));
    assert.deepEqual(observed.signals, ['SIGTERM']); assert.equal(state.alive, true);
  }, { closed: true, ignoreTerm: true });
});

test('the ownership marker overrides a caller supplied marker without removing the caller environment', async () => {
  await fixture(async ({ observed }) => {
    const env = observed.spawns[0].options.env;
    assert.equal(env.SYNTHETIC_FIXTURE_ONLY, 'preserved');
    assert.equal(typeof env.ANXIN_OWNED_HTTP_NONCE, 'string');
    assert.notEqual(env.ANXIN_OWNED_HTTP_NONCE, 'caller-controlled-marker');
  }, { callerEnv: { SYNTHETIC_FIXTURE_ONLY: 'preserved', ANXIN_OWNED_HTTP_NONCE: 'caller-controlled-marker' } });
});

test('an active owned launcher still follows the bounded normal termination path', async () => {
  await fixture(async ({ api, child, state, observed }) => {
    await api.stopChild(child, 'active owner', { graceMs: 25, killMs: 25 });
    assert.deepEqual(observed.signals, ['SIGTERM']); assert.equal(state.alive, false);
  });
});
