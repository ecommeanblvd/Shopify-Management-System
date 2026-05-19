import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['lib/**/*.test.ts', 'features/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'lib/crypto/**',
        'lib/env.ts',
        'lib/flags/**',
        'lib/logging/**',
        'lib/registry/**',
        'lib/snapshots/**',
        'lib/auth/rbac.ts',
        'lib/shopify/connector.ts',
        'features/settings-viewer/queries.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
      },
    },
  },
});
