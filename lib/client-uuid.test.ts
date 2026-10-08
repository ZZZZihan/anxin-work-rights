import { afterEach, expect, it, vi } from 'vitest';
import { createOperationId } from './client-uuid';

afterEach(() => vi.unstubAllGlobals());
it('generates a valid UUIDv4 when the ordinary HTTP API has no randomUUID', () => {
  const getRandomValues = vi.fn((bytes: Uint8Array) => { bytes.fill(255); return bytes; });
  vi.stubGlobal('crypto', { getRandomValues });
  expect(createOperationId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  expect(getRandomValues).toHaveBeenCalledOnce();
});
it('uses independent cryptographic bytes for independent upload operations', () => {
  const identifiers = Array.from({ length: 100 }, () => createOperationId());
  expect(new Set(identifiers).size).toBe(100);
  expect(identifiers.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(true);
});
