import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bindings = vi.hoisted(() => ({
  ANXIN_MATERIAL_SERVICE_URL: 'http://127.0.0.1:18765/',
  ANXIN_MATERIAL_SERVICE_TOKEN: 'synthetic-unit-test-only',
}));
vi.mock('cloudflare:workers', () => ({ env: bindings }));
import { callMaterialService } from './material-service-client';

const request = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"source":{},"jobId":"synthetic-id"}' };
const fetchMock = vi.fn<typeof fetch>();

describe('material service HTTP response classification', () => {
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => { vi.unstubAllGlobals(); });

  for (const status of [400, 401, 403, 404, 408, 409, 410, 413, 415, 422, 429]) {
    for (const [format, body] of [
      ['JSON', '{"error":"synthetic private response content"}'],
      ['HTML', '<html>synthetic private response content</html>'],
      ['broken JSON', '{"error":'],
    ]) it(`keeps explicit HTTP ${status} with ${format} instead of treating it as an unreadable acknowledgement`, async () => {
      fetchMock.mockResolvedValue(new Response(body, { status }));
      const failure = await callMaterialService('/fact-jobs', request).catch(error => error);
      expect(failure).toBeInstanceOf(Error);
      expect(failure).toMatchObject({ name: 'MaterialServiceHttpError', status });
      expect(failure.message).not.toContain('synthetic private response content');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  }

  it('retains a known rejection when its response body cannot be read', async () => {
    const text = vi.fn().mockRejectedValue(new Error('Synthetic response stream failure'));
    fetchMock.mockResolvedValue({ ok: false, status: 429, text } as unknown as Response);
    await expect(callMaterialService('/fact-jobs', request)).rejects.toMatchObject({ name: 'MaterialServiceHttpError', status: 429 });
    expect(text).not.toHaveBeenCalled();
  });

  it('retains a known rejection without consuming an oversized error body', async () => {
    const text = vi.fn().mockResolvedValue('x'.repeat(500_001));
    fetchMock.mockResolvedValue({ ok: false, status: 413, text } as unknown as Response);
    await expect(callMaterialService('/fact-jobs', request)).rejects.toMatchObject({ name: 'MaterialServiceHttpError', status: 413 });
    expect(text).not.toHaveBeenCalled();
  });

  for (const outcome of ['resolved', 'rejected', 'pending', 'throws'] as const) {
    it(`discards an unused error stream without awaiting its ${outcome} cancellation or masking HTTP status`, async () => {
      const cancel = vi.fn(() => {
        if (outcome === 'throws') throw new Error('Synthetic synchronous cleanup failure');
        if (outcome === 'rejected') return Promise.reject(new Error('Synthetic cleanup rejection'));
        if (outcome === 'pending') return new Promise<void>(() => {});
        return Promise.resolve();
      });
      fetchMock.mockResolvedValue({ ok: false, status: 429, body: { cancel } } as unknown as Response);
      await expect(callMaterialService('/fact-jobs', request)).rejects.toMatchObject({ name: 'MaterialServiceHttpError', status: 429 });
      expect(cancel).toHaveBeenCalledTimes(1);
    });
  }

  for (const body of ['{"error":"synthetic unavailable"}', '<html>synthetic unavailable</html>', '{']) {
    it(`keeps HTTP 503 distinguishable from a definitive 4xx rejection for body ${JSON.stringify(body)}`, async () => {
      fetchMock.mockResolvedValue(new Response(body, { status: 503 }));
      await expect(callMaterialService('/fact-jobs', request)).rejects.toMatchObject({ name: 'MaterialServiceHttpError', status: 503 });
    });
  }

  it('preserves a transport timeout as an unknown submission outcome', async () => {
    const timeout = new DOMException('Synthetic response timeout', 'TimeoutError');
    fetchMock.mockRejectedValue(timeout);
    await expect(callMaterialService('/fact-jobs', request)).rejects.toBe(timeout);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a malformed successful response unknown rather than inventing acceptance or rejection', async () => {
    fetchMock.mockResolvedValue(new Response('{', { status: 202 }));
    await expect(callMaterialService('/fact-jobs', request)).rejects.toBeInstanceOf(SyntaxError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns a valid acknowledgement while retaining the existing local-only authenticated request boundary', async () => {
    fetchMock.mockResolvedValue(Response.json({ jobId: 'synthetic-id' }, { status: 202 }));
    await expect(callMaterialService('/fact-jobs', request)).resolves.toEqual({ jobId: 'synthetic-id' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://127.0.0.1:18765/fact-jobs');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(request.body);
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${bindings.ANXIN_MATERIAL_SERVICE_TOKEN}`);
    expect(init?.redirect).toBe('manual');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
