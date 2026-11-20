# 04 · Feature Matrix

**Version:** 0.1 · **Date:** 2026-11-20

Legend — **Phase**: 1–4 (see PRD §5). **Plan**: S = Starter, P = Professional, A = Agency, E = Enterprise. **Ext**: external dependency needing credentials/approval (⏳ = adapter built, integration pending until credentials are supplied). Roles: SA = Super Admin, O = Owner, AD = Admin, M = Manager, AG = Agent.

Plan packaging is a proposal for discussion; final limits depend on cost validation (`10-operating-costs.md`).

## A · Authentication and tenant management

| Feature | Phase | Plan | Roles | Ext |
|---|---|---|---|---|
| Register + create agency | 1 | All | public → O | Email provider ⏳ (dev: console/Mailpit) |
| Email verification | 1 | All | all | Email ⏳ |
| Login, refresh, logout, session list/revoke | 1 | All | all | – |
| Password reset | 1 | All | all | Email ⏳ |
| TOTP MFA (required for O/AD) | 1 | All | all | – |
| Invite members, accept invite | 1 | All | O, AD | Email ⏳ |
| Role management, suspension | 1 | All | O, AD | – |
| Teams and managers | 1 | P+ | O, AD | – |
| Agency settings & branding | 1 | All | O, AD | – |
| Tenant audit log viewer | 1 | All | O, AD | – |
| Subscription status & usage limits enforcement | 3 | All | O | Billing ⏳ |
| SSO (SAML/OIDC) | 4 | E | O | IdP |

## B · Property inventory

| Feature | Phase | Plan | Roles | Ext |
|---|---|---|---|---|
| CRUD for all property types incl. off-plan projects and rentals | 1 | All | AD, M, AG (own) | – |
| Permit info fields + expiry warnings | 1 | All | AD, AG | – |
| Media upload (images, video, brochure, floor plan) with signed URLs | 1 | All | AD, AG | S3 |
| Malware scanning of uploads | 1 | All | system | ClamAV container |
| Listing expiry & verification freshness | 1 | All | system | – |
| CSV/Excel import: mapping, validation, preview, duplicates, commit, rollback | 1 | All | AD, M | – |
| Property search & filters | 1 | All | all | – |
| Embeddings for semantic search | 2 | All | system | OpenAI ⏳ |
| Portal feed import (official APIs only) | 4 | A+ | AD | Portals ⏳ |

## C · Smart CRM

| Feature | Phase | Plan | Roles | Ext |
|---|---|---|---|---|
| Contacts, leads, multiple requirements | 1 | All | all (agents: assigned only) | – |
| Lead sources, UTM fields | 1 | All | all | – |
| Assignment: manual, round-robin, rules; reassignment history | 1 | All | AD, M | – |
| Rule-based lead scoring (explainable) | 1 | All | system | – |
| AI-assisted scoring signals | 2 | P+ | system | OpenAI ⏳ |
| Tasks, notes, tags | 1 | All | all | – |
| Duplicate detection & merge with audit | 1 | All | AD, M | – |
| Consent records & opt-out management | 1 | All | all (read), system | – |
| Suppression list | 1 | All | AD | – |
| Kanban lead board | 1 | All | all | – |
| Conversation history on lead | 2 | All | all | – |

## D · AI WhatsApp agent

| Feature | Phase | Plan | Roles | Ext |
|---|---|---|---|---|
| WABA connection (sandbox/test number) | 2 | All | AD | Meta ⏳ |
| Webhook verification + signature check + idempotency | 2 | All | system | Meta ⏳ |
| Inbound text/media, message history | 2 | All | system | Meta ⏳ |
| Unified inbox with realtime updates | 2 | All | all | – |
| AI replies grounded in inventory | 2 | All (metered) | system | OpenAI ⏳ |
| Buyer / seller / tenant / landlord qualification flows | 2 | All | system | OpenAI ⏳ |
| Brochure delivery | 2 | All | system | Meta ⏳ |
| Viewing requests via AI | 2 | All | system | Calendar ⏳ |
| Human takeover / return to AI | 2 | All | AG, M | – |
| Conversation summaries | 2 | All | system | OpenAI ⏳ |
| Approved templates management & sync | 2 | All | AD | Meta ⏳ |
| Opt-in/opt-out enforcement, 24h window | 2 | All | system | – |
| Delivery status tracking | 2 | All | system | Meta ⏳ |
| Embedded Signup onboarding (Tech Provider) | 3 | All | O | Meta business verification ⏳ |
| Multiple numbers per agency | 3 | A+ | AD | Meta ⏳ |

## E · Property matching

| Feature | Phase | Plan | Roles | Ext |
|---|---|---|---|---|
| Deterministic hard filters + weighted scoring + reasons | 1 | All | all | – |
| Semantic re-ranking within filtered set | 2 | All | system | OpenAI ⏳ |
| Match feedback loop (liked/rejected/viewed) | 2 | All | AG | – |
| New-listing alerts to matched leads (consented only) | 3 | P+ | system | Meta ⏳ |

## F · AI Lead Booster

