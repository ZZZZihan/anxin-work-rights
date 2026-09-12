import { defineConfig } from 'vitest/config';

// Keep domain tests independent from the Cloudflare/Vinext build plugins.
// Route and binding integration is verified by the production build and HTTP smoke tests.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
    passWithNoTests: false,
  },
});
