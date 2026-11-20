# 09 · First 30-Day Sprint Plan

**Version:** 0.1 · **Date:** 2026-11-20 · Assumes work starts once a repository is attached. Calendar days, two-week sprints plus a hardening week. Dates are relative (Day 1 = repo ready).

Goal for day 30: **a staging-ready Phase 1** where an agency can register, verify email, enable MFA, invite agents, manage properties (including bulk import), manage contacts/leads/requirements, and get explainable deterministic matches, with tenant isolation proven by automated tests.

## Sprint 0 · Days 1–3 · Foundation

| Task | Output | Done when |
|---|---|---|
| Inspect repo and environment; record Node/pnpm/Docker versions | `docs/PROGRESS.md` entry | committed |
| Monorepo scaffold (pnpm, Turborepo, TS strict, ESLint, Prettier) | `apps/web`, `apps/api`, `apps/worker`, `packages/*` | `pnpm build` passes |
| docker-compose: Postgres 16 + pgvector, Redis, MinIO, Mailpit | `infra/docker-compose.yml` | `docker compose up` healthy |
| CI workflow: lint, typecheck, test, build | `.github/workflows/ci.yml` | green on PR |
| Config validation, logger, health endpoints, ProblemDetails filter | api skeleton | tests pass |

## Sprint 1 · Days 4–14 · Auth, tenancy, isolation, onboarding

| Task | Done when |
|---|---|
| Prisma schema: user, agency, membership, team, invitation, session, mfa_factor, audit_log, agency_settings, feature_flag, outbox_event | migration applies on clean DB |
| RLS SQL for tenant tables; app/migrator/platform DB roles | isolation test fails when RLS is disabled, passes when enabled |
| Tenant-aware Prisma extension (`SET LOCAL app.tenant_id`) + AsyncLocalStorage context | unit + integration tests |
| Register, verify email, login, refresh rotation, logout, forgot/reset | supertest integration tests |
| TOTP MFA enroll/verify, recovery codes, mandatory for owner/admin | tests |
| Permission catalog, role map, PermissionGuard, resource rules | role matrix tests |
| Invitations (create, email via Mailpit, accept), suspension, session revoke | tests |
| Audit interceptor + audit log endpoint | tests |
| Web: auth pages, agency onboarding wizard (name, emirate, licence/ORN optional, branding), members page | Playwright: register → onboard → invite → accept |
| Cross-tenant isolation test harness (generic, runs over every tenant route) | in CI |

## Sprint 2 · Days 15–25 · Inventory, CRM, matching

| Task | Done when |
|---|---|
| Schema: project, property, property_permit, property_media, import_batch, import_row | migration + RLS |
| Property CRUD API + filters + status lifecycle + verify action | integration tests |
| Media: presigned upload to MinIO/S3, ClamAV scan worker, signed GET URLs | tests with EICAR test file |
| CSV/Excel import: parse (SheetJS/csv), mapping, validation (zod), duplicate detection, preview, commit, rollback | tests with fixture files incl. bad rows |
| Schema: contact, contact_identity, consent_record, suppression_entry, lead_source, lead, requirement, task, note, tag, match_result | migration + RLS |
| Phone normalization (libphonenumber, default region AE), duplicate detection, merge | unit tests |
| Leads: assignment (manual + round-robin), stages, scoring v1 (rule-based, explainable) | tests |
| Deterministic matching engine in `packages/domain` + API | unit tests on scoring; integration test ensures no cross-tenant or inactive results |
| Web: property table + form + import wizard; contacts/leads list, lead detail with requirements and matches, Kanban board | Playwright happy paths |
| Seed: 3 fictional agencies, ~300 properties, ~500 contacts, realistic UAE communities | `pnpm db:seed` |

## Sprint 3 · Days 26–30 · Hardening and staging readiness

| Task | Done when |
|---|---|
| Security pass against checklist items scheduled for Phase 1 | checklist statuses updated with evidence |
| Security CI: CodeQL, gitleaks, dependency audit, Trivy | workflows green |
| Dockerfiles for api/worker; staging deployment plan (or deploy if hosting is chosen and access granted) | images build; deploy doc |
| Baseline k6 script for CRUD + matching (local) | results recorded, no scalability claims beyond them |
| `docs/PROGRESS.md`, setup README, known issues | reviewed |
| Demo walkthrough recording/script | shared |

## Dependencies on Ali (needed during the 30 days)

| Need | By |
|---|---|
| GitHub repository (existing or new) | Day 1 |
| Hosting decision (AWS UAE vs PaaS) | Day 20 |
| Domain + transactional email provider | Day 10 (dev uses Mailpit until then) |
| Start Meta Business verification and WhatsApp test number (lead time for Phase 2) | Day 1 (in parallel) |
| Google Cloud project for OAuth consent screen (verification can take weeks) | Day 15 |
| Billing provider choice | Day 30 |

## Ceremonies

Daily: progress note in `docs/PROGRESS.md`. End of each sprint: demo + updated risk register + list of untested/pending items.
