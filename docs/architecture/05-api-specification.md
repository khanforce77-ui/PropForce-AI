# 05 · API Specification

**Version:** 0.1 · **Date:** 2026-11-20 · REST/JSON · OpenAPI 3.1 generated from NestJS decorators (`/api/docs`, `/api/openapi.json`)

This document fixes the contract conventions and the endpoint inventory. Request/response schemas are defined once in `packages/contracts` (zod) and exported to OpenAPI; this doc shows representative shapes.

## 1. Conventions

| Topic | Rule |
|---|---|
| Base URL | `https://api.<domain>/v1` |
| Auth | `Authorization: Bearer <access JWT>`; refresh via httpOnly cookie at `/v1/auth/refresh` |
| Tenant | `X-Tenant-Id: <agency uuid>` required on all tenant routes; must match a membership of the caller |
| IDs | UUID strings |
| Pagination | Cursor: `?limit=25&cursor=<opaque>` → `{ data: [], nextCursor: string \| null }` |
| Filtering/sorting | `?filter[status]=active&sort=-createdAt` |
| Idempotency | `Idempotency-Key` header on POST that create resources or trigger sends; stored 24 h |
| Errors | RFC 9457 Problem Details: `{ type, title, status, detail, code, errors?: [{ path, message }] , requestId }` |
| Rate limits | `429` with `Retry-After`; headers `RateLimit-Limit`, `RateLimit-Remaining` |
| Money | `{ amount: "1850000.00", currency: "AED" }` (string decimals) |
| Dates | ISO 8601 UTC; UI renders in Asia/Dubai by default |
| Versioning | URI major version; additive changes only within v1 |

### Error codes (selection)

`AUTH_INVALID_CREDENTIALS`, `AUTH_MFA_REQUIRED`, `AUTH_EMAIL_UNVERIFIED`, `TENANT_FORBIDDEN`, `TENANT_SUSPENDED`, `PERMISSION_DENIED`, `VALIDATION_FAILED`, `NOT_FOUND`, `CONFLICT_DUPLICATE`, `PLAN_LIMIT_REACHED`, `SPEND_CAP_REACHED`, `CONSENT_MISSING`, `WA_WINDOW_CLOSED`, `APPROVAL_REQUIRED`, `INTEGRATION_NOT_CONFIGURED`.

## 2. Auth and tenancy

| Method | Path | Description | Permission |
|---|---|---|---|
| POST | `/auth/register` | Create user + agency (Owner) | public |
| POST | `/auth/verify-email` | `{ token }` | public |
| POST | `/auth/resend-verification` | | public (rate-limited) |
| POST | `/auth/login` | `{ email, password }` → tokens or `{ mfaRequired, mfaToken }` | public |
| POST | `/auth/mfa/verify` | `{ mfaToken, code }` | public |
| POST | `/auth/refresh` | rotate refresh token | cookie |
| POST | `/auth/logout` | revoke session | auth |
| POST | `/auth/password/forgot` | | public |
| POST | `/auth/password/reset` | `{ token, newPassword }` | public |
| GET | `/me` | user + memberships | auth |
| GET/DELETE | `/me/sessions[/:id]` | list / revoke | auth |
| POST | `/me/mfa/totp/setup` → `/me/mfa/totp/confirm` | enroll TOTP, returns recovery codes once | auth |
| GET/PATCH | `/agency` | current agency profile | `agency:read` / `agency:write` |
| GET/PATCH | `/agency/settings` | branding, AI settings, freshness, retention | `agency:settings` |
| GET | `/members` | list | `member:read` |
| PATCH | `/members/:id` | role, team | `member:write` |
| POST | `/members/:id/suspend` · `/reactivate` | | `member:suspend` |
| POST | `/invitations` | `{ email, role, teamId? }` | `member:invite` |
| GET/DELETE | `/invitations[/:id]` | | `member:invite` |
| POST | `/invitations/accept` | `{ token, password?, fullName? }` | public |
| CRUD | `/teams` | | `team:write` |
| GET | `/audit-logs` | filters: actor, entity, action, date | `audit:read` |

**Register request**

