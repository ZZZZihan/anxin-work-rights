import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { probeGateway, waitForReadiness } from './readiness.mjs';

const release = 'a'.repeat(40);
const running = { ActiveState: 'active', SubState: 'running', MainPID: '47', InvocationID: 'synthetic-start', NRestarts: '0' };
const response = { status: 'ok', release, pid: 47 };
function offline(overrides = {}) {
  let clock = 0;
  return {
    release, origin: 'https://127.0.0.1:8444', timeout: 2000,
    state: () => running, probe: async () => response,
    now: () => clock, pause: async (ms) => { clock += ms; }, ...overrides,
  };
}

describe('bounded deployment readiness', () => {
  it('waits through startup before accepting the expected release and process', async () => {
    let calls = 0;
    await waitForReadiness(offline({ probe: async () => ++calls === 1 ? null : response }));
    expect(calls).toBe(2);
  });
  it('fails when startup exits or systemd begins an automatic restart', async () => {
    for (const failure of [
      { ...running, ActiveState: 'failed', SubState: 'failed', MainPID: '0' },
      { ...running, SubState: 'auto-restart' },
      { ...running, MainPID: '48', InvocationID: 'other-start', NRestarts: '1' },
    ]) {
      let calls = 0;
      await expect(waitForReadiness(offline({ state: () => ++calls < 3 ? running : failure, probe: async () => null })))
        .rejects.toThrow('stopped or restarted');
    }
  });
  it('rejects a 200 from an old release or an unrelated process and times out', async () => {
    for (const wrong of [{ ...response, release: 'b'.repeat(40) }, { ...response, pid: 99 }, { status: 'ok' }]) {
      await expect(waitForReadiness(offline({ probe: async () => wrong }))).rejects.toThrow('timed out');
    }
  });
  it('times out when the HTTPS listener never appears', async () => {
    await expect(waitForReadiness(offline({ probe: async () => { throw Object.assign(new Error('synthetic connection failure'), { code: 'ECONNREFUSED' }); } })))
      .rejects.toThrow('timed out');
  });
  it('includes service status checks in the total deadline', async () => {
    let clock = 0;
    await expect(waitForReadiness(offline({ now: () => clock, state: () => { clock += 3000; return running; } })))
      .rejects.toThrow('timed out');
  });
  it('never passes zero (unbounded) to a status command at the deadline boundary', async () => {
    let clock = 0;
    await expect(waitForReadiness(offline({
      timeout: 2, now: () => clock++,
      state: (maxWait) => { expect(maxWait).toBeGreaterThan(0); return running; },
    }))).rejects.toThrow('timed out');
  });
});

describe('actual isolated HTTPS certificate checks', () => {
  let directory, validServer, wrongHostServer, slowServer, cert, wrongCert, origin, wrongOrigin, slowOrigin;
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'anxin-readiness-test-'));
    const start = async (name, san) => {
      const key = join(directory, `${name}.key`), path = join(directory, `${name}.crt`);
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', path,
        '-days', '1', '-subj', '/CN=synthetic readiness', '-addext', `subjectAltName=${san}`], { stdio: 'ignore' });
      const certificate = readFileSync(path);
      const server = createServer({ key: readFileSync(key), cert: certificate }, (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(response));
      });
      await new Promise((done) => server.listen(0, '127.0.0.1', done));
      return { server, certificate, url: `https://127.0.0.1:${server.address().port}` };
    };
    const valid = await start('valid', 'IP:127.0.0.1');
    validServer = valid.server; cert = valid.certificate; origin = valid.url;
    const wrong = await start('wrong-host', 'DNS:synthetic.invalid');
    wrongHostServer = wrong.server; wrongCert = wrong.certificate; wrongOrigin = wrong.url;
    slowServer = createServer({ key: readFileSync(join(directory, 'valid.key')), cert }, (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const timer = setInterval(() => res.write(' '), 20);
      res.on('close', () => clearInterval(timer));
    });
    await new Promise((done) => slowServer.listen(0, '127.0.0.1', done));
    slowOrigin = `https://127.0.0.1:${slowServer.address().port}`;
  }, 20_000);
  afterAll(async () => {
    await Promise.all([validServer, wrongHostServer, slowServer].filter(Boolean).map((server) => new Promise((done) => server.close(done))));
    if (directory) rmSync(directory, { recursive: true });
  });
  it('accepts only the configured certificate with a matching hostname', async () => {
    expect(await probeGateway(origin, cert, 2000)).toEqual(response);
    await waitForReadiness({ release, origin, ca: cert, state: () => running, timeout: 2000 });
  });
  it('fails for untrusted certificates and hostname mismatches without bypassing TLS', async () => {
    await expect(waitForReadiness({ release, origin, state: () => running, timeout: 2000 })).rejects.toThrow('TLS verification failed');
    await expect(waitForReadiness({ release, origin: wrongOrigin, ca: wrongCert, state: () => running, timeout: 2000 })).rejects.toThrow('TLS verification failed');
  });
  it('enforces the wall-clock deadline even while HTTPS keeps sending bytes', async () => {
    const started = Date.now();
    await expect(waitForReadiness({ release, origin: slowOrigin, ca: cert, state: () => running, timeout: 400 }))
      .rejects.toThrow('timed out');
    expect(Date.now() - started).toBeLessThan(1500);
  });
});
