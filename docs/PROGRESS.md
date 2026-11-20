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

## Phase 1 · PR 2 · Database tenancy and row-level security (2026-11-20)

**Built**

- `packages/db`: Prisma 7 schema and first migration for users, sessions, MFA factors, feature flags, agencies, agency settings, teams, memberships, invitations and the audit log. Extensions `citext`, `vector`, `pg_trgm` enabled.
- Row-level security, enabled and forced on every tenant table, fail-closed when no context is set.
- `propforce_app` database role (no ownership, no BYPASSRLS) for the API and workers; migrations run as the owner.
- `withTenant`, `withUser` and `findInvitationByTokenHash` helpers that set transaction-local context (`set_config(..., true)`), so values never leak between pooled connections.
- `agency_settings.outbound_voice_enabled` defaults to `false`.
- CI runs Postgres 16 + pgvector, applies migrations and runs the database tests as the application role.

**Tested (against real Postgres 16)**

- No context: tenant tables return nothing and inserts fail.
- Tenant A cannot read, insert, update, delete or move rows of tenant B; agency row protected.
- Audit log cannot be updated or deleted by the app role.
- No context leakage across pooled connections.
- Registration flow: agency + settings + owner membership created inside a new tenant context.
- User context sees only that user's memberships and agencies (read-only).
- Invitation lookup by token hash returns only the matching row.
- Schema guard: every table with `tenant_id` must have RLS enabled, forced and a policy; app role is not superuser, cannot bypass RLS, owns no tables.
- Verified the suite fails when RLS is disabled on a table (manual mutation check).

**Not yet done / known issues**

- API does not connect to the database yet; `/health/ready` still reports `database: skipped` (PR 3 wires it with auth).
- Platform tables (`user`, `session`, `mfa_factor`) have no RLS by design; access must stay inside the auth module.
- PgBouncer transaction pooling not tested yet (planned before staging).
- Production DB login role is created by infrastructure tooling, not by `setup-local-roles`.