```json
{
  "fullName": "Sara Ahmed",
  "email": "sara@example.ae",
  "password": "********",
  "agency": { "name": "Marina Homes Real Estate", "emirate": "Dubai" },
  "acceptTerms": true
}
```

## 3. Inventory

| Method | Path | Description | Permission |
|---|---|---|---|
| GET | `/properties` | filters: status, listingType, propertyType, emirate, community, bedsMin/Max, priceMin/Max, assignedTo, q | `property:read` |
| POST | `/properties` | create | `property:write` |
| GET/PATCH/DELETE | `/properties/:id` | | `property:read` / `property:write` (agents: assigned only) |
| POST | `/properties/:id/verify` | stamp `verifiedAt` | `property:verify` |
| POST | `/properties/:id/status` | `{ status, reason? }` | `property:write` |
| POST | `/properties/:id/media/upload-url` | returns presigned PUT, creates pending media | `property:write` |
| POST | `/properties/:id/media/:mediaId/complete` | triggers scan | `property:write` |
| GET | `/properties/:id/media` | returns signed GET URLs (5 min) for clean media only | `property:read` |
| CRUD | `/projects` | off-plan projects | `property:write` |
| POST | `/imports` | `{ kind: "properties" \| "contacts", fileKey }` | `import:run` |
| POST | `/imports/:id/mapping` | column mapping → validation job | `import:run` |
| GET | `/imports/:id` · `/imports/:id/rows?filter[hasErrors]=true` | preview | `import:run` |
| POST | `/imports/:id/commit` | | `import:run` |
| POST | `/imports/:id/rollback` | within 7 days, if untouched rows | `import:rollback` |

**Property (response, abridged)**

```json
{
  "id": "0193...",
  "reference": "MH-S-00412",
  "listingType": "sale",
  "propertyType": "apartment",
  "completion": "ready",
  "status": "active",
  "location": { "emirate": "Dubai", "community": "Dubai Marina", "building": "Marina Gate 1", "unitNo": "2304" },
  "bedrooms": 2, "bathrooms": 3, "areaSqft": "1245.00",
  "price": { "amount": "2850000.00", "currency": "AED" },
  "furnishing": "unfurnished",
  "amenities": ["pool", "gym", "concierge"],
  "view": "Sea", "parking": 1, "floor": 23,
  "permits": [{ "authority": "DLD/RERA", "permitNumber": "XXXXXXXX", "validUntil": "2027-03-01" }],
  "assignedAgent": { "id": "...", "name": "Omar K." },
  "verifiedAt": "2026-11-18T09:12:00Z",
  "listingExpiresAt": "2027-02-18"
}
```

## 4. CRM

| Method | Path | Description | Permission |
|---|---|---|---|
| GET/POST | `/contacts` | dedupe check on create returns `409 CONFLICT_DUPLICATE` with candidate ids unless `force=true` | `contact:read/write` |
| GET/PATCH/DELETE | `/contacts/:id` | | |
| POST | `/contacts/:id/merge` | `{ sourceContactIds[] }` | `contact:merge` |
| GET | `/contacts/duplicates` | candidate pairs | `contact:merge` |
| GET/POST | `/contacts/:id/consents` | record consent with source + evidence | `consent:write` |
| POST | `/contacts/:id/opt-out` | `{ channel, purpose? }` | `consent:write` |
| CRUD | `/suppressions` | | `suppression:write` |
| GET/POST | `/leads` | filters: stage, assignedTo, source, scoreMin, tag | `lead:read/write` |
| GET/PATCH | `/leads/:id` | | |
| POST | `/leads/:id/assign` | `{ membershipId, reason }` | `lead:assign` |
| POST | `/leads/:id/stage` | `{ stage, lostReason? }` | `lead:write` |
| GET/POST | `/leads/:id/requirements` · PATCH/DELETE `/requirements/:id` | | `lead:write` |
| GET | `/requirements/:id/matches` | run/return matches | `match:read` |
| POST | `/matches/:id/feedback` | `{ feedback }` | `lead:write` |
| CRUD | `/leads/:id/notes`, `/tasks`, `/tags` | | |
| GET | `/leads/:id/timeline` | messages, notes, viewings, stage changes | `lead:read` |
| CRUD | `/assignment-rules` | | `lead:assign` |

