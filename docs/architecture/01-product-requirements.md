# 01 · Product Requirements Document (PRD)

**Product:** PropForce AI, a multi-tenant AI Real Estate Brokerage Operating System for the UAE
**Version:** 0.1 (planning draft) · **Date:** 2026-11-20 · **Status:** Draft for review

---

## 1. Problem

UAE brokerages run on WhatsApp, spreadsheets, portal leads and personal calendars. Leads arrive at all hours, often in English and Arabic, and the first agent to respond with an accurate, relevant listing usually wins. Agencies lose deals to slow response, inconsistent qualification, poor follow-up and lost context when leads move between agents. Compliance pressure (consent, permits, advertising rules, data protection) is rising and most tools treat it as an afterthought.

## 2. Vision

A single operating system where an agency's inventory, CRM, WhatsApp conversations, calendars, deals and commissions live together, with an AI layer that answers and qualifies leads **only from verified tenant inventory**, books viewings into real calendars, and hands over to a human the moment it should. Compliance controls (consent, opt-out, outbound approval, voice gating) are built in, not bolted on.

## 3. Target users and personas

| Persona | Role in product | Core jobs |
|---|---|---|
| **Platform Super Admin** (PropForce staff) | Platform operator | Manage tenants, plans, feature flags, costs, incidents, support |
| **Agency Owner** | Tenant owner, billing contact | Set up agency, subscribe, invite staff, view performance and commissions |
| **Agency Admin** | Tenant operator | Configure integrations, permissions, templates, fee rules, imports |
| **Team Manager** | Supervises a team of agents | Assign leads, monitor pipelines, approve campaigns and documents |
| **Real Estate Agent** | Front-line user | Manage listings, respond to leads, run viewings, progress deals |
| **End client** (buyer, seller, tenant, landlord) | External, no login in v1 | Chats on WhatsApp, receives brochures, books viewings |

Initial market: small to mid-sized Dubai and Abu Dhabi brokerages (5 to 50 agents). Enterprise brokerages (100+ agents) follow.

## 4. Goals and success metrics

| Goal | Metric | Target (first 6 months after GA, to validate) |
|---|---|---|
| Faster lead response | Median first response time on WhatsApp | < 60 seconds (AI), < 10 minutes (human handover) |
| Better qualification | % leads with complete requirement (budget, area, type, beds, timeline) | > 60% |
| More viewings | Viewings booked per 100 qualified leads | +25% vs agency baseline |
| AI accuracy | Responses containing a property fact not traceable to inventory | 0 tolerated; audited weekly |
| Retention | Logo churn per month | < 3% |
| Compliance | Outbound messages sent without valid consent | 0 (hard blocked) |

These are hypotheses; baselines must be measured with pilot agencies.

## 5. Scope by module

Modules A–M as described in the master prompt. Release grouping:

| Release | Modules | Notes |
|---|---|---|
| **Phase 1 (MVP foundation)** | A Auth & tenants, B Inventory (incl. CSV/Excel import), C CRM, E deterministic matching | Runs without any third-party credentials |
| **Phase 2 (AI + messaging)** | D WhatsApp (sandbox), AI orchestration, E semantic matching, H Google Calendar | Requires Meta WABA test number, OpenAI key, Google OAuth client |
| **Phase 3 (revenue ops)** | F Lead Booster, I Deals, J Cost calculator, L Billing | Requires billing provider account; fee rules entered and verified by agency/admin |
| **Phase 4 (scale & expand)** | G Voice (inbound first), K Marketing studio, M Super Admin full, Microsoft Calendar, Meta/Google lead ads | Voice outbound off by default, compliance-gated |

## 6. Functional requirements (summary)

Full detail per feature is in `04-feature-matrix.md`. Key requirements:

**FR-A Auth & tenancy.** Email/password with verification, password reset, TOTP MFA (mandatory for Owner/Admin, optional for others in v1), invitations with expiring tokens, role assignment, suspension, session revocation, tenant-scoped audit log. One user may belong to multiple agencies (membership model) but every request runs in exactly one active tenant.

**FR-B Inventory.** All property types listed in the prompt; attributes including permit info (e.g. RERA/Trakheesi permit number, ADREC permit where applicable) stored as data, never invented. Listing lifecycle: draft → active → under offer → sold/rented → archived; expiry and "last verified" timestamp. AI may only reference listings with status `active` and a verification timestamp within the agency-configured freshness window (default 14 days). Bulk import: upload → map columns → validate → preview with row errors and duplicates → commit as one batch → rollback the batch within 7 days.

