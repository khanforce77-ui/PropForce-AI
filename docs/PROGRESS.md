# Progress Report

Updated with every PR. "Tested" means covered by an automated test that passes in CI.

## Phase 1 · PR 1 · Monorepo scaffold (2026-11-20)

**Built**

- pnpm workspace + Turborepo; TypeScript strict; ESLint (typescript-eslint) and Prettier.
- `apps/api`: NestJS 12, env validation (zod) that fails at boot, pino structured logging with request ids and header redaction, helmet security headers, CORS allowlist, RFC 9457 error responses, `/health/live` and `/health/ready`.
- `apps/worker`: NestJS application context with validated config. No queue processors yet.
- `apps/web`: Next.js 16 + Tailwind CSS 4 with light/dark design tokens and security headers. Placeholder home page.
- `packages/contracts`: shared zod schemas (emirates, problem details, health).
- `packages/config`: shared tsconfig presets.
- `infra/docker-compose.yml`: Postgres 16 + pgvector, Redis, MinIO, Mailpit, ClamAV.
- CI: format, lint, typecheck, test, build; gitleaks secret scan.

**Tested**

- Config validation (API, worker), emirate list parsing, public API URL guard.
- API HTTP tests: health endpoints, 404 problem details with request id, request id echo, security headers.
- Worker context boot/shutdown.

**Configurable, decision pending**

- `SUPPORTED_EMIRATES` (default `Dubai,Abu Dhabi`).

**Not yet done / known issues**

- `/health/ready` reports database and Redis as `skipped` until PR 2 adds those connections.
- Docker compose stack not verified in CI (no services used yet).
- shadcn/ui, Next.js ESLint plugin and Playwright arrive with the first UI PR.
- CodeQL, dependency audit and Trivy workflows arrive in PR 12.

## Phase 1 · PR 2 · Database tenancy and row-level security (2026-11-20)

**Built**

- `packages/db`: Prisma 7 schema and first migration for users, sessions, MFA factors, feature flags, agencies, agency settings, teams, memberships, invitations and the audit log. Extensions `citext`, `vector`, `pg_trgm` enabled.
- Row-level security, enabled and forced on every tenant table, fail-closed when no context is set.
- `propforce_app` database role (no ownership, no BYPASSRLS) for the API and workers; migrations run as the owner.
- `withTenant`, `withUser` and `findInvitationByTokenHash` helpers that set transaction-local context (`set_config(..., true)`), so values never leak between pooled connections.
- `agency_settings.outbound_voice_enabled` defaults to `false`.
- CI runs Postgres 16 + pgvector, applies migrations and runs the database tests as the application role.

**Tested (against real Postgres 16)**

- No context: tenant tables return nothing and inserts fail.
- Tenant A cannot read, insert, update, delete or move rows of tenant B; agency row protected.
- Audit log cannot be updated or deleted by the app role.
- No context leakage across pooled connections.
- Registration flow: agency + settings + owner membership created inside a new tenant context.
- User context sees only that user's memberships and agencies (read-only).
- Invitation lookup by token hash returns only the matching row.
- Schema guard: every table with `tenant_id` must have RLS enabled, forced and a policy; app role is not superuser, cannot bypass RLS, owns no tables.
- Verified the suite fails when RLS is disabled on a table (manual mutation check).

**Not yet done / known issues**

- API does not connect to the database yet; `/health/ready` still reports `database: skipped` (PR 3 wires it with auth).
- Platform tables (`user`, `session`, `mfa_factor`) have no RLS by design; access must stay inside the auth module.
- PgBouncer transaction pooling not tested yet (planned before staging).
- Production DB login role is created by infrastructure tooling, not by `setup-local-roles`.

## Phase 1 · PR 3 · Registration, email verification, login and sessions (2026-11-20)

**Built**

