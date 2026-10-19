import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(process.env.V7_REVIEW_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const api = await import(pathToFileURL(resolve(root, 'scripts/owned-http-process-group.mjs')));

for (const options of [{}, { detached: true }, { detached: false }]) {
  test(`unsupported Windows rejects before spawning, including caller options ${JSON.stringify(options)}`, () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    const nativeSpawn = cp.spawn;
    let launches = 0;
    try {
      Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
      cp.spawn = () => {
        launches++;
        return Object.assign(new EventEmitter(), { pid: 12345, exitCode: null, signalCode: null });
      };
      syncBuiltinESMExports();
      assert.throws(() => api.spawnOwnedChild('synthetic-worker', [], options), error => {
        assert.equal(error.code, 'ERR_OWNED_HTTP_PLATFORM_UNSUPPORTED');
        assert.match(error.message, /Windows.*process.tree/iu);
        return true;
      });
      assert.equal(launches, 0, 'A rejected platform must not leave a launcher or descendant to clean up.');
    } finally {
      cp.spawn = nativeSpawn;
      syncBuiltinESMExports();
      Object.defineProperty(process, 'platform', platform);
    }
  });
}
