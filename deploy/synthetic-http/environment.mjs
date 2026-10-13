import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const purpose = 'anxin-synthetic-http-v1';
export const maxLifetime = 4 * 60 * 60 * 1000;
export const sessionLifetime = 30 * 60 * 1000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const remoteBase = '/home/carryz/.local/share/anxin-synthetic';
const allowedBases = () => [realpathSync(tmpdir()), realpathSync('/tmp'), remoteBase];

function ipv4(value) {
  if (isIP(value) !== 4) throw new Error('An explicit IPv4 address is required.');
  return value.split('.').reduce((number, part) => number * 256 + Number(part), 0);
}
function privateRange(start, end = start) {
  return [[0x0a000000, 0x0affffff], [0xac100000, 0xac1fffff], [0xc0a80000, 0xc0a8ffff]]
    .some(([low, high]) => start >= low && end <= high);
}
export function parseCidr(value) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+\.\d+\/(?:[0-9]|[12][0-9]|3[0-2])$/.test(value)) throw new Error('An exact IPv4 source CIDR is required.');
  const [ip, bits] = value.split('/');
  const prefix = Number(bits);
  const start = ipv4(ip);
  const size = 2 ** (32 - prefix);
  if (prefix === 0 || start % size !== 0) throw new Error('Source CIDR must use a canonical bounded network.');
  const end = start + size - 1;
  // Explicit private ranges or individual unicast/NAT source addresses only.
  if (!privateRange(start, end) && !(prefix === 32 && start >= 0x01000000 && start < 0xe0000000)) throw new Error('Public sources must be explicit /32 addresses.');
  return { value, start, end };
}
export function sourceAllowed(address, cidrs) {
  const value = address?.startsWith('::ffff:') ? address.slice(7) : address;
  if (typeof value !== 'string' || isIP(value) !== 4) return false;
  const number = ipv4(value);
  return cidrs.some((cidr) => { const range = parseCidr(cidr); return number >= range.start && number <= range.end; });
}
export function validateNetwork({ bindIp = '127.0.0.1', port = 18090, workerPort = 18897, allowCidrs, publicOrigin } = {}) {
  if (bindIp !== '127.0.0.1' && !privateRange(ipv4(bindIp))) throw new Error('LAN binding must be one RFC1918 IPv4 address.');
  for (const value of [port, workerPort]) if (!Number.isInteger(value) || value < 1024 || value > 65535 || [8444, 18797].includes(value)) throw new Error('Invalid or reserved synthetic port.');
  if (port === workerPort) throw new Error('Gateway and Worker ports must differ.');
  if (publicOrigin) {
    const url = new URL(publicOrigin);
    if (bindIp !== '127.0.0.1' || url.protocol !== 'http:' || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.origin !== publicOrigin || !privateRange(ipv4(url.hostname))) throw new Error('Proxy mode requires an explicit RFC1918 HTTP origin on port 80 and loopback listener.');
  }
  const sources = allowCidrs ?? (bindIp === '127.0.0.1' && !publicOrigin ? ['127.0.0.1/32'] : []);
  if (!Array.isArray(sources) || !sources.length || sources.length > 16) throw new Error('LAN requires explicit source CIDRs.');
  sources.forEach(parseCidr);
  if (bindIp === '127.0.0.1' && !publicOrigin && (sources.length !== 1 || sources[0] !== '127.0.0.1/32')) throw new Error('Loopback accepts only the loopback source.');
  return { bindIp, port, workerPort, allowCidrs: [...new Set(sources)], ...(publicOrigin ? { publicOrigin, proxyMode: true } : {}) };
}
function noSymlinks(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const state = lstatSync(path);
    if (state.isSymbolicLink()) throw new Error('Synthetic paths must not contain symlinks.');
    if (state.isDirectory()) noSymlinks(path);
  }
}
function privateFile(path, directory = false) {
  const state = lstatSync(path);
  if (state.isSymbolicLink() || (directory ? !state.isDirectory() : !state.isFile()) || (state.mode & 0o777) !== (directory ? 0o700 : 0o600) || (process.getuid && state.uid !== process.getuid())) throw new Error('Synthetic path ownership or mode is invalid.');
}
function generatedRoot(root) {
  const path = resolve(root);
  if (!/^anxin-synthetic-[0-9a-f-]{36}$/.test(basename(path)) || !allowedBases().includes(dirname(path))) throw new Error('Only a generated synthetic root is allowed.');
  privateFile(path, true);
  if (realpathSync(path) !== path) throw new Error('Synthetic root must not use symlinks.');
  return path;
}
export function createEnvironment({ baseDirectory = tmpdir(), ttlMinutes = 240, release = 'local-synthetic', directEntry = false, persistentDemo = false, ...network } = {}) {
  if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > 240) throw new Error('Synthetic lifetime must be 1 to 240 minutes.');
  if (typeof directEntry !== 'boolean') throw new Error('Direct entry must be explicitly boolean.');
  if (typeof persistentDemo !== 'boolean' || (persistentDemo && !directEntry)) throw new Error('Persistent Demo requires explicit direct entry.');
  if (release !== 'local-synthetic' && !/^[a-f0-9]{40}$/.test(release)) throw new Error('Invalid synthetic release.');
  const scope = validateNetwork(network);
  const requested = resolve(baseDirectory);
  // The real application's directories are never accepted or inspected.
  if (![resolve(tmpdir()), '/tmp', realpathSync('/tmp'), remoteBase].includes(requested)) throw new Error('Synthetic base must be temporary or the dedicated synthetic directory.');
  mkdirSync(requested, { recursive: true, mode: 0o700 });
  const base = realpathSync(requested);
  if (!allowedBases().includes(base) || (requested === remoteBase && lstatSync(requested).isSymbolicLink())) throw new Error('Synthetic base must not be redirected.');
  const environmentId = randomUUID();
  const root = join(base, `anxin-synthetic-${environmentId}`);
  mkdirSync(root, { mode: 0o700 });
  mkdirSync(join(root, 'state'), { mode: 0o700 });
  const created = Date.now();
  const createdAt = new Date(created).toISOString();
  const expiresAt = persistentDemo ? null : new Date(created + ttlMinutes * 60_000).toISOString();
  const marker = { purpose, environmentId, root, createdAt, expiresAt, persistentDemo };
  writeFileSync(join(root, '.synthetic-environment.json'), JSON.stringify(marker), { mode: 0o600, flag: 'wx' });
  const access = [];
  const users = ['synthetic-a', 'synthetic-b'].map((username) => {
    const password = randomBytes(24).toString('base64url');
    const salt = randomBytes(32).toString('hex');
    access.push({ username, password });
    return { username, id: `synthetic-${environmentId}-${username}`, displayName: '合成验收账户', email: `${username}@synthetic.invalid`, salt, passwordHash: scryptSync(password, salt, 64).toString('hex') };
  });
  const config = { ...marker, ...scope, release, directEntry, origin: scope.publicOrigin ?? `http://${scope.bindIp}:${scope.port}`, cookieName: `anxin-synthetic-${environmentId}`, sessionKey: randomBytes(48).toString('hex'), ...(scope.proxyMode ? { proxyKey: randomBytes(32).toString('hex') } : {}), users };
  writeFileSync(join(root, 'config.json'), JSON.stringify(config, null, 2), { mode: 0o600, flag: 'wx' });
  writeFileSync(join(root, 'access.json'), JSON.stringify({ purpose, environmentId, origin: config.origin, expiresAt, accounts: access }, null, 2), { mode: 0o600, flag: 'wx' });
  return { root, environmentId, origin: config.origin, expiresAt };
}
export function loadEnvironment(root, { allowExpired = false } = {}) {
  const path = generatedRoot(root);
  const markerPath = join(path, '.synthetic-environment.json');
  privateFile(markerPath);
  const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  if (marker.purpose !== purpose || !uuid.test(marker.environmentId) || marker.root !== path || basename(path) !== `anxin-synthetic-${marker.environmentId}`) throw new Error('Synthetic marker mismatch.');
  noSymlinks(path);
  privateFile(join(path, 'config.json'));
  privateFile(join(path, 'state'), true);
  const config = JSON.parse(readFileSync(join(path, 'config.json'), 'utf8'));
  for (const field of ['purpose', 'environmentId', 'root', 'createdAt', 'expiresAt']) if (config[field] !== marker[field]) throw new Error('Synthetic configuration marker mismatch.');
  if (config.directEntry !== undefined && typeof config.directEntry !== 'boolean') throw new Error('Invalid direct-entry configuration.');
  for (const value of [config.persistentDemo, marker.persistentDemo]) if (value !== undefined && typeof value !== 'boolean') throw new Error('Invalid persistent Demo configuration.');
  const persistent = config.persistentDemo === true;
  if (persistent !== (marker.persistentDemo === true) || (persistent && config.directEntry !== true)) throw new Error('Persistent Demo marker or direct entry mismatch.');
  const created = Date.parse(config.createdAt);
  if (!Number.isFinite(created) || created > Date.now() + 1000) throw new Error('Synthetic creation time is invalid.');
  if (persistent) {
    if (config.expiresAt !== null) throw new Error('Persistent Demo must not have an expiry.');
  } else {
    const lifetime = Date.parse(config.expiresAt) - created;
    if (!Number.isFinite(lifetime) || lifetime <= 0 || lifetime > maxLifetime || (!allowExpired && Date.parse(config.expiresAt) <= Date.now())) throw new Error('Synthetic environment expired or lifetime invalid.');
  }
  validateNetwork(config);
  if (Boolean(config.proxyMode) !== Boolean(config.publicOrigin) || (config.proxyMode ? !/^[a-f0-9]{64}$/.test(config.proxyKey) : config.proxyKey !== undefined)) throw new Error('Invalid synthetic proxy configuration.');
  if (config.origin !== (config.publicOrigin ?? `http://${config.bindIp}:${config.port}`) || config.cookieName !== `anxin-synthetic-${config.environmentId}` || !/^[a-f0-9]{96}$/.test(config.sessionKey) || config.users?.length !== 2 || new Set(config.users.map((user) => user.username)).size !== 2 || config.users.some((user) => user.id !== `synthetic-${config.environmentId}-${user.username}` || !['synthetic-a', 'synthetic-b'].includes(user.username) || !/^[a-f0-9]{64}$/.test(user.salt) || !/^[a-f0-9]{128}$/.test(user.passwordHash))) throw new Error('Invalid synthetic identity configuration.');
  return { ...config, stateDir: join(path, 'state') };
}
export function removeEnvironment(root, environmentId) {
  const config = loadEnvironment(root, { allowExpired: true });
  if (config.environmentId !== environmentId || existsSync(join(config.root, '.runtime.json'))) throw new Error('Wrong marker or live instance: synthetic cleanup refused.');
  rmSync(config.root, { recursive: true });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'create') {
      const options = {};
      for (let i = 0; i < args.length; i += 2) {
        const key = args[i], value = args[i + 1];
        if (!value) throw new Error('Missing option value.');
        if (key === '--allow-cidr') (options.allowCidrs ??= []).push(value);
        else if (key === '--bind-ip') options.bindIp = value;
        else if (key === '--base-dir') options.baseDirectory = value;
        else if (key === '--public-origin') options.publicOrigin = value;
        else if (key === '--release') options.release = value;
        else if (key === '--direct-entry' && ['true', 'false'].includes(value)) options.directEntry = value === 'true';
        else if (key === '--persistent-demo' && ['true', 'false'].includes(value)) options.persistentDemo = value === 'true';
        else if (['--port', '--worker-port', '--ttl-minutes'].includes(key)) options[{ '--port': 'port', '--worker-port': 'workerPort', '--ttl-minutes': 'ttlMinutes' }[key]] = Number(value);
        else throw new Error('Unknown option.');
      }
      console.log(JSON.stringify(createEnvironment(options)));
    } else if (command === 'remove' && args.length === 2) {
      removeEnvironment(args[0], args[1]); console.log('Only the marked stopped synthetic environment was removed.');
    } else throw new Error('Usage: environment.mjs create [OPTIONS] | remove ROOT ENVIRONMENT_ID');
  } catch { console.error('Synthetic environment operation refused; private configuration is not printed.'); process.exitCode = 1; }
}