- `POST /v1/auth/register`: creates user (Argon2id password hash), agency (status `pending`), settings, owner membership and an audit entry inside the new tenant context; emails a verification link. Emirate must be in `SUPPORTED_EMIRATES`. Same response for existing emails (a notice is emailed instead) so accounts cannot be enumerated.
- `POST /v1/auth/verify-email`, `/resend-verification`: single-use, hashed, 24-hour tokens; a new link invalidates the old one.
- `POST /v1/auth/login`: generic error for wrong password and unknown email (with a dummy hash to even out timing); unverified emails blocked.
- Access tokens: EdDSA JWT (15 min) bound to a session row, so logout/refresh/reset revoke them immediately.
- Refresh tokens: httpOnly, SameSite=Strict cookie scoped to `/v1/auth`, rotated on every use, family revoked on reuse; refresh/logout require the `x-propforce-csrf: 1` header.
- `POST /v1/auth/password/forgot` and `/password/reset`: 30-minute single-use token; reset signs out all sessions.
- `GET /v1/me`, `GET /v1/me/sessions`, `DELETE /v1/me/sessions/:id`.
- Rate limiting on auth routes (in-memory, per IP); stricter on resend and forgot.
- Email port with SMTP adapter (Mailpit locally) and a log-only fallback when SMTP is not configured.
- `/health/ready` now checks the database (503 when down).
- Config now requires JWT keys and SMTP in staging/production.

**Tested** (28 API tests against real Postgres): every flow above, including token reuse, expiry, refresh-token theft detection, session revocation across users, input validation with unknown-field rejection, rate limiting (429), cookie flags.

**Not yet done / known issues**

- MFA (PR 4). Owners/admins can sign in without MFA until then.
- Rate limiter storage is in-memory; must move to Redis before running more than one API replica. `trust proxy` must be configured behind the load balancer so limits use the client IP.
- Agency stays `pending` until onboarding (PR 6).
- Email templates are plain text.
- Login for suspended memberships/agencies is handled when tenant selection lands (PR 5).

## Phase 1 · PR 4 · Two-factor authentication (TOTP) (2026-11-20)

**Built**

- `POST /v1/me/mfa/totp/setup` → secret and `otpauth://` URI (for QR code); `POST /v1/me/mfa/totp/confirm` with a first code → enables MFA and returns 10 one-time recovery codes, shown once.
- Login with MFA on: `POST /v1/auth/login` returns `{ mfaRequired, mfaToken }` (5-minute signed challenge, no session yet); `POST /v1/auth/mfa/verify` with a TOTP code or a recovery code creates the session.
- TOTP codes cannot be replayed: the last accepted time step is stored and checked atomically. Recovery codes are single use.
- `POST /v1/me/mfa/disable` needs the password and a valid second factor. `GET /v1/me/mfa` shows status and remaining recovery codes.
- TOTP secrets encrypted at rest with AES-256-GCM (key `DATA_ENCRYPTION_KEY`, required in staging/production, bound to the user id as associated data). Recovery codes stored as HMAC-SHA256.
- `GET /v1/me` now includes `user.mfaEnabled` and `mfaRequired` (true for owners/admins).
- Stricter rate limits on MFA endpoints (5/min).

**Tested**: 8 MFA API tests (enrolment, wrong first code, encrypted storage, duplicate enrolment, login second step, replay rejection, forged/misused challenge tokens, recovery code single use, disable rules) and 4 encryption unit tests (round trip, fresh IV, tamper and AAD mismatch, wrong key). 42 API tests total.

**Not yet done / known issues**

- Mandatory MFA for owners/admins is reported by `/me` but enforced on tenant routes in PR 5 (tenant selection), since no tenant routes exist yet.
- Key rotation for `DATA_ENCRYPTION_KEY` (ciphertexts carry a version byte for this) has no tooling yet.

## Phase 1 · PR 5 · Agency members, roles, invitations, teams and audit log (2026-11-20)

**Built**

- Agency context: tenant routes take the agency id in `X-Tenant-Id`. `TenantGuard` checks on every request that the user has an active membership, the agency is not suspended/cancelled, owners/admins have MFA on (now enforced), and the role has the route's permission (default deny).
- Permission catalog (`src/tenancy/permissions.ts`): owner/admin full access; manager and agent read-only for agency, members and teams in this PR (their CRM/inventory permissions come with those modules).
- `GET/PATCH /v1/agency`, `GET/PATCH /v1/agency/settings` (outbound voice cannot be enabled by the agency).
- `GET /v1/members`, `PATCH /v1/members/:id` (role, team), `POST /v1/members/:id/suspend|reactivate`. Only owners grant/change owner and admin roles or suspend them; nobody changes their own role or suspends themselves; at least one active owner is kept.
- Teams: list, create, rename, delete.
- Invitations: create (7-day single-use link by email; replaces a pending invite for the same email), list, revoke, and public `POST /v1/invitations/accept`. New people set name + password (email is treated as verified); existing accounts must be signed in as the invited email.
- `GET /v1/audit-logs` with filters and cursor pagination. Audit entries are written inside the same transaction as the change.

