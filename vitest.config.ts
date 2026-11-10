import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/integration/**', 'node_modules/**'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    pool: 'forks',
  },
});
