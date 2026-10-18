import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    'dist/**',
    'node_modules/**',
    'next-env.d.ts',
    'js/**',
    'styles/**',
    'screenshot.py',
    // Partial historical source snapshots are hash-checked evidence, not app modules.
    'experiments/material-facts-v7/postfreeze-evidence/round21/source-author/nonimplementer-review-snapshots/**',
    'experiments/material-facts-v7/postfreeze-evidence/round22/source-author/assess-http160-nonimplementer-snapshots/**',
  ]),
]);
