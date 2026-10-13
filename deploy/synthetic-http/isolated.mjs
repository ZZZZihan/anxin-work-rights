import { existsSync, lstatSync, mkdirSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from './environment.mjs';

export function isolationArgs(release, root) {
  const config = loadEnvironment(root);
  const code = resolve(release);
  if (lstatSync(code).isSymbolicLink() || realpathSync(code) !== code || !existsSync(join(code, 'dist/server/index.js')) || !existsSync(join(code, 'deploy/synthetic-http/sandbox-entry.mjs'))) throw new Error('A canonical fresh synthetic release is required.');
  const node = realpathSync(process.execPath);
  if (!lstatSync(node).isFile()) throw new Error('A real Node binary is required.');
  const args = ['--die-with-parent', '--new-session', '--unshare-all', '--share-net', '--clearenv', '--cap-drop', 'ALL', '--ro-bind', '/usr', '/usr'];
  for (const path of ['/bin', '/sbin', '/lib', '/lib64']) {
    if (!existsSync(path)) continue;
    if (lstatSync(path).isSymbolicLink()) args.push('--symlink', readlinkSync(path), path);
    else args.push('--ro-bind', path, path);
  }
  args.push('--dir', '/etc');
  for (const path of ['/etc/hosts', '/etc/resolv.conf', '/etc/nsswitch.conf', '/etc/passwd', '/etc/group', '/etc/ld.so.cache']) if (existsSync(path)) args.push('--ro-bind', path, path);
  args.push('--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--tmpfs', '/run');
  const parents = [];
  for (let path = dirname(config.root); path !== '/'; path = dirname(path)) parents.unshift(path);
  for (const path of parents) if (!['/tmp', '/run', '/usr', '/etc'].includes(path)) args.push('--dir', path);
  args.push('--dir', '/runtime', '--ro-bind', node, '/runtime/node', '--ro-bind', code, '/app', '--bind', config.root, config.root, '--chdir', '/app');
  for (const [key, value] of Object.entries({ PATH: '/runtime:/usr/bin:/bin', HOME: join(config.root, 'home'), XDG_CACHE_HOME: join(config.root, 'cache'), XDG_CONFIG_HOME: join(config.root, 'home/.config'), TMPDIR: '/tmp', NODE_ENV: 'production', WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false', CI: '1', ANXIN_SYNTHETIC_HOST_PID_NS: existsSync('/proc/self/ns/pid') ? readlinkSync('/proc/self/ns/pid') : 'offline-not-executed' })) args.push('--setenv', key, value);
  args.push('/runtime/node', '/app/deploy/synthetic-http/sandbox-entry.mjs', config.root);
  return args;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    if (process.platform !== 'linux') throw new Error('Linux isolation is required.');
    const [release, root] = process.argv.slice(2);
    const args = isolationArgs(release, root);
    for (const directory of ['home', 'cache']) mkdirSync(join(root, directory), { mode: 0o700, recursive: true });
    const child = spawn('/usr/bin/bwrap', args, { stdio: ['pipe', 'inherit', 'inherit'] });
    let stopping = false, force;
    child.stdin.on('error', () => { process.exitCode = 1; });
    child.on('error', () => { console.error('bwrap unavailable; no bare-process fallback.'); process.exitCode = 1; });
    child.on('exit', (code) => { clearTimeout(force); child.stdin.destroy(); process.exitCode = code ?? 1; });
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
      if (stopping) return; stopping = true;
      child.stdin.end('stop\n');
      force = setTimeout(() => child.kill('SIGKILL'), 10_000);
    });
  } catch { console.error('Synthetic isolation refused; no fallback.'); process.exitCode = 1; }
}
