import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Tests share one database; run files sequentially.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
