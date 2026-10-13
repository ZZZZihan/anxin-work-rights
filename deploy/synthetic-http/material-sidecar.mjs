// Launch the loopback OCR service without placing its bearer token in argv,
// environment variables, systemd unit metadata, or startup logs.
import { pathToFileURL } from 'node:url';
import { createMaterialService } from '../../scripts/material-service.mjs';
import { readMaterialConfig } from './material-config.mjs';

export async function startMaterialSidecar(root) {
  const config = readMaterialConfig(root);
  if (!config) throw new Error('Private material service configuration is required.');
  const port = Number(new URL(config.url).port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('An explicit loopback material port is required.');
  const service = await createMaterialService({ token: config.token, port, model: null });
  try {
    if (service.url !== new URL(config.url).origin) throw new Error('Material listener does not match its private configuration.');
    const response = await fetch(`${service.url}/health`, {
      headers: { Authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const health = await response.json();
    if (!response.ok || health.status !== 'ok' || !health.capabilities.ocr.includes('tesseract_chi_sim') || !health.capabilities.ocr.includes('poppler')) {
      throw new Error('Linux Chinese OCR dependencies are unavailable.');
    }
  } catch (error) {
    await service.close();
    throw error;
  }
  return service;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const service = await startMaterialSidecar(process.argv[2]);
    console.log('Private loopback material service is ready (OCR + rules).');
    let stopping = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
      if (stopping) return;
      stopping = true;
      try { await service.close(); process.exit(0); }
      catch { console.error('Material service cleanup failed.'); process.exit(1); }
    });
  } catch {
    console.error('Material service startup failed; check private configuration and OCR dependencies.');
    process.exitCode = 1;
  }
}
