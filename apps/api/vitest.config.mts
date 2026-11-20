import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is needed so NestJS decorator metadata is emitted during tests.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    environment: 'node',
    // Test files share one database.
    fileParallelism: false,
    testTimeout: 20_000,
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
