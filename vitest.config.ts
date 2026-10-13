import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Domain and controlled binding tests run without Cloudflare/Vinext build plugins.
// The built Worker's routing is additionally verified by HTTP regressions.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'deploy/local-cloud/*.test.mjs', 'deploy/synthetic-http/*.test.mjs'],
    passWithNoTests: false,
  },
});
