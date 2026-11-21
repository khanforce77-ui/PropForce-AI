// Bundles the compiled API (dist/main.js, emitted by tsc with decorator metadata) and its
// dependencies into one CommonJS file. Vercel's NestJS runtime loads the entrypoint with
// require() from the function root, which cannot load ESM-only packages such as @nestjs/core 12
// and does not see pnpm's per-package node_modules. A single bundle avoids both problems.
// Native addons stay external and are resolved through NODE_PATH at runtime.
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [resolve(root, 'dist/main.js')],
  outfile: resolve(root, 'dist/main.js'),
  allowOverwrite: true,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'warning',
  external: [
    // Native addon: loaded from node_modules at runtime.
    '@node-rs/argon2',
    // Native image library (libvips) used by @propforce/media.
    'sharp',
    // Optional Nest integrations that Nest only loads when installed. They are not used here.
    '@nestjs/microservices',
    '@nestjs/microservices/*',
    '@nestjs/websockets',
    '@nestjs/websockets/*',
    'class-validator',
    'class-transformer',
    '@fastify/static',
    '@nestjs/platform-fastify',
  ],
});
