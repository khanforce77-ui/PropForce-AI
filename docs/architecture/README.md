# PropForce AI · Initial Deliverables

Planning set, version 0.1, 2026-11-20. Diagrams are Mermaid (render on GitHub or any Mermaid viewer).

| # | Document | Summary |
|---|---|---|
| 01 | [Product Requirements](01-product-requirements.md) | Personas, goals, scope by phase, functional/non-functional requirements, AI guardrails, open questions |
| 02 | [System Architecture](02-system-architecture.md) | Modular monolith, tenant context + RLS, messaging pipeline, AI orchestration and tool gateway, matching, queues |
| 03 | [Database ERD](03-database-erd.md) | Mermaid ERDs by domain, indexes, RLS template, full table list |
| 04 | [Feature Matrix](04-feature-matrix.md) | Every feature by phase, plan, role, external dependency; draft plan limits |
| 05 | [API Specification](05-api-specification.md) | Conventions, endpoint inventory, sample payloads, AI tool contracts, webhook security |
| 06 | [Monorepo Structure](06-monorepo-structure.md) | pnpm/Turborepo layout, boundary rules, CI pipeline |
| 07 | [Security & Compliance Checklist](07-security-compliance-checklist.md) | Isolation, auth, AI, data protection, messaging, voice, real estate compliance controls |
| 08 | [Infrastructure Architecture](08-infrastructure-architecture.md) | AWS UAE + Vercel, environments, deployment, scaling, DR |
| 09 | [First 30-Day Sprint Plan](09-first-30-day-sprint-plan.md) | Sprint 0–3 tasks, acceptance, dependencies on you |
| 10 | [Estimated Monthly Costs](10-estimated-monthly-operating-costs.md) | Fixed and usage costs at 100 / 1,000 agencies (estimates, verify) |
| 11 | [Risk Register](11-development-risk-register.md) | 22 scored risks with mitigations |
| 12 | [Phase 1 Implementation Plan](12-phase-1-implementation-plan.md) | 12 PRs, ADRs, definition of done, exit criteria |

**Important caveats:** cost figures and all UAE regulatory references (DLD/RERA fees, TDRA marketing rules, PDPL, AML) are estimates or pointers that need verification with vendors, authorities or counsel. No feature is claimed to work until it is built and tested.
