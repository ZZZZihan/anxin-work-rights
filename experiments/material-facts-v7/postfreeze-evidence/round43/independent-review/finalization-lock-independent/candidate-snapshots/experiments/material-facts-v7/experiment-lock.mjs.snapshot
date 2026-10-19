import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export const EXPERIMENT_LOCK_NAME = '.experiment.lock';
export const experimentLockPath = root => resolve(root, 'experiments/material-facts-v7', EXPERIMENT_LOCK_NAME);
const sameFile = (left, right) => left.dev === right.dev && left.ino === right.ino;

/** Serialize attempts and freeze/result publication, outside results/.
 * Attempts hold this lock until all terminal artifacts are saved. A kill or
 * interrupted acquisition can leave a lock: never infer staleness or delete it
 * automatically. Reconcile owner PID/host and attempt artifacts before manual
 * recovery; age alone does not prove an owner is dead. */
export async function withExperimentLock(root, operation, callback) {
  if (!['diagnostic', 'holdout', 'freeze', 'assessment', 'summary', 'verify'].includes(operation) || typeof callback !== 'function') throw new Error('Invalid experiment lock operation');
  const directory = resolve(root, 'experiments/material-facts-v7');
  const parent = await lstat(directory);
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error('Experiment lock requires a real experiment directory');
  const lock = experimentLockPath(root), ownerPath = resolve(lock, 'owner.json');
  try { await mkdir(lock, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const blocked = new Error('Experiment lock already exists; an active or interrupted experiment operation requires manual reconciliation. Never remove a live lock.', { cause: error });
    blocked.code = 'EEXIST';
    throw blocked;
  }
  const identity = await lstat(lock);
  const owner = JSON.stringify({ schema: 'material-facts-v7-experiment-lock/1', operation, pid: process.pid,
    hostname: hostname(), acquired_at: new Date().toISOString(), token: randomUUID() }) + '\n';
  // A failed owner write leaves a fail-closed lock for reconciliation, rather
  // than removing a directory whose state this invocation could not establish.
  await writeFile(ownerPath, owner, { flag: 'wx', mode: 0o600 });
  const ownerIdentity = await lstat(ownerPath);
  let result, failure, failed = false;
  try { result = await callback(); }
  catch (error) { failed = true; failure = error; }
  try {
    const current = await lstat(lock), currentOwner = await lstat(ownerPath);
    if (!current.isDirectory() || current.isSymbolicLink() || !sameFile(identity, current)
      || !currentOwner.isFile() || currentOwner.isSymbolicLink() || !sameFile(ownerIdentity, currentOwner)
      || await readFile(ownerPath, 'utf8') !== owner) throw new Error('Experiment lock ownership changed; refusing to release another owner');
    if ((await readdir(lock)).some(name => name !== 'owner.json')) throw new Error('Experiment lock contains unexpected files; refusing automatic cleanup');
    // Non-recursive removal also refuses a concurrent unexpected file.
    await unlink(ownerPath);
    await rmdir(lock);
  } catch (error) {
    if (failed) throw new AggregateError([failure, error], 'Experiment operation failed and its lock requires reconciliation');
    throw error;
  }
  if (failed) throw failure;
  return result;
}

/** The generic assessment CLI also supports unrelated temporary inputs. Only
 * reads/writes in this experiment's results participate in its lifecycle. Resolve
 * existing paths (including symlink aliases) before deciding, then read and
 * publish inside the lock; the scoring library remains side-effect free. */
export async function withAssessmentLock(root, results, output, callback) {
  const resultRoot = await realpath(resolve(root, 'experiments/material-facts-v7/results'))
    .catch(error => { if (error.code === 'ENOENT') return resolve(root, 'experiments/material-facts-v7/results'); throw error; });
  const paths = [await realpath(results), await realpath(dirname(resolve(output)))];
  const scoped = paths.some(path => {
    const part = relative(resultRoot, path);
    return part === '' || (part !== '..' && !part.startsWith('../') && !part.startsWith('..\\') && !isAbsolute(part));
  });
  return scoped ? withExperimentLock(root, 'assessment', callback) : callback();
}
