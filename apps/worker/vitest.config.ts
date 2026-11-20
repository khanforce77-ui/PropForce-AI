import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is needed so NestJS decorator metadata is emitted during tests.
export default defineConfig({
  test: { include: ['src/**/*.spec.ts'], environment: 'node' },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
