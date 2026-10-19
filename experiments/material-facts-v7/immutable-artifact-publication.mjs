// Publish a complete same-directory file without replacing an immutable artifact.
// Failed I/O stages remain available for diagnosis; cleanup cannot undo publication.
import { randomUUID } from 'node:crypto';
import { link, lstat, open, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

export async function publishImmutableFile(destination, bytes) {
  const target = resolve(destination);
  // lstat also rejects directories and dangling symlinks without creating a stage.
  const existing = await lstat(target).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (existing) throw Object.assign(new Error(`EEXIST: immutable artifact already exists, '${target}'`), { code: 'EEXIST', path: target });
  const temporary = join(dirname(target), `.${basename(target)}.${process.pid}.${randomUUID()}.stage`);
  const handle = await open(temporary, 'wx');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    try { await handle.close(); }
    catch (closeError) { error.publication_close_error_code = closeError.code ?? closeError.name; }
    error.publication_temporary_path = temporary;
    throw error;
  }
  // A close failure also leaves the complete stage and does not publish a name.
  await handle.close();
  // link is atomic and refuses an existing target, including a concurrent winner.
  try { await link(temporary, target); }
  catch (error) {
    if (error.code === 'EEXIST') {
      // A concurrent winner is not an I/O failure of our complete stage. Remove
      // only this invocation's stage, preserving the original rejection if that fails.
      error.publication_temporary_path = temporary;
      try { await unlink(temporary); error.publication_temporary_removed = true; }
      catch (cleanupError) {
        error.publication_temporary_removed = false;
        error.publication_cleanup_error_code = cleanupError.code ?? cleanupError.name;
        error.message += `; cleanup failed (${error.publication_cleanup_error_code}); retained stage '${temporary}'`;
      }
    }
    throw error;
  }
  let cleanupError;
  try { await unlink(temporary); }
  catch (error) { cleanupError = error; }
  return {
    published: true,
    temporary_path: temporary,
    temporary_removed: !cleanupError,
    cleanup_error_code: cleanupError?.code ?? cleanupError?.name ?? null,
  };
}
