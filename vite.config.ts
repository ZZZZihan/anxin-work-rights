import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import hostingConfig from './.openai/hosting.json' with { type: 'json' };

const PLACEHOLDER_DATABASE_ID = '00000000-0000-4000-8000-000000000000';
const { d1, r2 } = hostingConfig;
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';
const materialServiceVars: Record<string, string> = {};
if (process.env.ANXIN_MATERIAL_SERVICE_URL && process.env.ANXIN_MATERIAL_SERVICE_TOKEN) {
  materialServiceVars.ANXIN_MATERIAL_SERVICE_URL = process.env.ANXIN_MATERIAL_SERVICE_URL;
  materialServiceVars.ANXIN_MATERIAL_SERVICE_TOKEN = process.env.ANXIN_MATERIAL_SERVICE_TOKEN;
}

const localBindingConfig = {
  main: 'vinext/server/app-router-entry',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1
    ? [{ binding: d1, database_name: 'anxin-local', database_id: PLACEHOLDER_DATABASE_ID, migrations_dir: './drizzle' }]
    : [],
  r2_buckets: r2 ? [{ binding: r2, bucket_name: 'anxin-files-local' }] : [],
  // Only the explicit local launcher provides these. No service is enabled by
  // ordinary builds, and callers cannot select a destination through the API.
  vars: materialServiceVars,
};

export default defineConfig(async () => {
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
    ],
  };
});