**FR-C CRM.** Contacts, leads (a contact's engagement with the agency), multiple requirements per contact, source tracking, assignment and reassignment (round-robin, manual, rules), scoring, tags, notes, tasks, merge with audit trail, duplicate detection on normalized phone (E.164) and email, consent records per channel and purpose, opt-out handling across all channels.

**FR-D WhatsApp agent.** Official Cloud API only. Webhook verification and signature check (X-Hub-Signature-256), idempotent processing, inbound text/media, 24-hour customer service window enforcement, outside the window only approved templates, opt-out keywords (STOP, إلغاء, etc.) honored immediately, human takeover per conversation, AI summaries, delivery/read status.

**FR-E Matching.** Hard filters first (tenant, availability, status, budget ceiling with configurable tolerance, emirate, type, beds). Then weighted scoring on soft criteria. Then semantic re-ranking within the filtered set only. Every match returns score and human-readable reasons.

**FR-F Lead Booster.** Import, normalize, dedupe, consent check against consent records and suppression list, segment, preview, **mandatory human approval** before any send, approved templates only, rate limits per tenant and per number quality tier, reply classification, CRM updates. No scraping, no blasting, no unconsented sends: the send pipeline rejects any recipient without valid consent.

**FR-G Voice.** Provider abstraction (Vapi or equivalent + licensed UAE telecom route). Inbound first. Outbound globally disabled per tenant until a Super Admin records verified approvals. Recording consent prompt and per-tenant policy; transcripts stored only where policy allows.

**FR-H Calendar.** Google OAuth per agent (offline access, minimal scopes), free/busy checks, booking with conflict prevention, reschedule/cancel, reminders, post-viewing feedback task. AI may *request* a booking; creating the event requires either agent pre-authorization (auto-confirm setting) or explicit agent confirmation.

**FR-I Deals.** Separate sales and rental pipelines with the stages listed in the prompt; configurable checklists, document templates with versions and approvals, milestone deadlines and reminders, commission splits. The system prepares documents; it never signs, submits or pays.

**FR-J Cost calculator.** Rule engine with versioned fee schedules per emirate and transaction type, each rule having source, effective dates, and `verified_by/verified_at`. Output always labeled "Estimate". No fee values shipped as facts; seed data is marked `UNVERIFIED – sample`.

**FR-K Marketing.** Brochure/listing PDF generation with agency branding, AI captions (reviewed before publishing), comparison PDFs, landing pages with lead capture and consent checkbox, UTM attribution.

**FR-L Billing.** Plans Starter/Professional/Agency/Enterprise; seats; metered AI tokens, WhatsApp conversations, voice minutes, storage; spending caps; webhooks; dunning; cancellation.

**FR-M Super Admin.** Tenants, MRR/churn, unit-cost dashboards, job health, DLQ replay, security alerts, feature flags, support tickets, impersonation only with reason + audit + tenant-visible log.

## 7. Non-functional requirements

| Area | Requirement |
|---|---|
| Isolation | No cross-tenant read/write possible through API, workers, search, storage or AI tools; proven by automated isolation tests in CI |
| Performance | p95 API < 300 ms for CRUD at 100 agencies; AI reply p95 < 8 s end-to-end (to be measured) |
| Availability | 99.5% target for MVP, 99.9% for paid Enterprise tier later |
| Data residency | Prefer UAE or nearest-region hosting; document where each data class lives (see `08-infrastructure-architecture.md`) |
| Localization | English UI first; Arabic RTL in Phase 4; AI replies in the client's language (EN/AR minimum) |
| Accessibility | WCAG 2.1 AA for core flows |
| Auditability | Every AI tool call, outbound message, permission change and document approval is audited |
| Privacy | UAE PDPL (Federal Decree-Law 45/2021) principles; DIFC/ADGM rules if those tenants appear; retention policies per data class |

## 8. AI guardrails (product-level)

1. The AI only states property facts returned by tools from the tenant's own verified inventory, and cites the property reference.
2. No legal, tax, visa or mortgage-approval advice beyond templated, agency-approved disclaimers; it hands over instead.
3. Prices, fees and payment plans come from the listing record or the cost calculator, labeled as estimates where applicable.
4. Client text, file contents and brochures are untrusted data; they cannot change the AI's instructions or tool permissions.
5. Sensitive actions (outbound campaigns, calendar writes without pre-auth, document generation for signature, deal stage changes past "Offer accepted") require a human.
6. The client can ask for a human at any time; the AI must offer handover when confidence is low, on complaints, or on negotiation.

## 9. Out of scope (v1)

Client-facing portal/app, portal syndication (Bayut/Property Finder/Dubizzle feeds; candidate for Phase 4 via official APIs only), escrow or payment processing for property transactions, e-signature execution (integration later via a licensed provider), mortgage origination.

## 10. Assumptions and open questions

| # | Question | Owner |
|---|---|---|
| Q1 | Which emirates at launch: Dubai only, or Dubai + Abu Dhabi? Affects permit fields and fee rules | Ali |
| Q2 | Billing provider: Stripe (UAE entities supported), Checkout.com, Telr, or PayTabs? | Ali |
| Q3 | Will PropForce be a Meta Tech Provider (agencies onboard their own WABA via Embedded Signup) or will agencies bring existing WABAs? | Ali |
| Q4 | Hosting region preference and any client data-residency commitments? | Ali |
| Q5 | Pilot agencies available for discovery and baseline metrics? | Ali |
| Q6 | Brand, domain and design direction for the UI | Ali |
