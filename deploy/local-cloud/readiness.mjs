import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { get } from 'node:https';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const service = 'anxin-local.service';

export function serviceState(timeout = 5000) {
  const output = execFileSync('systemctl', [
    '--user', 'show', service, '--property=ActiveState,SubState,MainPID,InvocationID,NRestarts',
  ], { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] });
  return Object.fromEntries(output.trim().split('\n').map((line) => line.split('=')));
}

export function probeGateway(origin, ca, timeout) {
  return new Promise((resolveProbe, reject) => {
    const request = get(new URL('/api/ready', origin), { ca, timeout }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > 4096) request.destroy(new Error('Invalid readiness response.'));
      });
      response.on('error', reject);
      response.on('end', () => {
        if (response.statusCode !== 200) return resolveProbe(null);
        try { resolveProbe(JSON.parse(body)); } catch { resolveProbe(null); }
      });
    });
    // Socket idle timeouts do not bound a response that trickles bytes forever.
    const deadlineTimer = setTimeout(() => request.destroy(new Error('Readiness request timed out.')), timeout);
    request.on('close', () => clearTimeout(deadlineTimer));
    request.on('timeout', () => request.destroy(new Error('Readiness request timed out.')));
    request.on('error', reject);
  });
}

export async function waitForReadiness({
  release, origin, ca, timeout = 90_000,
  state = serviceState, probe = probeGateway,
  now = Date.now, pause = (ms) => new Promise((done) => setTimeout(done, ms)),
}) {
  if (!/^[a-f0-9]{40}$/.test(release) || new URL(origin).protocol !== 'https:') {
    throw new Error('Invalid deployment readiness configuration.');
  }
  const deadline = now() + timeout;
  const readState = () => {
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error('Deployment readiness timed out for the expected release and process.');
    const current = state(Math.min(5000, remaining));
    if (now() >= deadline) throw new Error('Deployment readiness timed out for the expected release and process.');
    return current;
  };
  const initial = readState();
  const requireRunning = (current) => {
    if (current.ActiveState !== 'active' || current.SubState !== 'running' || Number(current.MainPID) <= 0 ||
        current.MainPID !== initial.MainPID || current.InvocationID !== initial.InvocationID ||
        current.NRestarts !== initial.NRestarts) {
      throw new Error('Deployment service stopped or restarted before becoming ready.');
    }
  };
  requireRunning(initial);
  while (now() < deadline) {
    requireRunning(readState());
    let result;
    try {
      result = await probe(origin, ca, Math.min(3000, deadline - now()));
    } catch (error) {
      if (/CERT|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|ISSUER/.test(error.code ?? '')) {
        throw new Error('Deployment TLS verification failed.');
      }
      // Connection failures during the worker's bounded startup are retryable.
    }
    // Match the new release and systemd's current process, not just a 200 from
    // an old gateway or another service occupying the configured HTTPS port.
    if (result?.status === 'ok' && result.release === release && result.pid === Number(initial.MainPID)) {
      requireRunning(readState());
      return;
    }
    await pause(Math.min(500, Math.max(0, deadline - now())));
  }
  throw new Error('Deployment readiness timed out for the expected release and process.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    // Read only the public certificate and origin; never emit private config.
    const config = JSON.parse(readFileSync(process.env.ANXIN_CONFIG, 'utf8'));
    await waitForReadiness({ release: process.argv[2], origin: config.origin, ca: readFileSync(config.tlsCert) });
    console.log(`Anxin deployment ready: ${process.argv[2]}`);
  } catch (error) {
    console.error(error.message.startsWith('Deployment') || error.message.startsWith('Invalid deployment')
      ? error.message : 'Deployment readiness check could not complete.');
    process.exitCode = 1;
  }
}
