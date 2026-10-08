// This pipe is inherited from this instance's launcher, never from HTTP input.
export function attachStopControl(input, start, fail) {
  if (typeof input.unref !== 'function') throw new Error('A private unref-able control pipe is required.');
  let buffer = '', closing = false;
  const service = Promise.resolve().then(start);
  const stop = (valid) => {
    if (closing) return;
    closing = true; input.destroy();
    if (!valid) fail();
    void service.then((instance) => instance.stop()).catch(fail);
  };
  input.on('data', (chunk) => {
    buffer += chunk.toString();
    if (buffer === 'stop\n') stop(true);
    else if (!'stop\n'.startsWith(buffer)) stop(false);
  });
  input.once('end', () => stop(false));
  input.once('error', () => stop(false));
  input.unref();
  void service.catch(() => input.destroy());
  return service;
}
