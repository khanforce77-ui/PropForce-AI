# 12 · Phase 1 Implementation Plan

**Version:** 0.1 · **Date:** 2026-11-20 · Target repository: `github.com/khanforce77-ui/PropForce-AI` (write access pending)

## 1. Phase 1 scope

Covers master-prompt steps 6–11: monorepo, authentication and tenant isolation, agency onboarding, property inventory, CRM, deterministic property matching. **No external credentials are required** for Phase 1: email goes to Mailpit locally, storage to MinIO, malware scanning to a ClamAV container. Every external integration has a Fake adapter and a real adapter stub that returns `INTEGRATION_NOT_CONFIGURED`.

Out of Phase 1: WhatsApp, OpenAI, Google Calendar, billing, voice (Phase 2+).

## 2. Work breakdown (one PR each, reviewed before merge)

| # | PR | Contents | Tests | Acceptance |
|---|---|---|---|---|
| 1 | `chore: monorepo scaffold` | pnpm + Turborepo, TS strict, ESLint boundaries, Prettier, `apps/{web,api,worker}`, `packages/{db,contracts,domain,auth,queue,integrations,ui,testing,config}`, docker-compose, `.env.example`, CI | smoke test per app | `pnpm i && pnpm build && pnpm test` green in CI |
| 2 | `feat(db): tenancy schema + RLS` | Prisma models for identity/tenancy/audit, SQL migration with RLS + roles, tenant-aware client extension | integration: RLS blocks cross-tenant; unset context returns nothing | migration applies on clean DB; tests green |
| 3 | `feat(auth): registration, login, sessions` | register (user + agency + owner membership), email verification, login, refresh rotation with reuse detection, logout, forgot/reset, rate limits | integration + unit | Playwright register → verify → login |
| 4 | `feat(auth): MFA` | TOTP enroll/verify, recovery codes, enforcement for owner/admin | integration | cannot access app as owner without MFA after grace |
| 5 | `feat(tenancy): members, invitations, roles, audit` | permission catalog, guards, invitations, suspension, teams, audit interceptor + endpoint | role matrix tests, isolation suite v1 | owner invites agent, agent accepts, permissions enforced |
| 6 | `feat(web): app shell + onboarding` | layout, theme (light/dark), navigation, onboarding wizard, settings, members UI | Playwright | end-to-end onboarding |
| 7 | `feat(inventory): properties + media` | property/project/permit/media models + RLS, CRUD, status lifecycle, verify, presigned upload, scan worker, signed GET | integration incl. EICAR file, isolation | agent creates listing with images; infected file rejected |
| 8 | `feat(imports): bulk property import` | upload → mapping → validation → preview → commit → rollback, duplicate detection | fixtures with bad/duplicate rows | 1,000-row file imports with error report; rollback restores state |
| 9 | `feat(crm): contacts, leads, requirements` | contacts/identities, consent + suppression, leads, sources, requirements, tasks, notes, tags, assignment, scoring v1, dedupe + merge | unit (phone normalization, scoring), integration, isolation | create lead with 2 requirements; merge duplicates with audit |
| 10 | `feat(matching): deterministic engine` | `packages/domain/matching` hard filters + weighted scoring + reasons; API endpoint; feedback | unit (scoring table tests), integration (no inactive/stale/other-tenant results) | lead detail shows ranked matches with reasons |
| 11 | `feat(web): inventory + CRM UI` | property table/form/import wizard, contacts, leads list, lead detail, Kanban | Playwright | demo flows pass |
| 12 | `chore: seed, docs, hardening` | realistic fictional seed data, README setup, PROGRESS.md, security CI (CodeQL, gitleaks, audit, Trivy), Dockerfiles, k6 baseline | CI | checklist Phase 1 items have evidence |

## 3. Key technical decisions (ADRs to commit)

| ADR | Decision |
|---|---|
| 001 | Modular monolith (NestJS) + separate worker process |
| 002 | Shared schema multi-tenancy with forced RLS + app-level scoping |
| 003 | UUIDv7 IDs |
| 004 | zod contracts as source of truth → OpenAPI → generated web client |
| 005 | JWT access (15 min) + rotating DB-backed refresh sessions |
| 006 | Adapters with Fake implementations for every external integration |
| 007 | Deterministic matching first; semantic only re-ranks within filtered set (Phase 2) |

## 4. Tenant context implementation sketch

```ts
// packages/db/src/tenant-client.ts
export function tenantPrisma(base: PrismaClient, ctx: () => TenantContext) {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const { tenantId, userId } = ctx(); // throws if missing
          const [, , result] = await base.$transaction([
            base.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
            base.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`,
            query(args),
          ]);
          return result;
        },
      },
    },
  });
}
```

This sketch will be validated in PR 2. Interactive transactions and connection pooling (PgBouncer transaction mode) need explicit tests because `set_config(..., true)` is transaction-local.

## 5. Definition of done (every PR)

- Code + migration + tests in the same PR.
- `lint`, `typecheck`, `test`, `build` pass in CI; isolation suite passes for new routes.
- OpenAPI updated; no breaking change without version note.
- `docs/PROGRESS.md` updated: what was built, what was tested, what is pending, known issues.
- No secrets committed; `.env.example` updated with names only.
- I'll ask before pushing to `main`, merging, or opening PRs, per your instruction; default flow is feature branch → PR → your review.

## 6. Prerequisites to start

| Item | Status |
|---|---|
| Write access to `khanforce77-ui/PropForce-AI` for the connected GitHub account (or connecting the `khanforce77-ui` account) | **pending** |
| Confirm repo is empty or describe existing contents | to be inspected on access |
| Emirates at launch (Dubai only vs Dubai + Abu Dhabi) | open (PRD Q1) |
| Brand name/colors for UI theme | optional for Phase 1 |

## 7. Phase 1 exit criteria

1. A new agency can self-register, verify email, set up MFA, onboard, and invite agents.
2. Agents manage listings with media and bulk import; managers see all, agents see their own as configured.
3. Contacts, leads and multiple requirements work, with consent records and duplicate merge.
4. Matching returns explainable scores and never returns other-tenant, inactive or stale listings (tested).
5. Isolation test suite covers every tenant endpoint and passes in CI.
6. Setup instructions let a developer run everything locally with `docker compose up` + `pnpm dev`.
7. Progress report lists every untested or pending item honestly.
