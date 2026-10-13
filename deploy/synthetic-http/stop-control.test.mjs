import { PassThrough } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { attachStopControl } from './stop-control.mjs';

function input() { const stream = new PassThrough(); stream.unref = vi.fn(); return stream; }
const flush = () => new Promise((done) => setImmediate(done));
it('closes only its own ready instance once, without retaining the control pipe', async () => {
  const channel = input(), stop = vi.fn(), fail = vi.fn();
  await attachStopControl(channel, () => ({ stop }), fail);
  channel.write('st'); channel.write('op\n');
  await flush();
  expect(stop).toHaveBeenCalledOnce(); expect(fail).not.toHaveBeenCalled();
  expect(channel.destroyed).toBe(true); expect(channel.unref).toHaveBeenCalledOnce();
});
it('waits for startup to finish before handling an early stop', async () => {
  const channel = input(), stop = vi.fn(), fail = vi.fn(); let ready;
  const startup = attachStopControl(channel, () => new Promise((done) => { ready = done; }), fail);
  await flush(); channel.end('stop\n'); await flush();
  expect(stop).not.toHaveBeenCalled(); ready({ stop }); await startup; await flush();
  expect(stop).toHaveBeenCalledOnce(); expect(fail).not.toHaveBeenCalled();
});
it('fails closed on a broken private channel and refuses unsuitable stdin', async () => {
  const channel = input(), stop = vi.fn(), fail = vi.fn();
  await attachStopControl(channel, () => ({ stop }), fail);
  channel.end(); await flush();
  expect(stop).toHaveBeenCalledOnce(); expect(fail).toHaveBeenCalledOnce();
  const unsuitable = new PassThrough(), start = vi.fn();
  expect(() => attachStopControl(unsuitable, start, fail)).toThrow('private');
  expect(start).not.toHaveBeenCalled(); unsuitable.destroy();
});
