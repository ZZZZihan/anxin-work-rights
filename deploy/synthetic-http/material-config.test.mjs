import { chmodSync, existsSync, linkSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readMaterialConfig, syncWorkerConfig } from './material-config.mjs';
import { applyPrivateMigrations, privateWranglerOptions, spawnPrivateWorker } from './server.mjs';

const roots = [];
const root = () => { const directory = realpathSync(mkdtempSync(join(tmpdir(), 'anxin-material-config-'))); roots.push(directory); return directory; };
const material = () => ({ url: 'http://127.0.0.1:18997', token: randomBytes(40).toString('hex') });
const save = (directory, value, name = 'material-service.json') => writeFileSync(join(directory, name), JSON.stringify(value), { mode: 0o600 });
const base = () => ({ name: 'anxin-synthetic-test', main: '/app/dist/server/index.js', compatibility_date: '2026-10-01',
  compatibility_flags: ['nodejs_compat'], no_bundle: true, rules: [{ type: 'ESModule', globs: ['**/*.js'] }],
  assets: { directory: '/app/dist/client' }, vars: { ANXIN_SYNTHETIC_ENV_ID: 'test-environment' },
  d1_databases: [{ binding: 'DB', database_name: 'synthetic-test', database_id: 'test-environment', migrations_dir: '/app/drizzle' }],
  r2_buckets: [{ binding: 'FILES', bucket_name: 'synthetic-test' }] });