**Match response**

```json
{
  "requirementId": "...",
  "generatedAt": "2026-11-20T16:00:00Z",
  "filtersApplied": { "listingType": "sale", "emirate": ["Dubai"], "budgetMax": "3000000.00", "status": "active", "freshWithinDays": 14 },
  "data": [
    {
      "propertyId": "...", "reference": "MH-S-00412", "score": 87,
      "components": { "location": 30, "price": 22, "bedrooms": 15, "semantic": 12, "other": 8 },
      "reasons": [
        "Within budget: AED 2.85M vs max AED 3.0M",
        "In preferred community: Dubai Marina",
        "2 bedrooms matches requirement",
        "Sea view matches 'sea view' preference (semantic 0.84)"
      ]
    }
  ]
}
```

## 5. Conversations and WhatsApp

| Method | Path | Description | Permission |
|---|---|---|---|
| GET | `/webhooks/whatsapp` | Meta verify (`hub.mode`, `hub.verify_token`, `hub.challenge`) | public |
| POST | `/webhooks/whatsapp` | signed events; always 200 after enqueue | signature |
| CRUD | `/whatsapp/accounts` | connect WABA (credentials encrypted) | `integration:manage` |
| POST | `/whatsapp/templates/sync` | pull template statuses | `integration:manage` |
| GET | `/conversations` | inbox filters: mode, assignedTo, unread | `conversation:read` |
| GET | `/conversations/:id/messages` | | `conversation:read` |
| POST | `/conversations/:id/messages` | agent send; free text inside 24h window else `templateId` required | `conversation:reply` |
| POST | `/conversations/:id/takeover` · `/release-to-ai` | | `conversation:takeover` |
| POST | `/conversations/:id/assign` | | `lead:assign` |
| GET | `/conversations/:id/summary` | | `conversation:read` |
| GET | `/realtime` | SSE stream of tenant-scoped inbox events | auth |

## 6. Calendar, viewings, deals, fees

| Method | Path | Description | Permission |
|---|---|---|---|
| GET | `/calendar/google/connect` → `/calendar/google/callback` | OAuth with PKCE + state | self |
| DELETE | `/calendar/connections/:id` | revoke | self |
| GET | `/availability?agentId&from&to` | free/busy | `viewing:read` |
| GET/POST | `/viewings` | POST checks conflicts, creates event if authorized | `viewing:write` |
| POST | `/viewings/:id/confirm` · `/reschedule` · `/cancel` · `/complete` | | `viewing:write` |
| POST | `/viewings/:id/feedback` | | `viewing:write` |
| GET/POST | `/deals` | `pipeline=sales\|rental` | `deal:read/write` |
| POST | `/deals/:id/stage` | stages beyond "offer accepted" require `deal:advance` | |
| CRUD | `/deals/:id/milestones`, `/documents`, `/commissions` | | |
| POST | `/deals/:id/documents/:docId/versions` · `/approve` | | `document:approve` |
| GET/POST | `/fee-schedules` | tenant overrides; platform templates read-only | `fees:manage` |
| POST | `/fee-calculations` | `{ transactionType, emirate, price, mortgageAmount?, ... }` | `fees:calculate` |

**Fee calculation response**

```json
{
  "isEstimate": true,
  "schedule": { "id": "...", "version": 3, "emirate": "Dubai", "verifiedAt": "2026-11-01", "verifiedBy": "Agency Admin", "sourceUrl": "https://..." },
  "lines": [
    { "code": "dld_transfer", "label": "DLD transfer fee", "payer": "buyer", "amount": "…" },
    { "code": "broker_commission", "label": "Broker commission", "payer": "buyer", "amount": "…" },
    { "code": "vat", "label": "VAT on commission", "payer": "buyer", "amount": "…" }
  ],
  "total": { "amount": "…", "currency": "AED" },
  "disclaimer": "Estimate only, based on fee schedule v3 verified 2026-11-01. Confirm with the relevant authority before relying on these figures."
}
```

If the schedule is unverified (`is_sample`), the response sets `"verificationStatus": "unverified"` and the UI shows a warning banner.

## 7. Lead Booster, voice, billing, marketing, admin

