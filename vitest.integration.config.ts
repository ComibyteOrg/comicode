import { defineConfig } from 'vitest/config';

/**
 * Real-provider checks are excluded from the normal suite because they need
 * network access and credentials. They are skipped individually unless
 * COMICODE_REAL_PROVIDER_TESTS=1 and the relevant key is present.
 */
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 90_000,
    hookTimeout: 30_000,
    pool: 'forks',
  },
});