const text = (directory) => readFileSync(join(directory, 'worker.json'), 'utf8');
afterEach(() => { vi.unstubAllEnvs(); for (const directory of roots.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('optional private material service configuration', () => {
  it('keeps an absent configuration optional and normalizes only a canonical loopback URL', () => {
    const directory = root(), service = material();
    expect(readMaterialConfig(directory)).toBeNull();
    save(directory, { ...service, url: service.url + '/' });
    const loaded = readMaterialConfig(directory);
    expect(loaded.url).toBe(service.url);
    expect(loaded.token === service.token).toBe(true);
  });
  it('rejects host aliases, credentials, hidden empty query/hash, paths and invalid port forms', () => {
    const directory = root(), service = material();
    for (const url of ['https://127.0.0.1:18997', 'http://localhost:18997', 'http://127.1:18997',
      'http://2130706433:18997', 'http://0.0.0.0:18997', 'http://[::1]:18997',
      'http://user:password@127.0.0.1:18997', service.url + '/jobs', service.url + '?', service.url + '#',
      service.url + '?source=other', service.url + '#fragment', 'http://127.0.0.1:80',
      'http://127.0.0.1:65536', 'http://127.0.0.1:018997', service.url + ' ']) {
      save(directory, { ...service, url });
      expect(() => readMaterialConfig(directory)).toThrow('configuration refused');
    }
  });
  it('rejects extra properties, short or header-unsafe tokens and malformed JSON without reflecting private contents', () => {
    const directory = root(), service = material();
    for (const value of [{ ...service, model: 'other' }, null, [], { url: service.url },
      { ...service, token: 'short' }, { ...service, token: service.token + '\nheader' },
      { ...service, token: 'a'.repeat(129) }]) {
      save(directory, value);
      expect(() => readMaterialConfig(directory)).toThrow('configuration refused');
    }
    writeFileSync(join(directory, 'material-service.json'), '{' + service.token);
    try { readMaterialConfig(directory); throw Error('Expected rejection'); }
    catch (error) {
      expect(error.message.includes(service.token)).toBe(false);
      expect(error.message.includes(directory)).toBe(false);
    }
  });
  it('requires a private owned root and a regular 0600 single-link file, including dangling links', () => {
    const directory = root(), service = material(), path = join(directory, 'material-service.json');
    save(directory, service); chmodSync(path, 0o644);
    expect(() => readMaterialConfig(directory)).toThrow();
    chmodSync(path, 0o600); chmodSync(directory, 0o755);
    expect(() => readMaterialConfig(directory)).toThrow();
    chmodSync(directory, 0o700); unlinkSync(path);
    symlinkSync(join(directory, 'absent'), path);
    expect(() => readMaterialConfig(directory)).toThrow();
    unlinkSync(path); save(directory, service, 'source.json'); linkSync(join(directory, 'source.json'), path);
    expect(() => readMaterialConfig(directory)).toThrow();
    unlinkSync(path); unlinkSync(join(directory, 'source.json'));
    writeFileSync(path, ' '.repeat(4097), { mode: 0o600 });
    expect(() => readMaterialConfig(directory)).toThrow();
  });
});

describe('controlled private Worker configuration upgrade', () => {
  it('preserves a legacy configuration byte for byte and upgrades only material vars', () => {
    const directory = root(), settings = base(), service = material();
    syncWorkerConfig(directory, settings, null);
    const before = text(directory), state = lstatSync(join(directory, 'worker.json'));
    syncWorkerConfig(directory, settings, null);
    expect(text(directory)).toBe(before); expect(lstatSync(join(directory, 'worker.json')).ino).toBe(state.ino);
    syncWorkerConfig(directory, settings, service);
    const upgraded = JSON.parse(text(directory));
    expect(upgraded.vars.ANXIN_MATERIAL_SERVICE_TOKEN === service.token).toBe(true);
    expect(upgraded.vars.ANXIN_MATERIAL_SERVICE_URL).toBe(service.url);
    upgraded.vars = settings.vars; expect(upgraded).toEqual(settings);
    expect((lstatSync(join(directory, 'worker.json')).mode & 0o777)).toBe(0o600);
    expect(readdirSync(directory).filter(name => name.startsWith('.worker-'))).toEqual([]);
  });
  it('creates a fresh configured Worker and rotates a valid token only at the same endpoint', () => {
    const directory = root(), settings = base(), service = material(), rotated = material();
    syncWorkerConfig(directory, settings, service);
    syncWorkerConfig(directory, settings, rotated);
    expect(JSON.parse(text(directory)).vars.ANXIN_MATERIAL_SERVICE_TOKEN === rotated.token).toBe(true);
    const before = text(directory);
    expect(() => syncWorkerConfig(directory, settings, { ...rotated, url: 'http://127.0.0.1:18998' })).toThrow();
    expect(() => syncWorkerConfig(directory, settings, null)).toThrow();
    expect(text(directory)).toBe(before);
  });
  it('rejects unrelated binding, asset, script, rules and variable changes without rewriting the file', () => {
    const directory = root(), settings = base(), service = material();
    const changes = [value => { value.main = '/other/index.js'; }, value => { value.assets.directory = '/other/client'; },
      value => { value.d1_databases[0].database_id = 'other'; }, value => { value.r2_buckets[0].bucket_name = 'real'; },
      value => { value.vars.UNRELATED = 'unexpected'; }, value => { value.compatibility_date = '2026-09-01'; },
      value => { value.rules = []; }];
    for (const change of changes) {
      const unknown = base(); change(unknown); save(directory, unknown, 'worker.json'); const before = text(directory);
      expect(() => syncWorkerConfig(directory, settings, service)).toThrow(); expect(text(directory)).toBe(before);
    }
    save(directory, settings, 'worker.json');
    writeFileSync(join(directory, '.runtime.json'), '{}', { mode: 0o600 });
    expect(() => syncWorkerConfig(directory, settings, service)).toThrow();
    expect(text(directory)).toBe(JSON.stringify(settings));
  });
  it('refuses malformed prior credentials, permissive files and symlinks even when the JSON resembles desired settings', () => {
    const directory = root(), settings = base(), service = material();
    syncWorkerConfig(directory, settings, service);
    const path = join(directory, 'worker.json'), original = text(directory), unknown = JSON.parse(original);
    unknown.vars.ANXIN_MATERIAL_SERVICE_TOKEN = 'invalid'; save(directory, unknown, 'worker.json');
    expect(() => syncWorkerConfig(directory, settings, service)).toThrow();
    writeFileSync(path, original); chmodSync(path, 0o644);
    expect(() => syncWorkerConfig(directory, settings, service)).toThrow();
    chmodSync(path, 0o600); unlinkSync(path); writeFileSync(join(directory, 'other.json'), original, { mode: 0o600 });
    symlinkSync(join(directory, 'other.json'), path);
    expect(() => syncWorkerConfig(directory, settings, service)).toThrow();
  });
});

describe('Wrangler credentials remain private on both success and failure', () => {
  it('suppresses both real child streams, disables disk logging and strips migration error payloads', async () => {
    const directory = root(), settings = base(), service = material(), fixture = join(directory, 'wrangler-fixture.mjs');
    const config = syncWorkerConfig(directory, settings, service);
    vi.stubEnv('WRANGLER_WRITE_LOGS', 'true'); vi.stubEnv('WRANGLER_LOG', 'debug');
    expect(privateWranglerOptions(directory).env.WRANGLER_WRITE_LOGS).toBe('false');
    const script = (exit) => `import fs from 'node:fs';
const config = JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--config') + 1]));
const secret = config.vars.ANXIN_MATERIAL_SERVICE_TOKEN;
console.log(secret); console.error(secret);
if (process.env.WRANGLER_WRITE_LOGS !== 'false' || process.env.WRANGLER_LOG !== 'none') fs.writeFileSync('leaked.log', secret);
process.exit(${exit});`;
    writeFileSync(fixture, script(1), { mode: 0o600 });
    let failure;
    try { await applyPrivateMigrations(fixture, config, join(directory, 'state'), directory); } catch (error) { failure = error; }
    expect(failure?.message).toBe('Synthetic local migrations failed; private output suppressed.');
    expect(failure?.stdout === undefined && failure?.stderr === undefined && failure?.cause === undefined).toBe(true);
    expect(String(failure).includes(service.token)).toBe(false);
    writeFileSync(fixture, script(0));
    await applyPrivateMigrations(fixture, config, join(directory, 'state'), directory);
    const worker = spawnPrivateWorker(fixture, config, 18897, join(directory, 'state'), directory);
    expect(worker.stdout === null && worker.stderr === null).toBe(true);
    expect(worker.spawnargs.some(value => value.includes(service.token))).toBe(false);
    await new Promise((done, fail) => { worker.once('error', fail); worker.once('exit', code => code === 0 ? done() : fail(Error('Fixture failed'))); });
    expect(existsSync(join(directory, 'leaked.log'))).toBe(false);
  });
});
