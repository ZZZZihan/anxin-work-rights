import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(process.env.V7_REVIEW_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const { spawnOwnedChild, ownedGroupAlive, signalOwnedChild, stopChild } = await import(pathToFileURL(resolve(root, 'scripts/owned-http-process-group.mjs')));

test('a denied signal-zero probe does not replace actual owned-group membership inspection', { skip: process.platform === 'win32', timeout: 15000 }, async () => {
  const child = spawnOwnedChild(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
  await once(child, 'spawn');
  const nativeKill = process.kill;
  try {
    process.kill = function(pid, signal) {
      if (pid === -child.pid && signal === 0) throw Object.assign(new Error('synthetic EPERM for signal-zero probe'), { code: 'EPERM' });
      return nativeKill.call(process, pid, signal);
    };
    assert.equal(await ownedGroupAlive(child), true, 'A live owned member remains visible despite signal-zero permission ambiguity.');
    await stopChild(child, 'Synthetic signal-zero ambiguity', { graceMs: 1000, killMs: 1000 });
    assert.equal(await ownedGroupAlive(child), false);
    await stopChild(child, 'Repeated completed cleanup', { graceMs: 1000, killMs: 1000 });
  } finally {
    process.kill = nativeKill;
    if (child.exitCode === null && child.signalCode === null) { const closed = once(child, 'close'); child.kill('SIGKILL'); await closed; }
  }
});

test('actual termination permission errors remain failures', { skip: process.platform === 'win32', timeout: 15000 }, async () => {
  const child = spawnOwnedChild(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
  await once(child, 'spawn');
  const nativeKill = process.kill;
  try {
    process.kill = function(pid, signal) {
      if (pid === -child.pid && signal !== 0) throw Object.assign(new Error('synthetic actual termination EPERM'), { code: 'EPERM' });
      return nativeKill.call(process, pid, signal);
    };
    assert.throws(() => signalOwnedChild(child, 'SIGTERM'), { code: 'EPERM' });
    await assert.rejects(stopChild(child, 'Denied termination', { graceMs: 100, killMs: 100 }), error => error instanceof AggregateError && error.errors.every(item => item.code === 'EPERM'));
    assert.equal(await ownedGroupAlive(child), true);
  } finally {
    process.kill = nativeKill;
    const closed = once(child, 'close'); child.kill('SIGKILL'); await closed;
  }
});
