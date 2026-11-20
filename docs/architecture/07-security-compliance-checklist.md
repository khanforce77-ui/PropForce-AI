# 07 · Security and Compliance Checklist

**Version:** 0.1 · **Date:** 2026-11-20

Status column is for tracking during implementation: ☐ not started · ◐ in progress · ☑ done and tested. Everything starts ☐. A control is only ☑ when a test or evidence link exists.

> **Not legal advice.** The regulatory items below identify areas to verify with UAE counsel and the relevant authorities (DLD/RERA, ADREC, TDRA, UAE Data Office, DIFC/ADGM where relevant, Meta policy). Names of rules and requirements must be confirmed before launch.

## 1. Tenant isolation

| # | Control | Phase | Evidence | Status |
|---|---|---|---|---|
| T1 | `tenant_id` on every tenant table, NOT NULL, FK | 1 | schema review | ☐ |
| T2 | PostgreSQL RLS `ENABLE` + `FORCE` on every tenant table; fail-closed when context unset | 1 | migration + test | ☐ |
| T3 | App DB role is not owner, no `BYPASSRLS`; separate migration role and platform role | 1 | infra config | ☐ |
| T4 | TenantGuard validates membership + agency status on each request | 1 | tests | ☐ |
| T5 | Workers set tenant context from job payload; job schema requires `tenantId` | 1 | tests | ☐ |
| T6 | Storage keys prefixed by tenant; signed URL issued only after tenant-scoped DB lookup | 1 | tests | ☐ |
| T7 | Vector search always pre-filtered by tenant + hard filters | 2 | tests | ☐ |
| T8 | AI tools receive tenant from context, never from model | 2 | tests | ☐ |
| T9 | Redis keys and rate limits namespaced per tenant | 1 | review | ☐ |
| T10 | Automated cross-tenant test suite: for every endpoint, tenant B cannot read/write tenant A resources (expects 404) | 1 | CI job | ☐ |
| T11 | Analytics queries tenant-scoped; Super Admin aggregates via platform role only | 3 | review | ☐ |

## 2. Authentication and sessions

| # | Control | Phase | Status |
|---|---|---|---|
| A1 | Argon2id password hashing; breached-password check (k-anonymity) optional | 1 | ☐ |
| A2 | Password policy: ≥ 12 chars, no forced rotation | 1 | ☐ |
| A3 | Login rate limiting + progressive delay per IP and per account | 1 | ☐ |
| A4 | Short-lived access JWT (15 min, asymmetric signing, key rotation), rotating refresh tokens with reuse detection | 1 | ☐ |
| A5 | Refresh cookie httpOnly, Secure, SameSite=Strict; CSRF protection on cookie routes | 1 | ☐ |
| A6 | TOTP MFA, mandatory for Owner/Admin/Super Admin; hashed recovery codes | 1 | ☐ |
| A7 | Email verification and reset tokens: single use, hashed, 30–60 min expiry | 1 | ☐ |
| A8 | Invitations: hashed tokens, 7-day expiry, email-bound | 1 | ☐ |
| A9 | Session listing and revocation; suspension revokes all sessions | 1 | ☐ |
| A10 | Generic auth error messages (no account enumeration) | 1 | ☐ |

## 3. Authorization

| # | Control | Phase | Status |
|---|---|---|---|
| Z1 | Central permission catalog; role → permission map; default deny | 1 | ☐ |
| Z2 | Resource-level rules (agents limited to assigned leads/listings unless granted) | 1 | ☐ |
| Z3 | Four-eyes on sensitive actions (campaign approval ≠ creator; outbound voice unlock by SA) | 3 | ☐ |
| Z4 | Super Admin impersonation requires reason, time-boxed, audited, visible to tenant | 3 | ☐ |
| Z5 | Permission matrix tests per role | 1 | ☐ |

## 4. Application security

| # | Control | Phase | Status |
|---|---|---|---|
| S1 | Input validation (zod) on all bodies, params, queries; reject unknown fields | 1 | ☐ |
| S2 | Output encoding; React default escaping; sanitize any rich text (DOMPurify) | 1 | ☐ |
| S3 | Security headers: CSP, HSTS, X-Content-Type-Options, frame-ancestors, Referrer-Policy | 1 | ☐ |
| S4 | CORS allowlist to web origins only | 1 | ☐ |
| S5 | File uploads: type allowlist + magic-byte check, size limit, malware scan before availability, images re-encoded | 1 | ☐ |
| S6 | CSV/Excel import: formula injection neutralized on export, row limits, no macros executed | 1 | ☐ |
| S7 | SSRF protection on any URL fetch (allowlist, block private ranges) | 2 | ☐ |
| S8 | Rate limiting per IP, user, tenant and endpoint class | 1 | ☐ |
| S9 | Idempotency keys for create/send endpoints | 1 | ☐ |
| S10 | Webhook signature verification, timestamp tolerance, replay protection | 2 | ☐ |
| S11 | No secrets in frontend bundle; build check greps bundle for key patterns | 1 | ☐ |
| S12 | Dependency scanning (Dependabot/pnpm audit), SAST (CodeQL), secret scanning (gitleaks), container scanning (Trivy) | 1 | ☐ |
| S13 | DAST (OWASP ZAP baseline) against staging, scheduled | 3 | ☐ |
| S14 | Third-party penetration test before GA | 4 | ☐ |

## 5. AI-specific security

