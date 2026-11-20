# 11 · Development Risk Register

**Version:** 0.1 · **Date:** 2026-11-20 · Likelihood (L) and Impact (I) on 1–5. Score = L × I. Reviewed at the end of every sprint.

| ID | Risk | Category | L | I | Score | Mitigation | Owner | Trigger to watch |
|---|---|---|---|---|---|---|---|---|
| R01 | Cross-tenant data leak through a missed query, worker, storage path or AI tool | Security | 3 | 5 | **15** | RLS (forced, fail-closed) + app-level scoping + generic isolation test suite in CI + tenant in job payloads + code review checklist | Eng lead | Any isolation test failure; RLS error logs |
| R02 | AI states wrong price, availability or legal info | AI / Legal | 4 | 5 | **20** | Tool-only facts, grounding validator, freshness window, refusal + handover for legal/mortgage, eval set, weekly audits | AI lead | Eval pass rate < threshold; agent flags |
| R03 | Prompt injection via client messages or uploaded files changes AI behavior | AI / Security | 4 | 4 | **16** | Data/instruction separation, tool allowlist, server-side arg validation, no third-party side effects, injection evals EN/AR | AI lead | Denied tool calls spike |
| R04 | Meta Business verification / WABA approval delays or rejections | Dependency | 4 | 4 | **16** | Start immediately in parallel; build against fake adapter + test number; Phase 1 has no WhatsApp dependency | Ali | No verification by end of Sprint 2 |
| R05 | WhatsApp number quality drops or gets restricted due to agency behavior | Compliance | 3 | 4 | 12 | Consent enforcement, approval flows, rate limits, auto-pause on quality changes, agency education | Product | Quality rating changes |
| R06 | UAE regulatory requirements misunderstood (PDPL, TDRA marketing rules, RERA advertising, voice recording, AML) | Legal | 3 | 5 | **15** | UAE counsel review before Phase 3/4 launch; compliance settings configurable; nothing marked compliant without evidence | Ali | Counsel findings |
| R07 | Fee calculator shows outdated fees and agency relies on it | Legal / Product | 3 | 4 | 12 | Versioned schedules with verified_by/at, "Estimate" labels, stale-schedule warnings, sample data flagged | Product | Schedule older than 90 days |
| R08 | Google OAuth verification for Calendar scopes takes weeks or needs a security assessment | Dependency | 4 | 3 | 12 | Start early; internal calendar works without Google; use testing mode with test users meanwhile | Ali | Not submitted by Day 15 |
| R09 | OpenAI cost overruns from long conversations or abuse | Cost | 3 | 3 | 9 | Rolling summaries, token budgets per turn, per-tenant spend caps, model tiering, debounce | Eng | Cost per reply > budget |
| R10 | OpenAI outage or latency spikes | Reliability | 3 | 3 | 9 | Timeouts, retries, fallback message + human handover, provider abstraction for a second LLM | Eng | p95 > 15 s |
| R11 | Scope creep from 13 modules leads to an unstable, untested product | Delivery | 5 | 4 | **20** | Strict phasing, feature flags, definition of done includes tests, progress report per phase | PM | Sprint goals missed twice |
| R12 | Bulk import corrupts data or creates duplicates at scale | Data | 3 | 3 | 9 | Preview, per-batch rollback, duplicate detection, row limits, idempotent commit | Eng | Rollback usage |
| R13 | Webhook duplicates or out-of-order events cause double replies | Reliability | 4 | 3 | 12 | Idempotency on provider IDs, per-conversation lock, status monotonicity rules | Eng | Duplicate outbound detected |
| R14 | Noisy tenant (large campaign) starves other tenants | Scalability | 3 | 3 | 9 | Per-tenant limiters/groups in BullMQ, campaign rate caps | Eng | Queue age per tenant |
| R15 | Voice outbound misuse creates telemarketing violations | Legal | 2 | 5 | 10 | Disabled by default, SA unlock with evidence, DNC and hours checks, recording consent | Ali/SA | Any outbound enablement request |
| R16 | Data residency expectations not met (e.g. using non-UAE regions or US AI processing) | Legal / Sales | 3 | 3 | 9 | Decide hosting early; document sub-processors and transfers; offer DPA | Ali | Enterprise prospect questions |
| R17 | Billing provider not supporting UAE entity, AED or required payment methods | Dependency | 2 | 4 | 8 | Evaluate 2–3 providers; billing behind adapter | Ali | Provider decision by Day 30 |
| R18 | Arabic language quality in AI replies is poor | Product | 3 | 3 | 9 | Arabic eval set, native reviewer, language detection, handover | AI lead | Reviewer scores |
| R19 | Secrets leak via repo, logs or frontend bundle | Security | 2 | 5 | 10 | gitleaks, log redaction, bundle scan, OIDC deploys, rotation runbook | Eng | Scanner alerts |
| R20 | Key-person dependency / limited team capacity | Delivery | 4 | 3 | 12 | Documentation, ADRs, runbooks, consistent structure | Ali | — |
| R21 | Claimed scalability without proof | Credibility | 3 | 3 | 9 | Only quote k6 results; publish test profile | Eng | Marketing claims |
| R22 | GitHub repo access not ready, blocking Phase 1 start | Delivery | 3 | 2 | 6 | Deliverables proceed; scaffold can be prepared locally | Ali | Access still missing at Day 1 |

## Top risks (score ≥ 15)

R02 AI factual errors, R11 scope creep, R03 prompt injection, R04 Meta verification, R01 tenant leak, R06 regulatory misunderstanding. Each has a test or a decision gate in the Phase 1–2 plans.