| Area | Endpoints |
|---|---|
| Campaigns | `POST /campaigns`, `POST /campaigns/:id/preview` (counts: eligible, no consent, suppressed), `POST /campaigns/:id/submit`, `POST /campaigns/:id/approve` (`campaign:approve`, cannot be the creator), `POST /campaigns/:id/pause`, `GET /campaigns/:id/recipients` |
| Voice | `POST /webhooks/voice/:provider`, `GET /calls`, `GET /calls/:id`, `GET/PATCH /voice/compliance` (outbound flag writable only by SA) |
| Billing | `GET /billing/subscription`, `POST /billing/checkout`, `POST /billing/portal`, `GET /billing/usage`, `GET /billing/invoices`, `PUT /billing/spending-caps`, `POST /webhooks/billing/:provider` |
| Marketing | `POST /marketing/brochures`, `POST /marketing/captions`, `CRUD /marketing/landing-pages`, `POST /public/landing/:slug/leads` (consent checkbox required, captcha) |
| Ads | `POST /webhooks/meta-leads`, `POST /webhooks/google-leads` |
| Admin (`/admin/*`, platform role) | `GET /admin/agencies`, `POST /admin/agencies/:id/suspend`, `GET /admin/metrics`, `GET /admin/queues`, `POST /admin/queues/:q/dlq/:jobId/replay`, `CRUD /admin/feature-flags`, `GET /admin/security-events`, `POST /admin/agencies/:id/voice-outbound-approval`, `CRUD /admin/support-tickets`, `POST /admin/impersonations` |

## 8. AI tool contracts

All tools: the orchestrator injects `tenantId`, `actingPrincipal`, `conversationId`; the model never supplies them. Each call goes through the Tool Gateway (authN → tenant → permission → schema → business rules → rate limit → audit).

| Tool | Input (zod summary) | Output | Sensitivity |
|---|---|---|---|
| `search_properties` | `{ listingType, emirate?, communities?[], propertyTypes?[], bedsMin?, bedsMax?, budgetMax?, completion?, limit≤10 }` | `[{ id, reference, title, price, beds, areaSqft, community, status }]` active + fresh only | read |
| `get_property_details` | `{ propertyId \| reference }` | facts + clean brochure media ids | read |
| `create_lead` | `{ intent, name?, language? }` (contact from conversation) | `{ leadId }` | write-low |
| `update_lead_requirement` | `{ requirementId?, fields: Partial<Requirement> }` | `{ requirementId }` | write-low |
| `get_client_history` | `{ }` | summary, prior requirements, viewings | read |
| `suggest_property_matches` | `{ requirementId, limit≤5 }` | match response (§4) | read |
| `check_agent_availability` | `{ propertyId, from, to }` | `[slots]` for assigned agent | read |
| `request_viewing_booking` | `{ propertyId, slotStart, notes? }` | `{ viewingId, status: requested\|confirmed }` — `confirmed` only if agent enabled auto-confirm | **sensitive** (approval unless pre-authorized) |
| `create_followup_task` | `{ title, dueAt, assignee: "assigned_agent" }` | `{ taskId }` | write-low |
| `calculate_property_costs` | `{ transactionType, price, mortgageAmount? }` | fee response (§6) with `isEstimate` | read |
| `notify_assigned_agent` | `{ reason, urgency }` | `{ notified }` | write-low, rate-limited |
| `request_human_handover` | `{ reason, summary }` | `{ handedOver: true }` sets mode=human | always allowed |

Explicitly **not** exposed to the AI: sending outbound templates to other contacts, changing deal stages, editing prices or listing status, deleting anything, reading other conversations, any admin endpoint.

## 9. Webhook security

| Provider | Verification |
|---|---|
| Meta WhatsApp / Lead Ads | HMAC-SHA256 of raw body with app secret vs `X-Hub-Signature-256`, constant-time compare |
| Billing (e.g. Stripe) | Provider signature header + timestamp tolerance (5 min) |
| Voice provider | Provider secret/signature; IP allowlist where offered |
| Google Calendar push | Channel token check + resource id match |

All webhooks: raw body preserved, 1 MB size limit, `webhook_event` uniqueness for idempotency, enqueue then 200.