| # | Control | Phase | Status |
|---|---|---|---|
| I1 | Untrusted content (client messages, files, brochures, web) delimited as data; never merged into system prompt | 2 | ☐ |
| I2 | Tool allowlist per run; server-side argument validation; tenant/principal injected | 2 | ☐ |
| I3 | Grounding validator: no price/availability/payment-plan claim without matching tool result | 2 | ☐ |
| I4 | No AI tool can contact third parties other than the current conversation's contact | 2 | ☐ |
| I5 | Sensitive tool calls create ApprovalRequest | 2 | ☐ |
| I6 | Prompt injection eval set in CI (EN + AR), pass threshold enforced | 2 | ☐ |
| I7 | PII minimization in prompts; no secrets in prompts; OpenAI data controls reviewed (API data not used for training by default, confirm current terms and retention) | 2 | ☐ |
| I8 | Per-tenant AI spend caps and per-conversation turn limits | 2 | ☐ |
| I9 | Every AI run and tool call audited with prompt version and model | 2 | ☐ |

## 6. Data protection

| # | Control | Phase | Status |
|---|---|---|---|
| D1 | TLS 1.2+ everywhere, including DB and Redis connections | 1 | ☐ |
| D2 | Encryption at rest (managed DB, storage, backups) | 1 | ☐ |
| D3 | Application-level envelope encryption for OAuth tokens, WABA tokens, MFA secrets (KMS-managed key) | 1 | ☐ |
| D4 | Secrets in managed secret store; never in repo; `.env.example` only lists names | 1 | ☐ |
| D5 | Log redaction for PII, tokens, message bodies (configurable) | 1 | ☐ |
| D6 | Retention policies per data class (messages, transcripts, recordings, audit logs, deleted contacts) with scheduled purge | 3 | ☐ |
| D7 | Data subject requests: export and erasure per contact, tenant data export on cancellation | 3 | ☐ |
| D8 | Backups: daily + PITR, encrypted, restore tested quarterly | 1 (staging) | ☐ |
| D9 | Data processing inventory and sub-processor list (OpenAI, Meta, Google, hosting, email, billing) | 2 | ☐ |
| D10 | Data residency decision documented; cross-border transfer basis reviewed under UAE PDPL | 2 | ☐ |

## 7. Operational security

| # | Control | Phase | Status |
|---|---|---|---|
| O1 | Least-privilege IAM for cloud, CI and DB | 1 | ☐ |
| O2 | Branch protection, required reviews, signed commits optional | 1 | ☐ |
| O3 | Security event logging (failed logins, permission denials, webhook signature failures, RLS violations) | 2 | ☐ |
| O4 | Alerting on anomalies (spikes in denials, outbound volume, AI cost) | 2 | ☐ |
| O5 | Incident response runbook, severity levels, contact tree | 3 | ☐ |
| O6 | Key rotation runbook (JWT keys, encryption keys, provider tokens) | 3 | ☐ |
| O7 | Disaster recovery plan with RPO ≤ 15 min, RTO ≤ 4 h targets, tested | 4 | ☐ |

## 8. Messaging and marketing compliance

| # | Control | Phase | Status |
|---|---|---|---|
| M1 | Official WhatsApp Business Platform only; no unofficial libraries or automation | 2 | ☐ |
| M2 | Business-initiated messages only via approved templates; 24-hour service window enforced | 2 | ☐ |
| M3 | Opt-in captured and stored with source/evidence before any marketing template | 2 | ☐ |
| M4 | Opt-out keywords (EN/AR) processed immediately; global suppression per tenant | 2 | ☐ |
| M5 | Send pipeline hard-blocks recipients without consent or on suppression list (cannot be overridden by UI or AI) | 3 | ☐ |
| M6 | Campaigns require human approval and preview | 3 | ☐ |
| M7 | Rate limits respecting Meta messaging tiers and quality rating; auto-pause on quality drop | 3 | ☐ |
| M8 | No number scraping, purchased-list sends without attested consent, or platform-restriction evasion features | all | ☐ |
| M9 | Verify UAE telemarketing/marketing-message rules (e.g. TDRA guidance on marketing calls/messages, permitted hours, DNCR) and encode them as tenant compliance settings | 3 | ☐ |
| M10 | Listing advertising compliance: permit number displayed where required (e.g. Dubai Trakheesi/RERA permit; verify current Abu Dhabi requirements) | 1 (fields), 4 (marketing) | ☐ |

## 9. Voice compliance

| # | Control | Phase | Status |
|---|---|---|---|
| V1 | Outbound calling flag default false; only Super Admin can enable after recording evidence of approvals | 4 | ☐ |
| V2 | Licensed UAE telecom route only (verify with TDRA-authorized provider); no VoIP routes that breach local rules | 4 | ☐ |
| V3 | Recording consent announcement; no recording/transcription when consent not given | 4 | ☐ |
| V4 | AI disclosure at call start (caller is speaking with an AI assistant) | 4 | ☐ |
| V5 | Calling-hours and DNC checks before any outbound call | 4 | ☐ |

## 10. Real estate domain compliance

| # | Control | Phase | Status |
|---|---|---|---|
| R1 | Store agency licence/ORN and agent BRN fields; verify display requirements in listings and messages | 1 | ☐ |
| R2 | Fee schedules versioned with source and verifier; outputs labeled estimates; seed data flagged sample | 3 | ☐ |
| R3 | Documents (Form F/MOU, tenancy contract) generated as drafts only; no automatic execution or submission | 3 | ☐ |
| R4 | No automated financial transactions; deposits tracked as records only | 3 | ☐ |
| R5 | AI disclaimers for legal, mortgage and visa questions; handover instead of advice | 2 | ☐ |
| R6 | AML: capture KYC checklist items for deals where required (verify current UAE AML obligations for real estate brokers, including goAML reporting thresholds) | 3 | ☐ |
