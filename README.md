# PropForce AI

Multi-tenant AI real estate brokerage operating system for UAE agencies.

> Status: **Phase 1, PR 1 (scaffold)**. See [docs/PROGRESS.md](docs/PROGRESS.md) for what is built and tested, and [docs/architecture](docs/architecture/README.md) for the planning documents.

## Requirements

- Node.js 22 (`.nvmrc`), pnpm 10 (`corepack enable`)
- Docker (for local Postgres, Redis, MinIO, Mailpit, ClamAV)

## Getting started

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm infra:up        # optional for now; required from PR 2
pnpm build
pnpm dev             # web on :3000, api on :4000
```

Checks:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Layout

```
apps/api       NestJS REST API
apps/worker    Background job processors (BullMQ, from later PRs)
apps/web       Next.js web app
packages/      Shared contracts and config
infra/         Local docker-compose
docs/          Architecture deliverables and progress report
```
