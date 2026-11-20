# 06 · Monorepo Folder Structure

**Version:** 0.1 · **Date:** 2026-11-20 · pnpm workspaces + Turborepo · Node 22 LTS · TypeScript strict

```
propforce/
├── apps/
│   ├── web/                         # Next.js (App Router) → Vercel
│   │   ├── app/
│   │   │   ├── (auth)/login, register, verify-email, reset-password, accept-invite
│   │   │   ├── (app)/[agency]/
│   │   │   │   ├── dashboard/
│   │   │   │   ├── properties/ (list, [id], new, import/)
│   │   │   │   ├── crm/ (contacts/, leads/, board/)
│   │   │   │   ├── inbox/
│   │   │   │   ├── calendar/
│   │   │   │   ├── deals/ (sales/, rental/)
│   │   │   │   ├── campaigns/
│   │   │   │   ├── calculator/
│   │   │   │   ├── marketing/
│   │   │   │   └── settings/ (agency, members, teams, integrations, billing, audit, compliance)
│   │   │   └── (admin)/admin/ (agencies, metrics, queues, flags, security, support)
│   │   ├── components/              # app-specific composites (PropertyTable, LeadKanban, InboxThread…)
│   │   ├── lib/ (api-client, auth, query-client, tenant)
│   │   ├── e2e/                     # Playwright specs
│   │   └── next.config.ts
│   │
│   ├── api/                         # NestJS HTTP API
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── common/              # guards (Auth, Tenant, Permission), interceptors (Audit, Idempotency),
│   │   │   │                        # filters (ProblemDetails), pipes (Zod), decorators, tenant-context (ALS)
│   │   │   ├── config/              # typed env config, validated at boot
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   ├── tenancy/         # agency, membership, invitations, teams, settings
│   │   │   │   ├── audit/
│   │   │   │   ├── inventory/       # properties, projects, media, permits
│   │   │   │   ├── imports/
│   │   │   │   ├── crm/             # contacts, leads, requirements, tasks, notes, tags, merge
│   │   │   │   ├── consent/         # consent records, opt-out, suppression
│   │   │   │   ├── matching/
│   │   │   │   ├── conversations/
│   │   │   │   ├── whatsapp/        # webhook ingress, sender, templates
│   │   │   │   ├── ai/              # orchestrator, tool-gateway, tools/, prompts/, validators/
│   │   │   │   ├── calendar/
│   │   │   │   ├── viewings/
│   │   │   │   ├── deals/
│   │   │   │   ├── fees/
│   │   │   │   ├── campaigns/
│   │   │   │   ├── voice/
│   │   │   │   ├── marketing/
│   │   │   │   ├── billing/
│   │   │   │   ├── storage/
│   │   │   │   ├── notifications/   # email, in-app
│   │   │   │   └── admin/
│   │   │   └── health/
│   │   └── test/                    # integration + contract + isolation tests (supertest, testcontainers)
│   │
│   └── worker/                      # NestJS standalone app running BullMQ processors
│       └── src/
│           ├── main.ts
│           └── processors/ (inbound-messages, ai-replies, outbound-messages, imports, embeddings,
│                            calendar-sync, documents-pdf, billing-usage, reminders, outbox-relay, retention)
│
├── packages/
│   ├── db/                          # Prisma schema, migrations, RLS SQL, seed, tenant-aware client extension
│   │   ├── prisma/schema.prisma
│   │   ├── prisma/migrations/
│   │   ├── sql/rls/                 # policies applied in migrations
│   │   ├── src/client.ts            # withTenant(tx) helper, SET LOCAL app.tenant_id
│   │   └── seed/                    # realistic demo agencies, properties, leads (fictional data)
│   ├── contracts/                   # zod schemas + inferred types shared by api/web/worker; OpenAPI export
│   ├── domain/                      # pure logic: matching scoring, fee engine, lead scoring, phone normalization
│   ├── integrations/                # adapters behind interfaces
│   │   ├── whatsapp/ (MetaCloudAdapter, FakeWhatsAppAdapter)
│   │   ├── llm/ (OpenAIAdapter, FakeLlmAdapter)
│   │   ├── calendar/ (GoogleCalendarAdapter, FakeCalendarAdapter, MicrosoftCalendarAdapter stub)
│   │   ├── voice/ (VapiAdapter stub, FakeVoiceAdapter)
│   │   ├── billing/ (ProviderAdapter stub, FakeBillingAdapter)
│   │   ├── email/ (SmtpAdapter, ConsoleAdapter)
│   │   ├── storage/ (S3Adapter — works with MinIO locally)
│   │   └── scanning/ (ClamAvAdapter)
│   ├── queue/                       # queue names, job payload schemas, BullMQ factory, tenant fairness
│   ├── auth/                        # permission catalog, role → permission map, policy helpers
│   ├── ui/                          # shadcn/ui components, theme tokens (light/dark), charts wrappers
│   ├── config/ (eslint, tsconfig, prettier, tailwind preset)
│   └── testing/                     # factories, tenant fixtures, fake adapters wiring, isolation test helpers
│
├── infra/
│   ├── docker/ (api.Dockerfile, worker.Dockerfile)
│   ├── docker-compose.yml           # postgres+pgvector, redis, minio, mailpit, clamav
│   ├── k6/                          # load test scripts
│   └── terraform/                   # later: managed DB, Redis, buckets, secrets
│
├── docs/
│   ├── architecture/ (these 12 deliverables, ADRs)
│   ├── runbooks/ (incident, DLQ replay, key rotation, restore)
│   └── PROGRESS.md                  # maintained progress report per phase
│
├── .github/
│   ├── workflows/ (ci.yml, security.yml, deploy-staging.yml)
│   ├── CODEOWNERS
│   └── pull_request_template.md
├── .env.example                     # names only, no secrets
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

## Rules

1. `apps/*` may depend on `packages/*`; packages never depend on apps.
2. Only `packages/db` imports `@prisma/client`; others use repositories exposed by modules.
3. Only `packages/integrations` talks to third-party SDKs; each adapter has a **Fake** used in tests and local dev, and a real adapter that reports `INTEGRATION_NOT_CONFIGURED` when credentials are absent.
4. `packages/domain` is framework-free and fully unit tested.
5. Contracts are the single source of truth for request/response types; the web client is generated from OpenAPI.
6. ESLint boundary rules (`eslint-plugin-boundaries`) enforce module edges.

## CI pipeline (`ci.yml`)

`install (pnpm, cache)` → `lint` → `typecheck` → `unit tests` → `prisma migrate deploy` on Postgres service → `integration + isolation tests` → `build` → `OpenAPI diff check` → (main only) `e2e (Playwright)`.

`security.yml`: dependency audit / Dependabot, CodeQL (SAST), gitleaks (secret scanning), Trivy container scan; scheduled OWASP ZAP baseline (DAST) against staging.