**Tested**: 17 tenancy API tests: header validation, non-member refusal, MFA enforcement for owners and admins, suspended agency, profile/settings with audit, settings cannot enable outbound voice, invitation flows (new account, single use, revoked, expired, existing account must sign in as invitee, duplicates), agent permission matrix (8 routes refused), admin limits, suspension/reactivation, teams, audit pagination, and cross-agency isolation through the API (members, teams, invitations, audit log). 59 API tests total.

**Not yet done / known issues**

- Removing a member entirely (status `removed`) has no endpoint yet; suspension covers offboarding for now.
- Agency onboarding UI and activation (`pending` → `active`) come with the web app PR.
- Manager team-scoped permissions are defined when leads/listings exist.

## Phase 1 · PR 6 · Web app: sign-in, two-factor setup, onboarding, team members (2026-11-20)

**Built**

- Pages: register, verify email, sign in (with authenticator-code and recovery-code step), forgot/reset password, accept invitation, agency picker, two-factor setup (QR code + manual key, recovery codes shown once), agency onboarding, dashboard placeholder, team members (invite, revoke, suspend/reactivate).
- Access token kept in memory only; session restored from the httpOnly refresh cookie on reload; refresh is single-flight so concurrent calls never reuse a rotated token.
- Owners/admins without two-factor are routed to setup before any agency page (the API also enforces it).
- App shell with sidebar, mobile-friendly layout, light/dark theme without flash. Sign-up only offers emirates in `NEXT_PUBLIC_SUPPORTED_EMIRATES`.
- API: `POST /v1/agency/onboarding/complete` (pending → active, audited).
- CI: new `e2e` job (Postgres + Mailpit services, Playwright Chromium).

**Tested**

- Playwright end-to-end: register → verify via emailed link → sign in → forced two-factor setup → recovery codes → onboarding → invite agent → agent accepts in a separate browser session → agent signs in, sees team but no admin controls → owner suspends agent; suspended agent signs in and no longer sees the agency; session survives reload.
- API test for onboarding completion (idempotent, audited). 60 API tests total.

**Not yet done / known issues**

- Two browser tabs refreshing at the same moment can trip refresh-token reuse detection and sign the user out (safe failure). A short grace window or cross-tab lock can follow.
- Settings pages (agency profile edit, teams, audit log viewer, session list) have API support but no screens yet.
- Arabic/RTL not started (planned for Phase 4).

## PR 12 · Listings and dashboard (Phase 1, inventory part 1)

- Database: `project`, `property`, `property_permit` with forced RLS. Composite `(id, tenant_id)` foreign keys make the database itself refuse a listing that points at another agency's project, agent or listing. Check constraints cover prices, areas, rooms and the rent period. Agency setting `require_permit_to_publish` (default on).
- API: `GET/POST /v1/properties`, `GET/PATCH/DELETE /v1/properties/:id`, `POST /v1/properties/:id/status`, `POST /v1/properties/:id/verify`, permits, `GET/POST /v1/projects`, `GET /v1/dashboard/summary`. Every change is audited.
- Rules: listings start as drafts. Publishing needs a price, area, community and, by default, an unexpired advertising permit, and sets a freshness date from `listing_freshness_days`. The lifecycle is enforced. Agents edit only listings assigned to them; managers, admins and owners edit and reassign any.
- Web: Listings page (search, filters, pagination), Add listing, listing detail (publish, status changes, "still available", permits, edit), and dashboard counts plus recent listings.
- Tests: 7 new db isolation tests, 12 new API tests, 1 new Playwright flow (add → publish with permit → dashboard).
- Not yet: photos and media uploads (next PR), bulk import, map location.
- The platform stores permit numbers as entered and does not check them with DLD or ADREC.

## Phase 2 · PR 1 · AI orchestration core (2026-11-20)

**Built** (`packages/ai`, no database or network access of its own)

