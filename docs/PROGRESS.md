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

## Phase 1 · PR 3 · Registration, email verification, login and sessions (2026-11-20)

**Built**

- `POST /v1/auth/register`: creates user (Argon2id password hash), agency (status `pending`), settings, owner membership and an audit entry inside the new tenant context; emails a verification link. Emirate must be in `SUPPORTED_EMIRATES`. Same response for existing emails (a notice is emailed instead) so accounts cannot be enumerated.
- `POST /v1/auth/verify-email`, `/resend-verification`: single-use, hashed, 24-hour tokens; a new link invalidates the old one.
- `POST /v1/auth/login`: generic error for wrong password and unknown email (with a dummy hash to even out timing); unverified emails blocked.
- Access tokens: EdDSA JWT (15 min) bound to a session row, so logout/refresh/reset revoke them immediately.
- Refresh tokens: httpOnly, SameSite=Strict cookie scoped to `/v1/auth`, rotated on every use, family revoked on reuse; refresh/logout require the `x-propforce-csrf: 1` header.
- `POST /v1/auth/password/forgot` and `/password/reset`: 30-minute single-use token; reset signs out all sessions.
- `GET /v1/me`, `GET /v1/me/sessions`, `DELETE /v1/me/sessions/:id`.
- Rate limiting on auth routes (in-memory, per IP); stricter on resend and forgot.
- Email port with SMTP adapter (Mailpit locally) and a log-only fallback when SMTP is not configured.
- `/health/ready` now checks the database (503 when down).
- Config now requires JWT keys and SMTP in staging/production.

**Tested** (28 API tests against real Postgres): every flow above, including token reuse, expiry, refresh-token theft detection, session revocation across users, input validation with unknown-field rejection, rate limiting (429), cookie flags.

**Not yet done / known issues**

- MFA (PR 4). Owners/admins can sign in without MFA until then.
- Rate limiter storage is in-memory; must move to Redis before running more than one API replica. `trust proxy` must be configured behind the load balancer so limits use the client IP.
- Agency stays `pending` until onboarding (PR 6).
- Email templates are plain text.
- Login for suspended memberships/agencies is handled when tenant selection lands (PR 5).
