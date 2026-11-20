# Progress Report

Updated with every PR. "Tested" means covered by an automated test that passes in CI.

## Phase 1 · PR 1 · Monorepo scaffold (2026-11-20)

**Built**

- pnpm workspace + Turborepo; TypeScript strict; ESLint (typescript-eslint) and Prettier.
- `apps/api`: NestJS 12, env validation (zod) that fails at boot, pino structured logging with request ids and header redaction, helmet security headers, CORS allowlist, RFC 9457 error responses, `/health/live` and `/health/ready`.
- `apps/worker`: NestJS application context with validated config. No queue processors yet.
- `apps/web`: Next.js 16 + Tailwind CSS 4 with light/dark design tokens and security headers. Placeholder home page.
- `packages/contracts`: shared zod schemas (emirates, problem details, health).
- `packages/config`: shared tsconfig presets.
- `infra/docker-compose.yml`: Postgres 16 + pgvector, Redis, MinIO, Mailpit, ClamAV.
- CI: format, lint, typecheck, test, build; gitleaks secret scan.

**Tested**

- Config validation (API, worker), emirate list parsing, public API URL guard.
- API HTTP tests: health endpoints, 404 problem details with request id, request id echo, security headers.
- Worker context boot/shutdown.

**Configurable, decision pending**

- `SUPPORTED_EMIRATES` (default `Dubai,Abu Dhabi`).

**Not yet done / known issues**

- `/health/ready` reports database and Redis as `skipped` until PR 2 adds those connections.
- Docker compose stack not verified in CI (no services used yet).
- shadcn/ui, Next.js ESLint plugin and Playwright arrive with the first UI PR.
- CodeQL, dependency audit and Trivy workflows arrive in PR 12.
