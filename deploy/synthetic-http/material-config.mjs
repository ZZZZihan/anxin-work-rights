import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';

const refused = () => new Error('Synthetic private material or Worker configuration refused.');
const tokenPattern = /^[A-Za-z0-9_-]{32,128}$/;

function privateRoot(root) {
  const path = resolve(root), state = lstatSync(path);
  if (state.isSymbolicLink() || !state.isDirectory() || (state.mode & 0o777) !== 0o700 ||
      (process.getuid && state.uid !== process.getuid()) || realpathSync(path) !== path) throw refused();
  return path;
}

// Read from a non-following descriptor and return no contents in errors. A
// dangling symlink is an invalid file, not an absent optional configuration.
function privateText(path, maxBytes) {
  let descriptor;
  try {
    const state = lstatSync(path);
    if (state.isSymbolicLink() || !state.isFile() || (state.mode & 0o777) !== 0o600 ||
        state.nlink !== 1 || (process.getuid && state.uid !== process.getuid()) || state.size > maxBytes) throw refused();
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (opened.dev !== state.dev || opened.ino !== state.ino || !opened.isFile() ||
        (opened.mode & 0o777) !== 0o600 || opened.nlink !== 1 || opened.size > maxBytes ||
        (process.getuid && opened.uid !== process.getuid())) throw refused();
    const text = readFileSync(descriptor, 'utf8');
    if (Buffer.byteLength(text) > maxBytes) throw refused();
    return text;
  } catch (error) {
    if (error.code === 'ENOENT' && descriptor === undefined) return null;
    throw refused();
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}

function validateMaterial(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'token,url' || typeof value.url !== 'string' ||
      typeof value.token !== 'string' || !tokenPattern.test(value.token)) throw refused();
  const match = /^http:\/\/127\.0\.0\.1:([1-9]\d{3,4})\/?$/.exec(value.url);
  if (!match || Number(match[1]) < 1024 || Number(match[1]) > 65535) throw refused();
  const url = new URL(value.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || Number(url.port) !== Number(match[1])) throw refused();
  return { url: url.origin, token: value.token };
}

export function readMaterialConfig(root) {
  try {
    const text = privateText(join(privateRoot(root), 'material-service.json'), 4096);
    return text === null ? null : validateMaterial(JSON.parse(text));
  } catch { throw refused(); }
}

export function syncWorkerConfig(root, baseSettings, material) {
  let temporary;
  try {
    const directory = privateRoot(root), path = join(directory, 'worker.json');
    try { lstatSync(join(directory, '.runtime.json')); throw refused(); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const service = material === null ? null : validateMaterial(material);
    if (Object.keys(baseSettings.vars).join(',') !== 'ANXIN_SYNTHETIC_ENV_ID') throw refused();
    const withService = (value) => ({ ...baseSettings, vars: { ...baseSettings.vars,
      ANXIN_MATERIAL_SERVICE_URL: value.url, ANXIN_MATERIAL_SERVICE_TOKEN: value.token } });
    const desired = JSON.stringify(service ? withService(service) : baseSettings);
    const previous = privateText(path, 1024 * 1024);
    if (previous === desired) return path;
    if (previous !== null && previous !== JSON.stringify(baseSettings)) {
      // A rotation can change only a previously valid token at the same
      // configured endpoint. D1/R2, assets, main, rules and every other byte
      // must still equal this release's known configuration.
      if (!service) throw refused();
      const parsed = JSON.parse(previous);
      const oldService = validateMaterial({ url: parsed.vars?.ANXIN_MATERIAL_SERVICE_URL,
        token: parsed.vars?.ANXIN_MATERIAL_SERVICE_TOKEN });
      if (oldService.url !== service.url || previous !== JSON.stringify(withService(oldService))) throw refused();
    }
    if (previous === null) writeFileSync(path, desired, { mode: 0o600, flag: 'wx' });
    else {
      temporary = join(directory, `.worker-${randomUUID()}.next`);
      writeFileSync(temporary, desired, { mode: 0o600, flag: 'wx' });
      renameSync(temporary, path); temporary = undefined;
    }
    return path;
  } catch { throw refused(); }
  finally { if (temporary) { try { unlinkSync(temporary); } catch { /* Private failed file remains inside root only. */ } } }
}
