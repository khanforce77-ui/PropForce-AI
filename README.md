# PropForce AI

Multi-tenant AI real estate brokerage operating system for UAE agencies.

> Status: **Phase 1, PR 3 (registration, login and sessions)**. See [docs/PROGRESS.md](docs/PROGRESS.md) for what is built and tested, and [docs/architecture](docs/architecture/README.md) for the planning documents.

## Requirements

- Node.js 22 (`.nvmrc`), pnpm 10 (`corepack enable`)
- Docker (for local Postgres, Redis, MinIO, Mailpit, ClamAV)

## Getting started

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm infra:up        # Postgres, Redis, MinIO, Mailpit, ClamAV
pnpm db:setup        # apply migrations, create the app DB role
pnpm build
pnpm dev             # web on :3000, api on :4000
```

Checks (database tests need `pnpm infra:up` and `pnpm db:setup` first):

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Tenant isolation

Every agency's data is separated by PostgreSQL row-level security. The app connects with a role
that cannot bypass it, and all tenant queries run through `withTenant(prisma, { tenantId }, fn)`
from `@propforce/db`. Without a tenant context, tenant tables return no rows. See
`packages/db/test/tenant-isolation.test.ts`.

## Layout

```
apps/api       NestJS REST API
apps/worker    Background job processors (BullMQ, from later PRs)
apps/web       Next.js web app
packages/      Shared contracts, config and the database package (Prisma + RLS)
infra/         Local docker-compose
docs/          Architecture deliverables and progress report
```
