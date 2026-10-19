// Build a complete sibling directory before publishing it. Interrupted stages
// remain evidence, but do not occupy the final immutable result directory.
import assert from 'node:assert/strict';
import { lstat, mkdtemp, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

async function requireAbsent(path) {
  try { await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const error = new Error('Artifact destination already exists');
  error.code = 'EEXIST';
  throw error;
}

export async function publishArtifacts(directory, artifacts, { onProgress } = {}) {
  const target = resolve(directory);
  const entries = Object.entries(artifacts);
  assert(entries.length > 0, 'Cannot publish an empty artifact set');
  const serialized = entries.map(([name, value]) => {
    assert(name && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\'), 'Artifact names must be single safe path components');
    const bytes = JSON.stringify(value, null, 2);
    assert.equal(typeof bytes, 'string', 'Every artifact must be JSON serializable');
    return [name, bytes + '\n'];
  });
  await requireAbsent(target);
  const staging = await mkdtemp(join(dirname(target), `.${basename(target)}.staging-`));
  const completed = [];
  try {
    for (const [name, bytes] of serialized) {
      await writeFile(join(staging, name), bytes, { flag: 'wx' });
      completed.push(name);
      await onProgress?.({ staging, name, completed: [...completed] });
    }
    await requireAbsent(target);
    // Each successful publication is nonempty. Concurrent publishers cannot
    // replace it with rename; the losing complete stage is kept for inspection.
    await rename(staging, target);
    return target;
  } catch (error) {
    // Do not record exception messages: they can contain private path details.
    await writeFile(join(staging, '.publication-failure.json'), JSON.stringify({
      status: 'FAILED', final_published: false, completed_artifacts: completed,
      expected_artifacts: serialized.map(([name]) => name),
      error_code: typeof error.code === 'string' ? error.code : 'PUBLICATION_FAILED',
    }, null, 2) + '\n', { flag: 'wx' }).catch(() => {});
    error.stagingDirectory = staging;
    throw error;
  }
}