- Tool catalog for all 12 AI tools from API spec §8, each with a strict zod schema (unknown keys rejected) and a policy: permission, sensitivity, per-conversation rate limit.
- `ToolGateway`: allowlist → reserved scope fields refused (`tenantId`, `conversationId`, ...; scope always comes from server context) → schema → permission (AI's fixed set ∩ assigned agent's permissions) → rate limit → spend cap → sensitivity → execute → audit. Every attempt is audited, including refusals. Handler error details are never shown to the model.
- Viewing requests are sensitive: confirmed only when the agent pre-authorized auto-confirm, otherwise created as a request needing a human; refused when no agent is assigned.
- Prompt-injection defenses: client text, history and summaries go into a nonce-delimited untrusted block in a user message (never the instructions); invisible/bidi characters stripped; forged boundary tags defanged; heuristic detector (EN/AR) flags attempts for audit.
- Grounding validator: the model must return structured JSON with `citedPropertyIds` and `claims`; replies are rejected if they cite properties no tool returned this turn, if claims don't match the listing, or if the text contains AED amounts, sqft or bedroom counts not found in tool results or in the client's own words (handles "AED 1.85M", "2 million dirhams", Arabic digits). Backstop for visa/mortgage/guaranteed-return advice.
- `AiOrchestrator.runTurn`: tool loop (max 6 steps), on any failure (grounding, provider error, step limit, spend cap) sends a fixed EN/AR fallback and hands over to a human through the gateway. Records each run (provider, model, prompt version, tokens, latency, outcome, injection flag, grounding failures).
- LLM port with `FakeLlmProvider` (tests, evals) and an OpenAI Responses API adapter (`store: false`, strict JSON output).

**Tested**: 42 unit tests (gateway refusals and audit, permissions ceiling, approvals, rate limit, spend cap, grounding accept/reject cases, injection wrapping and detection, orchestrator end-to-end with the fake model, OpenAI request building and response parsing offline).

**Pending**

- OpenAI adapter has NOT been run against the live API (no key yet).
- Not wired into the API/worker yet: needs Conversation/Message tables (WhatsApp PR) and Phase 1 listings/leads services for the real tool handlers.
- Audit/run sinks and the Redis rate limiter are interfaces only; DB tables `ai_run` / `ai_tool_call` come with the wiring PR.
- Golden-conversation eval set (EN/AR, injection attempts) still to be written.

## Phase 2 · PR 2 · WhatsApp Cloud API building blocks (2026-11-20)

**Built** (`packages/whatsapp`, library only)

- Webhook security: `X-Hub-Signature-256` HMAC check on the raw body (constant time, 1 MB limit, fails closed without a secret) and the GET verify-token handshake.
- Webhook parsing into normalized message/status events keyed by `wamid`; malformed items are skipped and counted instead of failing the batch.
- Messaging rules: opt-out/opt-in keywords in English and Arabic (whole-message match, so "which metro stop?" is not an opt-out), 24-hour service window, and one fail-closed `checkOutboundSend` gate (opt-out → window → approved template → consent outside the window).
- Per-agency numbers: every send takes the tenant's own phone number id and decrypted token. Embedded Signup adapter exchanges the signup code server-side (secret in the POST body, never a URL) and subscribes the app to the agency's WABA.
- Cloud API send adapter (link previews off, Graph errors mapped to retryable/non-retryable codes) plus fakes.

**Tested**: 38 unit tests.

**Pending**

- Cloud API and Embedded Signup adapters NOT run against Meta (no verified business, app or test number yet).
- API webhook endpoint, queue, and the WhatsApp account / conversation / message tables come in the next PR.

## Phase 2 · PR 3 · Google Calendar building blocks (2026-11-20)

**Built** (`packages/calendar`, library only)

- OAuth: authorization code + PKCE (S256), HMAC-signed 10-minute `state` bound to agency and agent, offline access, minimal scopes (`calendar.freebusy`, `calendar.events`; no full calendar read), https-only redirect (localhost allowed in development), check that the user granted every needed scope.
- Viewing slots: working hours in agency local time (UAE fixed UTC+4, default Mon–Sat 09:00–19:00), 30-minute slots on the :00/:30 grid, buffer before/after busy times, minimum notice; `checkSlot` re-checks a slot at booking time (conflict, outside hours, too soon).
- Google adapter: token exchange/refresh/revoke (revoked grants flagged as reconnect-required), free/busy that fails closed if Google reports an error, events created with a deterministic id from the viewing id so retries never duplicate, delete of a missing event treated as done. Fake provider for tests.

**Tested**: 23 unit tests.

**Pending**

