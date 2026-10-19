// Publish a complete same-directory file without replacing an immutable artifact.
// Failed stages remain available for diagnosis; cleanup cannot undo publication.
import { randomUUID } from 'node:crypto';
import { link, open, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

export async function publishImmutableFile(destination, bytes) {
  const target = resolve(destination);
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
  await link(temporary, target);
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
