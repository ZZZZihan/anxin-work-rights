import { lstatSync, readFileSync, readlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startEnvironment } from './server.mjs';
import { loadEnvironment } from './environment.mjs';
import { attachStopControl } from './stop-control.mjs';

// These paths are checked inside the new mount/PID namespace only. No file
// contents from the existing HTTPS application are read by this environment.
try {
  for (const path of ['/home/carryz/.config/anxin', '/home/carryz/.local/share/anxin']) {
    try { lstatSync(path); throw new Error('Real path visible'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (process.env.ANXIN_CONFIG || process.env.SSH_AUTH_SOCK) throw new Error('Inherited credentials');
  const namespace = readlinkSync('/proc/self/ns/pid');
  const host = process.env.ANXIN_SYNTHETIC_HOST_PID_NS;
  const capEff = readFileSync('/proc/self/status', 'utf8').match(/^CapEff:\s+(\w+)$/m)?.[1];
  if (!/^pid:\[\d+\]$/.test(host ?? '') || namespace === host || !capEff || !/^0+$/.test(capEff)) throw new Error('Namespace or capability isolation invalid');
  const config = loadEnvironment(process.argv[2]);
  const writable = join(config.root, '.isolation-write-proof');
  writeFileSync(writable, 'synthetic probe', { mode: 0o600, flag: 'wx' }); unlinkSync(writable);
  const readonly = '/app/.isolation-write-proof';
  try { writeFileSync(readonly, 'synthetic probe', { flag: 'wx' }); unlinkSync(readonly); throw new Error('Release writable'); }
  catch (error) { if (!['EROFS', 'EACCES'].includes(error.code)) throw error; }
  console.log(JSON.stringify({ syntheticIsolation: true, realPathsAbsent: true, newPidNamespace: true, effectiveCapabilities: capEff, readonlyRelease: true, writableSyntheticRoot: true }));
  const fail = () => { console.error('Isolated synthetic startup or control failed; no fallback.'); process.exitCode = 1; };
  attachStopControl(process.stdin, () => startEnvironment(config.root), fail).catch(fail);
} catch { console.error('Synthetic namespace self-check failed; no fallback.'); process.exitCode = 1; }