- Google adapter NOT run against Google (no OAuth client yet).
- API routes (`/calendar/google/connect|callback`, `/availability`, `/viewings`), the `calendar_connection` and `viewing` tables, encrypted token storage and the AI tool handlers come with the wiring PR.

## PR · Platform admin dashboard

- Database: `app_is_platform_admin()` and read-only `platform_admin_read` SELECT policies on `agency`, `membership` and `property`. Visibility needs both an opt-in (`withPlatformAdmin`) and the user's `is_platform_admin` flag, checked by the database itself. There are no write policies, so a platform admin cannot change agency data through this path.
- API: `GET /v1/platform/summary|agencies|users` behind `PlatformAdminGuard` (flag plus two-factor required). `/v1/me` now returns `isPlatformAdmin`, and platform admins must use two-factor.
- Web: `/app/admin` platform dashboard showing agency, user and listing counts, an agencies table and recent sign-ups. Platform admins land there after sign-in, and the agency dashboard stays reachable.
- Tests: 4 db tests (visibility, no flag, no opt-in, read-only), 1 API test, 1 Playwright flow.
- The flag is set only directly in the database; there is no API to grant it.

## PR · Platform admin controls

- Database (`20261121006000_platform_controls`): agency `approval_status`, `status_reason`, `plan`, `seat_limit`, `listing_limit`, `reviewed_at/by`; user `suspended_at/suspended_reason`; append-only `platform_audit_log`; platform settings stored as feature flags `platform.require_agency_approval` (off), `platform.allow_signups` (on), `voice.outbound_calls` (off).
- API (all behind `PlatformAdminGuard`, i.e. platform admin flag plus two-factor): approve/reject an agency, suspend/reactivate an agency (reason required), set plan, seat and listing limits, suspend/reactivate a user (signs them out everywhere; cannot suspend yourself), list and change settings, read the admin activity log. Every action writes the platform audit log and, for agencies, the agency's own audit log with actor type `platform`.
- Enforcement: suspended users cannot sign in or refresh (`ACCOUNT_SUSPENDED`); closed sign-ups return `SIGNUPS_CLOSED`; with approval on, finished onboarding waits in the queue and listings cannot be published until approved; seat limit counts members plus live invites, listing limit counts non-deleted listings (`PLAN_LIMIT_REACHED`).
- Web: `/app/admin` tabs (Overview with approval queue, Agencies, Users, Settings, Activity) with inline reason forms. Agencies see "waiting for approval" on the dashboard, and a suspended/rejected notice with the reason instead of their pages.
- Tests: 5 new API tests, 1 extended Playwright flow (turn approval on, new agency waits, approve, suspend with reason, owner sees notice, activity log).
- Plans are free-text labels for now; billing and plan catalogue come in Phase 3.

## PR · CRM: contacts, leads and consent (Phase 1)

- Database (`20261121010000_crm`): `contact` (phone in E.164, unique per agency; must have a phone or email; `do_not_contact`), append-only `consent_record` (channel × purpose, granted/withdrawn, how it was captured), `lead` (intent, stage, budget/bedroom ranges with checks, follow-up date, optional listing), append-only `lead_activity` timeline. All tenant-isolated with forced RLS and composite `(id, tenant_id)` foreign keys.
- API: `/v1/contacts` (list/search, create with consent given at capture, update, erase for managers), `/v1/contacts/:id/consents`, `/v1/leads` (list/board filters, create, update, `stage`, `assign` for managers, `notes`, delete for managers), `/v1/crm/summary`. Agents see only their own contacts and the leads assigned to them; managers, admins and owners see everything. Duplicate checks do not reveal other agents' contacts.
- Consent: `mayContact(tx, contactId, channel, purpose)` in `apps/api/src/crm/consent.ts` is the check every outbound message must pass. It fails closed (no record, withdrawn or do-not-contact all mean no).
- Web: Contacts list with add form (consent ticks plus "how did they agree"), contact page (consent grid with history, record/withdraw, leads, erase), Leads board by stage, lead page (stage changes, lost reason, follow-up, assignment, notes timeline), dashboard lead counts.
- Tests: 7 db tests, 10 API tests, 1 Playwright flow.
- Not yet: bulk import, matching leads to listings, WhatsApp/portal leads flowing in automatically (Phase 2 and portal threads will use these tables).

## Phase 2 · PR 4 · WhatsApp in the app: webhook, inbox, agent replies, opt-out (2026-11-21)

