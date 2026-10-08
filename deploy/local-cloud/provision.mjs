import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';

const [configPath, accessPath, originValue] = process.argv.slice(2);
if (!configPath || !accessPath || !originValue) throw new Error('Usage: provision.mjs CONFIG ACCESS HTTPS_ORIGIN [--with-test-users]');
const origin = new URL(originValue);
if (origin.protocol !== 'https:') throw new Error('HTTPS is required.');
if (existsSync(configPath) || existsSync(accessPath)) throw new Error('Existing credentials will not be overwritten.');
const directory = dirname(resolve(configPath));
mkdirSync(directory, { recursive: true, mode: 0o700 });
mkdirSync(dirname(resolve(accessPath)), { recursive: true, mode: 0o700 });
const access = [];
const users = ['admin', ...(process.argv.includes('--with-test-users') ? ['e2e-a', 'e2e-b'] : [])].map((username) => {
  const password = randomBytes(24).toString('base64url');
  const salt = randomBytes(32).toString('hex');
  access.push({ username, password });
  return { username, id: randomUUID(), displayName: username === 'admin' ? '项目管理员' : 'E2E 合成账户', email: `${username}@local.anxin`, salt, passwordHash: scryptSync(password, salt, 64).toString('hex') };
});
writeFileSync(configPath, JSON.stringify({ origin: origin.origin, workerPort: 18797, sessionKey: randomBytes(48).toString('hex'), stateDir: '/home/carryz/.local/share/anxin/state', tlsKey: `${directory}/server.key`, tlsCert: `${directory}/server.crt`, release: 'pending', users }, null, 2), { mode: 0o600 });
writeFileSync(accessPath, JSON.stringify({ origin: origin.origin, accounts: access }, null, 2), { mode: 0o600 });
console.log('Private access/configuration files created; no credentials are printed.');