| Feature | Phase | Plan | Roles | Ext |
|---|---|---|---|---|
| Lead CSV import + phone normalization + dedupe | 3 | P+ | AD, M | – |
| Consent verification (blocks recipients without valid consent) | 3 | P+ | system | – |
| Suppression enforcement | 3 | P+ | system | – |
| AI segmentation & scoring | 3 | P+ | system | OpenAI ⏳ |
| Campaign preview, human approval, approved templates | 3 | P+ | M (create), O/AD (approve) | Meta ⏳ |
| Per-tenant rate limiting & quality-rating guard | 3 | P+ | system | – |
| Reply classification + CRM update | 3 | P+ | system | OpenAI ⏳ |
| Meta Lead Ads / Google Ads lead ingest | 4 | P+ | AD | Meta/Google ⏳ |

## G · AI voice agent

| Feature | Phase | Plan | Roles | Ext |
|---|---|---|---|---|
| Telecom/voice provider abstraction | 4 | A+ | system | Vapi + UAE telecom ⏳ |
| Inbound AI call handling + qualification | 4 | A+ | system | ⏳ |
| Human transfer | 4 | A+ | system | ⏳ |
| Recording consent prompt & policy | 4 | A+ | AD | – |
| Transcripts (policy-gated), summaries, outcomes | 4 | A+ | system | ⏳ |
| Call cost tracking | 4 | A+ | system | ⏳ |
| Outbound calling (**disabled by default**, SA unlock after verified approvals) | 4 | E | SA, O | Regulatory approval ⏳ |

## H · Calendar and viewings

| Feature | Phase | Plan | Roles | Ext |
|---|---|---|---|---|
| Internal viewing calendar (no external sync) | 1 | All | all | – |
| Google Calendar OAuth per agent | 2 | All | AG | Google OAuth app verification ⏳ |
| Free/busy checks, conflict prevention | 2 | All | system | Google ⏳ |
| Book / reschedule / cancel with authorization | 2 | All | AG, system | Google ⏳ |
| Reminders (WhatsApp template / email) | 2 | All | system | Meta/Email ⏳ |
| Location sharing (map link) | 2 | All | system | – |
| Post-viewing feedback task | 2 | All | system | – |
| Microsoft 365 calendar | 4 | P+ | AG | Microsoft ⏳ |

## I · Deal management

| Feature | Phase | Plan | Roles | Ext |
|---|---|---|---|---|
| Sales pipeline (15 stages) & rental pipeline (10 stages) | 3 | All | all | – |
| Stage checklists, milestones, deadlines, reminders | 3 | All | all | – |
| Document templates (agency-supplied), versions, approvals | 3 | P+ | AD, M | – |
| Commission splits & invoicing records | 3 | P+ | O, AD, M | – |
| E-signature integration (licensed provider) | 4 | A+ | – | ⏳ |

## J · UAE cost calculator

| Feature | Phase | Plan | Roles | Ext |
|---|---|---|---|---|
| Versioned fee schedules, verification metadata | 3 | All | SA (templates), AD (tenant overrides) | – |
| Calculators: ready sale, off-plan, mortgage, rental, commercial | 3 | All | all, AI tool | – |
| "Estimate" labeling + source + verified date on every output | 3 | All | system | – |
| Shareable PDF quote | 3 | P+ | AG | – |

## K · Marketing studio

| Feature | Phase | Plan | Roles | Ext |
|---|---|---|---|---|
| Branded listing/brochure PDF | 4 | P+ | AG | – |
| AI social captions (review before use) | 4 | P+ | AG | OpenAI ⏳ |
| Comparison PDFs | 4 | P+ | AG | – |
| Landing pages with consent capture | 4 | A+ | AD | – |
| UTM tracking & attribution analytics | 4 | A+ | AD, M | – |

## L · SaaS billing

| Feature | Phase | Plan | Roles | Ext |
|---|---|---|---|---|
| Plans, seats, trials | 3 | All | O | Billing provider ⏳ |
| Usage metering (AI, WhatsApp, voice, storage) | 2 (metering) / 3 (billing) | All | system | – |
| Spending caps (warn/block) | 3 | All | O | – |
| Invoices, history, VAT | 3 | All | O | Billing ⏳ |
| Payment webhooks, dunning, cancellation | 3 | All | system | Billing ⏳ |

## M · Super Admin

| Feature | Phase | Plan | Roles | Ext |
|---|---|---|---|---|
| Agency list, status, suspend | 1 (basic) | – | SA | – |
| Feature flags | 1 | – | SA | – |
| MRR, churn, subscribers | 3 | – | SA | Billing ⏳ |
| Unit costs (AI, WhatsApp, voice) per tenant | 3 | – | SA | – |
| Queue health, failed jobs, DLQ replay | 2 | – | SA | – |
| Security alerts | 2 | – | SA | – |
| Support tickets | 4 | – | SA | – |
| Audited impersonation (with reason, tenant-visible) | 3 | – | SA | – |

## Proposed plan limits (draft, to be validated)

| | Starter | Professional | Agency | Enterprise |
|---|---|---|---|---|
| Seats | 3 | 10 | 30 | Custom |
| Active listings | 200 | 1,000 | 5,000 | Custom |
| WhatsApp numbers | 1 | 1 | 3 | Custom |
| AI replies included / month | 1,000 | 5,000 | 20,000 | Custom |
| Lead Booster | – | ✓ | ✓ | ✓ |
| Voice agent | – | – | Inbound | Inbound + outbound (gated) |
| Storage | 10 GB | 50 GB | 200 GB | Custom |