**Built**

- Migration `20261121030000_whatsapp`: `whatsapp_account` (per-agency number, token AES-256-GCM encrypted bound to the account id, globally unique `phone_number_id`), `conversation` (one per number + contact, AI/human mode, 24-hour window start, unread count, AI state), `message` (unique `wamid` per agency for idempotency; inbound must be authored by the client). RLS forced on all three; the app role cannot delete messages or accounts. Webhook routing can read only the one account row matching `phone_number_id`, and only its routing fields.
- `POST /v1/webhooks/whatsapp`: HMAC check over the raw body, then stores messages in the right agency: finds or creates the contact by phone (source `whatsapp`), the conversation and the message. Meta retries are no-ops. Status webhooks move a message forward only (sent → delivered → read, or failed). `GET` verify handshake.
- Consent from WhatsApp: a client who writes first consents to service replies; STOP / إلغاء etc. withdraws WhatsApp consent (service and marketing) at once, switches the conversation to human and is audited; only START restores it.
- Inbox API: `GET /v1/conversations` (agents see their assigned/owned conversations, managers all), `GET /v1/conversations/:id/messages` (clears unread), `POST /v1/conversations/:id/messages` (agent reply: consent via `mayContact`, 24-hour window, takes over from AI, token decrypted only for the send, network call outside the DB transaction), `takeover` / `release-to-ai` (release refused for opted-out clients).
- Numbers: `GET/POST /v1/whatsapp/accounts`, `POST /v1/whatsapp/accounts/:id/disconnect` (owner/admin only). Connect runs the Embedded Signup code exchange server-side; one number can belong to only one agency.
- Config: `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_GRAPH_VERSION`, `WHATSAPP_PROVIDER`. Fake provider only in development/test (refused in staging/production); without Meta credentials the WhatsApp endpoints answer `INTEGRATION_NOT_CONFIGURED`.

**Tested** (real Postgres): 10 API end-to-end tests (handshake, bad signatures, idempotent storage, contact/conversation/consent creation, unknown numbers, per-agency routing and cross-agency 404, STOP/START consent flow, agent send with tenant token and encrypted storage, status ordering, 24-hour window, agent visibility and admin-only number management, duplicate numbers, disconnect) and 6 database isolation tests for the new tables. Config test for provider selection.

**Pending**

- Real Meta delivery not tested (no Meta app yet). Media download/virus scan, templates outside the window, and a web inbox screen are not built.
- Webhook processing is inline (database only, no AI call). The AI reply step and queue come next.
- Staging needs this migration applied before WhatsApp routes are used.

## PR · Super admin works inside every agency, plus PropForce Direct

- A platform admin (flag plus two-factor, not suspended) can open any agency, including suspended ones, and work there with admin rights: listings, leads, contacts, team. They are not added as a member, and the request context has `membershipId: null` and `platform: true`. Agent-only scopes use `ownMembershipId(ctx)`, which refuses rather than widening.
- Every change made that way is written to the agency's audit log with actor type `platform` and to the platform audit log as `agency_data.<action>`.
- PropForce Direct (`20261121040000_platform_direct`, `agency.is_platform_owned`, at most one): the platform's own agency, created on first use by `POST /v1/platform/direct`. The admin becomes its owner, so their listings are assigned to them and can appear on the portal.
- `GET /v1/platform/listings`: every agency's listings in one table.
- Web: the admin overview has "Add listing" and "Open PropForce Direct". The Agencies tab has "Open agency (view & edit)", and there is a new All listings tab. Inside an agency, a banner shows that the admin is viewing it as platform admin and links back.
- Tests: 3 API tests, extended Playwright admin flow.

## PR · Rich platform admin dashboard

- Layout: a sidebar like the agency app's (Overview, Agencies, All listings, Users, Settings, Activity). The "My agency dashboard" link is gone.
- Overview:
  - Quick actions: Add listing, Open PropForce Direct, Manage agencies, Find a user, Review approvals.
  - Six headline numbers, including open leads and new portal enquiries.
  - Daily charts of new agencies, users, listings, leads and portal enquiries over 7, 30 or 90 UAE days, each with a hover tooltip and a screen-reader table.
  - Most active agencies, a recent activity feed, and the approval queue.
