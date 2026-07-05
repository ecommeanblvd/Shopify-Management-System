import { defineConfig, configDefaults } from 'vitest/config';
import path from 'path';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig({ path: path.resolve(__dirname, '.env') });

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // server-only is a Next.js RSC guard that throws in non-server contexts.
      // Map it to a no-op so pure functions in server-only modules can be
      // unit-tested without a real Next.js runtime.
      'server-only': path.resolve(__dirname, '__mocks__/server-only.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['lib/**/*.test.ts', 'features/**/*.test.ts', 'components/**/*.test.ts'],
    // Shopify extension package has its own vitest config; keep it out of the SMS root run.
    exclude: [...configDefaults.exclude, 'shopify-extension/**'],
    coverage: {
      provider: 'v8',
      // Unit-coverage gate: pure-logic modules whose dependencies are fully injected
      // or deterministic, so every branch is reachable without a real database or
      // network.  DB-bound modules (lib/env.ts, lib/flags/**, lib/logging/**,
      // lib/snapshots/**, features/settings-viewer/queries.ts), route handlers, UI
      // components, lib/shopify/client.ts, lib/auth/auth.ts and db/* are
      // integration/E2E surface verified separately — E2E requires a provisioned
      // database and is run in CI against a real environment.
      include: [
        'lib/crypto/**',
        'lib/registry/**',
        'lib/auth/rbac.ts',
        'lib/shopify/connector.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
      },
    },
  },
});
