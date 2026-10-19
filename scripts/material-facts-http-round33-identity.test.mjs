import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(process.env.V7_REVIEW_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const source = await readFile(resolve(root, 'scripts/owned-http-process-group.mjs'), 'utf8');
// Deterministic process-table reuse fixtures. No OS process or real PID is signalled.
function fixture({ platform = 'linux', token = false, alive = true, ignoreTerm = false, queryError = false } = {}) {
  const signals = [], spawns = [], queries = [];
  const child = Object.assign(new EventEmitter(), { pid: 43210, exitCode: null });
  const state = { alive, token, queryError };
  const table = () => `1 1 S\n${state.alive ? '43211 43210 S\n' : ''}`;
  const body = source.replace(/^import[^\n]*\n/gmu, '').replace(/^export /gmu, '');
  const api = vm.runInNewContext(body + '\n;({spawnOwnedChild,signalOwnedChild,ownedGroupAlive,stopChild});', {
    assert, randomUUID: () => 'synthetic-owned-nonce', Date,
    process: { platform, env: { ONLY_TEST: 'fixture' }, kill: (pid, signal) => {
      signals.push([pid, signal]);
      if (!ignoreTerm || signal === 'SIGKILL') state.alive = false;
    } },
    spawn: (command, args, options) => { spawns.push({ command, args, options }); return child; },
    execFile: (command, args, options, callback) => {
      queries.push('async-table');
      queueMicrotask(() => callback(null, table()));
      return { kill: () => {} };
    },
    execFileSync: (command, args) => {
      queries.push(args.join(' '));
      if (state.queryError) throw Object.assign(new Error('PRIVATE_ENV_SENTINEL'), { stdout: 'PRIVATE_ENV_SENTINEL', stderr: 'PRIVATE_ENV_SENTINEL' });
      return args.includes('command=') ? `node harmless ANXIN_OWNED_HTTP_NONCE=${state.token ? 'synthetic-owned-nonce' : 'other'}\n` : table();
    },
    readFileSync: () => `ONLY_TEST=fixture\0ANXIN_OWNED_HTTP_NONCE=${state.token ? 'synthetic-owned-nonce' : 'other'}\0`,
    setTimeout, clearTimeout, queueMicrotask,
  });
  api.spawnOwnedChild('synthetic', []);
  return { ...api, child, state, signals, spawns, queries, close: () => child.emit('close') };
}

test('completed cleanup never inspects or signals a subsequently reused PGID', async () => {
  const f = fixture({ alive: false }); f.close();
  await f.stopChild(f.child, 'completed', { graceMs: 30, killMs: 30 });
  const queryCount = f.queries.length;
  f.state.alive = true;
  await f.stopChild(f.child, 'repeat', { graceMs: 30, killMs: 30 });
  f.signalOwnedChild(f.child, 'SIGKILL');
  assert.equal(await f.ownedGroupAlive(f.child), false);
  assert.deepEqual(f.signals, []); assert.equal(f.queries.length, queryCount);
});

for (const platform of ['linux', 'darwin']) test(`closed launcher rejects an unrelated reused PGID on ${platform}`, async () => {
  const f = fixture({ platform }); f.close();
  await assert.rejects(f.stopChild(f.child, 'reused', { graceMs: 30, killMs: 30 }), /identity|termination both failed/u);
  assert.deepEqual(f.signals, []); assert.equal(f.state.alive, true);
});
for (const platform of ['linux', 'darwin']) test(`an inherited owner nonce permits orphan cleanup on ${platform}`, async () => {
  const f = fixture({ platform, token: true }); f.close();
  await f.stopChild(f.child, 'owned orphan', { graceMs: 30, killMs: 30 });
  assert.deepEqual(f.signals, [[-43210, 'SIGTERM']]);
  assert.equal(f.state.alive, false);
});

test('an exited launcher with inherited open pipes already needs identity verification', () => {
  const f = fixture(); f.child.emit('exit', 0, null);
  assert.throws(() => f.signalOwnedChild(f.child, 'SIGTERM'), { code: 'ERR_OWNED_HTTP_IDENTITY_UNVERIFIED' });
  assert.deepEqual(f.signals, []);
});
test('forced termination rechecks identity and never falls back to a stale PGID', async () => {
  const f = fixture({ token: true, ignoreTerm: true }); f.close();
  const originalSignal = f.signalOwnedChild;
  originalSignal(f.child, 'SIGTERM'); f.state.token = false;
  await assert.rejects(f.stopChild(f.child, 'reused before escalation', { graceMs: 30, killMs: 30 }), /identity|termination both failed/u);
  assert.deepEqual(f.signals, [[-43210, 'SIGTERM']]); assert.equal(f.state.alive, true);
});
test('identity inspection errors do not expose captured environment or send a signal', () => {
  const f = fixture({ token: true, queryError: true }); f.close();
  assert.throws(() => f.signalOwnedChild(f.child, 'SIGKILL'), error => {
    assert.equal(error.code, 'ERR_OWNED_HTTP_IDENTITY_UNVERIFIED');
    assert(!String(error).includes('PRIVATE_ENV_SENTINEL')); assert.equal(error.stdout, undefined); assert.equal(error.stderr, undefined);
    return true;
  });
  assert.deepEqual(f.signals, []);
});
test('fresh launch inherits the default environment and adds its own marker', () => {
  const f = fixture();
  assert.equal(f.spawns[0].options.env.ONLY_TEST, 'fixture');
  assert.equal(f.spawns[0].options.env.ANXIN_OWNED_HTTP_NONCE, 'synthetic-owned-nonce');
  f.signalOwnedChild(f.child, 'SIGTERM'); assert.deepEqual(f.signals, [[-43210, 'SIGTERM']]);
});