- Roadmap in the menu: every feature from the four phases. Each is marked Live (portal), Needs setup (WhatsApp, AI assistant) or Soon, and the Soon items are disabled and show no data.
- API: `GET /v1/platform/dashboard?days=`. Migration `20261121060000_platform_stats` adds read-only `platform_admin_read` policies on `lead` and `portal_enquiry` (same opt-in plus flag gate as the other platform reads).
- Tests: 1 API test, extended Playwright admin flow.

## PR · Listing photos with the agency logo as a watermark

- `packages/media` (sharp/libvips): detects the real file type from its bytes (JPEG, PNG, WebP, HEIC; SVG and anything else refused), limits size (15 MB) and pixels (50 MP), turns photos upright, strips all metadata including GPS, and refuses photos under 400 px.
- Each photo is stored three ways (`20261121070000_listing_media`, table `property_photo`): a clean JPEG original (at most 2560 px, private to the agency), a 1600 px WebP display copy and a 480 px WebP thumbnail. Both copies carry the watermark: the agency's logo as a faint white mark with a soft shadow, centred, about 40% of the shorter side. Agencies without a logo, including PropForce Direct, get the PropForce mark.
- Agency logo (`agency_logo`): owners and admins upload it on the Property portal page. Saving or removing it re-renders every photo's watermark and bumps its `version`, so cached URLs change. This runs inline, one photo per transaction; it moves to a background job when workers are deployed.
- API:
  - `GET|POST /v1/properties/:id/photos`, `PUT …/photos/order`, `DELETE …/photos/:photoId`, `GET …/photos/:photoId/display|thumb|original`. Uploads are the raw image bytes with an image Content-Type. Agents can change photos only on listings assigned to them. At most 30 photos per listing, and the same photo can't be added twice.
  - `GET|PUT|DELETE /v1/agency/logo`.
  - Public: `GET /v1/public/listing-photos/:photoId/display|thumb?v=<version>`. It serves only watermarked copies of listings the portal can show, cached for a year. The original is never served publicly.
  - Portal payloads: cards carry `photos` (the cover only) and `photoCount`; the detail view carries all `photos` in order (`{id, version, width, height}`).
- RLS: tenant isolation on both tables. Public read of `property_photo` only where the listing itself is public (EXISTS on `property` under its portal policy). Platform admin read-only.
- Web: a Photos card on the listing page (add several at once, cover badge, move, remove). The browser shrinks photos over 4 MB before upload, because Vercel caps request bodies at 4.5 MB. The logo card is on the Property portal page. Listing photos is marked Live in the admin roadmap.
- Tests: 4 media unit tests, 3 DB isolation tests, 5 API tests (watermark present, EXIF/GPS gone, original not public, hidden listings, cross-agency, bad files, duplicates, order, logo re-marking), and an extended Playwright listing flow.

**Pending**: photos are stored in Postgres for staging; move to S3 (private bucket plus CDN) before launch. Virus scanning isn't needed for re-encoded images, but the HEIC decode path depends on the libheif build in sharp's prebuilt binaries. The portal site still needs to render `photos` (portal thread).

## PR · Permit documents, unpublish, delete, and hiding listings when the permit expires

- Permits: the number is now optional. An agency can upload the permit itself instead: a PDF, kept as is, or a photo or scan, re-encoded as JPEG with metadata removed. Each permit has an expiry date. Migration `20261121080000_permit_documents` adds `property_permit_document`, which is tenant-only with no public policy, so the portal can never read it. A listing can be published once it has an unexpired permit with either its number or its document.
- Renew: `PATCH /v1/properties/:id/permits/:permitId` sets a new expiry date and number, and a new document can be uploaded with it. The document is uploaded with `PUT …/permits/:permitId/document?fileName=` (raw body) and downloaded with `GET` (as an attachment, sandboxed).
- When the permit expires, the listing leaves the portal automatically. The existing portal RLS policy only shows listings with a permit valid today, and this PR adds a test for it. The listing page explains why a published listing isn't showing ("permit has expired, renew below").
- Unpublish: live or under-offer listings can go back to draft, which takes them off the portal; they can be published again.
- Delete: managers can delete any listing, live ones included, behind a confirm step. It is a soft delete and the listing leaves the portal at once. Agents can delete only their own drafts.
- Tests: 1 media test, 1 DB test (document private from the portal and from other agencies), 3 new or updated API tests, and the Playwright listing flow (permit by document only, unpublish, republish).
