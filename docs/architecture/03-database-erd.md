# 03 · Database ERD

**Version:** 0.1 · **Date:** 2026-11-20 · PostgreSQL 16 + pgvector · Prisma ORM

## Conventions

- Primary keys: `id uuid` (UUIDv7). Every tenant-owned table has `tenant_id uuid not null` → `agency.id`, with RLS policy `tenant_id = current_setting('app.tenant_id')::uuid`.
- Timestamps: `created_at`, `updated_at` (timestamptz). Soft delete `deleted_at` where noted.
- Money: `numeric(14,2)` plus `currency char(3)` default `AED`. Never floats.
- Phones: stored E.164 in `phone_e164`; raw input kept in `phone_raw`.
- Enum-like values use Postgres enums via Prisma.
- Platform-level tables (no `tenant_id`, no RLS for app role, accessed only by platform role): `user`, `plan`, `feature_flag`, `platform_admin`, `webhook_event` (has nullable tenant_id), `security_event`.

The diagram is split into domains for readability. The full set of tables is listed in §7.

## 1. Identity, tenancy and billing

```mermaid
erDiagram
  USER ||--o{ MEMBERSHIP : has
  AGENCY ||--o{ MEMBERSHIP : has
  AGENCY ||--o{ INVITATION : issues
  USER ||--o{ SESSION : has
  USER ||--o{ MFA_FACTOR : has
  AGENCY ||--o{ TEAM : has
  TEAM ||--o{ MEMBERSHIP : groups
  AGENCY ||--o{ AUDIT_LOG : records
  AGENCY ||--|| AGENCY_SETTINGS : has
  AGENCY ||--o| SUBSCRIPTION : has
  PLAN ||--o{ SUBSCRIPTION : defines
  AGENCY ||--o{ USAGE_RECORD : accrues
  AGENCY ||--o{ INVOICE : billed
  AGENCY ||--o{ SPENDING_CAP : sets

  USER {
    uuid id PK
    citext email UK
    text password_hash
    timestamptz email_verified_at
    text full_name
    text locale
    bool is_platform_admin
    timestamptz last_login_at
  }
  AGENCY {
    uuid id PK
    text name
    text slug UK
    text trade_license_no
    text orn "RERA ORN, optional"
    text emirate
    enum status "pending|active|suspended|cancelled"
    timestamptz onboarded_at
  }
  MEMBERSHIP {
    uuid id PK
    uuid tenant_id FK
    uuid user_id FK
    uuid team_id FK
    enum role "owner|admin|manager|agent"
    enum status "active|suspended|removed"
    text brn "broker reg no, optional"
  }
  INVITATION {
    uuid id PK
    uuid tenant_id FK
    citext email
    enum role
    text token_hash
    timestamptz expires_at
    timestamptz accepted_at
    uuid invited_by FK
  }
  SESSION {
    uuid id PK
    uuid user_id FK
    text refresh_token_hash
    text ip
    text user_agent
    timestamptz expires_at
    timestamptz revoked_at
  }
  MFA_FACTOR {
    uuid id PK
    uuid user_id FK
    enum type "totp|recovery"
    bytea secret_encrypted
    timestamptz verified_at
  }
  TEAM {
    uuid id PK
    uuid tenant_id FK
    text name
    uuid manager_membership_id FK
  }
  AUDIT_LOG {
    uuid id PK
    uuid tenant_id FK
    uuid actor_user_id
    enum actor_type "user|ai|system|platform"
    text action
    text entity_type
    uuid entity_id
    jsonb before
    jsonb after
    text ip
    timestamptz created_at
  }
  AGENCY_SETTINGS {
    uuid tenant_id PK
    jsonb branding
    jsonb ai_settings
    int listing_freshness_days
    bool outbound_voice_enabled "default false"
    jsonb retention_policy
  }
  PLAN {
    uuid id PK
    text code "starter|professional|agency|enterprise"
    int seat_limit
    jsonb included_usage
    numeric price_monthly
  }
  SUBSCRIPTION {
    uuid id PK
    uuid tenant_id FK
    uuid plan_id FK
    enum status "trialing|active|past_due|cancelled"
    text provider_customer_id
    text provider_subscription_id
    int seats
    timestamptz current_period_end
  }
  USAGE_RECORD {
    uuid id PK
    uuid tenant_id FK
    enum meter "ai_tokens|wa_conversation|voice_minute|storage_gb"
    numeric quantity
    numeric unit_cost
    text source_ref
    timestamptz occurred_at
  }
  INVOICE {
    uuid id PK
    uuid tenant_id FK
    text provider_invoice_id
    numeric amount
    numeric vat_amount
    enum status
  }
  SPENDING_CAP {
    uuid id PK
    uuid tenant_id FK
    enum meter
    numeric monthly_limit
    enum action "warn|block"
  }
```

## 2. Inventory

```mermaid
erDiagram
  AGENCY ||--o{ PROPERTY : owns
  PROJECT ||--o{ PROPERTY : contains
  PROPERTY ||--o{ PROPERTY_MEDIA : has
  PROPERTY ||--o| PROPERTY_EMBEDDING : has
  PROPERTY }o--|| MEMBERSHIP : assigned_agent
  PROPERTY }o--o| CONTACT : owner_contact
  PROPERTY ||--o{ PROPERTY_PERMIT : has
  AGENCY ||--o{ IMPORT_BATCH : runs
  IMPORT_BATCH ||--o{ IMPORT_ROW : contains
  IMPORT_ROW }o--o| PROPERTY : created

  PROJECT {
    uuid id PK
    uuid tenant_id FK
    text name
    text developer
    text emirate
    text community
    date handover_date
    jsonb payment_plan
  }
  PROPERTY {
    uuid id PK
    uuid tenant_id FK
    text reference UK "per tenant"
    enum listing_type "sale|rent"
    enum property_type "apartment|villa|townhouse|penthouse|office|retail|commercial|land|other"
    enum completion "ready|off_plan"
    enum status "draft|active|under_offer|sold|rented|archived"
    uuid project_id FK
    uuid assigned_membership_id FK
    uuid owner_contact_id FK
    text emirate
    text community
    text sub_community
    text building
    text unit_no
    int bedrooms "0 = studio"
    numeric bathrooms
    numeric area_sqft
    numeric price
    text price_period "for rent: yearly|monthly"
    enum furnishing
    text_arr amenities
    int parking
    int floor
    text view
    text developer
    date handover_date
    jsonb payment_plan
    numeric service_charge_per_sqft
    date listing_expires_at
    timestamptz verified_at
    uuid verified_by
    geography location
    text description
    timestamptz deleted_at
  }
  PROPERTY_PERMIT {
    uuid id PK
    uuid tenant_id FK
    uuid property_id FK
    text authority "e.g. DLD/RERA, ADREC"
    text permit_number
    date valid_until
    text source_document_key
  }
  PROPERTY_MEDIA {
    uuid id PK
    uuid tenant_id FK
    uuid property_id FK
    enum kind "image|video|brochure|floor_plan"
    text storage_key
    text mime
    bigint size_bytes
    enum scan_status "pending|clean|infected|failed"
    int sort_order
  }
  PROPERTY_EMBEDDING {
    uuid property_id PK
    uuid tenant_id FK
    vector embedding "1536 dims"
    text model
    text content_hash
  }
  IMPORT_BATCH {
    uuid id PK
    uuid tenant_id FK
    enum kind "properties|contacts"
    text file_key
    jsonb column_mapping
    enum status "uploaded|validated|committed|rolled_back|failed"
    int total_rows
    int error_rows
    int duplicate_rows
    uuid created_by
  }
  IMPORT_ROW {
    uuid id PK
    uuid tenant_id FK
    uuid batch_id FK
    int row_number
    jsonb raw
    jsonb errors
    uuid duplicate_of
    uuid created_entity_id
  }
```

## 3. CRM, consent and campaigns

```mermaid
erDiagram
  CONTACT ||--o{ LEAD : has
  CONTACT ||--o{ CONSENT_RECORD : grants
  CONTACT ||--o{ CONTACT_IDENTITY : has
  LEAD ||--o{ REQUIREMENT : has
  LEAD }o--o| MEMBERSHIP : assigned_to
  LEAD ||--o{ TASK : has
  LEAD ||--o{ NOTE : has
  LEAD ||--o{ LEAD_ASSIGNMENT_HISTORY : has
  LEAD }o--o{ TAG : tagged
  LEAD_SOURCE ||--o{ LEAD : origin
  REQUIREMENT ||--o{ MATCH_RESULT : produces
  MATCH_RESULT }o--|| PROPERTY : suggests
  AGENCY ||--o{ SUPPRESSION_ENTRY : maintains
  CAMPAIGN ||--o{ CAMPAIGN_RECIPIENT : targets
  CAMPAIGN_RECIPIENT }o--|| CONTACT : is
  CAMPAIGN }o--|| MESSAGE_TEMPLATE : uses

  CONTACT {
    uuid id PK
    uuid tenant_id FK
    text full_name
    text phone_e164
    text phone_raw
    citext email
    text nationality
    text language
    enum type "buyer|seller|tenant|landlord|investor|other"
    uuid merged_into_id
    timestamptz deleted_at
  }
  CONTACT_IDENTITY {
    uuid id PK
    uuid tenant_id FK
    uuid contact_id FK
    enum channel "whatsapp|phone|email"
    text value UK "per tenant+channel"
  }
  CONSENT_RECORD {
    uuid id PK
    uuid tenant_id FK
    uuid contact_id FK
    enum channel "whatsapp|sms|voice|email"
    enum purpose "service|marketing"
    enum status "granted|revoked"
    text source "inbound_message|form|import_attested|verbal"
    text evidence_ref
    timestamptz captured_at
    timestamptz revoked_at
  }
  SUPPRESSION_ENTRY {
    uuid id PK
    uuid tenant_id FK
    enum channel
    text value
    text reason
  }
  LEAD {
    uuid id PK
    uuid tenant_id FK
    uuid contact_id FK
    uuid source_id FK
    uuid assigned_membership_id FK
    enum intent "buy|sell|rent|let|invest"
    enum stage "new|contacted|qualified|viewing|negotiating|won|lost"
    int score
    jsonb score_factors
    text utm_source
    text utm_campaign
    timestamptz last_activity_at
  }
  LEAD_SOURCE {
    uuid id PK
    uuid tenant_id FK
    text name "whatsapp|portal|meta_ads|google_ads|referral|walk_in|import"
  }
  REQUIREMENT {
    uuid id PK
    uuid tenant_id FK
    uuid lead_id FK
    enum listing_type
    text_arr property_types
    text_arr emirates
    text_arr communities
    int beds_min
    int beds_max
    numeric budget_min
    numeric budget_max
    numeric area_min
    enum completion
    enum furnishing
    date move_in_by
    text preferences_text
    vector preferences_embedding
    bool is_active
  }
  MATCH_RESULT {
    uuid id PK
    uuid tenant_id FK
    uuid requirement_id FK
    uuid property_id FK
    numeric score
    jsonb reasons
    enum feedback "none|liked|rejected|viewed"
  }
  TASK {
    uuid id PK
    uuid tenant_id FK
    uuid lead_id FK
    uuid assignee_membership_id FK
    text title
    timestamptz due_at
    enum status
    enum created_by_type "user|ai|system"
  }
  CAMPAIGN {
    uuid id PK
    uuid tenant_id FK
    text name
    enum status "draft|pending_approval|approved|running|paused|completed"
    uuid template_id FK
    jsonb segment_filter
    uuid approved_by
    timestamptz approved_at
    int rate_per_minute
  }
  CAMPAIGN_RECIPIENT {
    uuid id PK
    uuid tenant_id FK
    uuid campaign_id FK
    uuid contact_id FK
    enum status "queued|skipped_no_consent|skipped_suppressed|sent|delivered|read|replied|failed"
    text reply_class
  }
```

## 4. Conversations, AI and voice

```mermaid
erDiagram
  WHATSAPP_ACCOUNT ||--o{ CONVERSATION : hosts
  CONVERSATION ||--o{ MESSAGE : contains
  CONVERSATION }o--|| CONTACT : with
  CONVERSATION }o--o| LEAD : about
  CONVERSATION ||--o{ AI_RUN : triggers
  AI_RUN ||--o{ AI_TOOL_CALL : makes
  AI_RUN }o--|| PROMPT_VERSION : uses
  AI_TOOL_CALL ||--o| APPROVAL_REQUEST : may_need
  WHATSAPP_ACCOUNT ||--o{ MESSAGE_TEMPLATE : has
  VOICE_CALL }o--|| CONTACT : with
  VOICE_CALL ||--o| CALL_TRANSCRIPT : has

  WHATSAPP_ACCOUNT {
    uuid id PK
    uuid tenant_id FK
    text waba_id
    text phone_number_id UK
    text display_phone
    bytea access_token_encrypted
    enum mode "sandbox|live"
    text quality_rating
  }
  CONVERSATION {
    uuid id PK
    uuid tenant_id FK
    enum channel "whatsapp|voice|web"
    uuid contact_id FK
    uuid lead_id FK
    uuid assigned_membership_id FK
    enum mode "ai|human|closed"
    jsonb state
    text summary
    timestamptz service_window_expires_at
  }
  MESSAGE {
    uuid id PK
    uuid tenant_id FK
    uuid conversation_id FK
    enum direction "in|out"
    enum author_type "contact|agent|ai|system"
    text provider_message_id UK
    enum type "text|image|document|audio|video|template|interactive"
    text body
    text media_key
    enum status "received|queued|sent|delivered|read|failed"
    text error_code
  }
  MESSAGE_TEMPLATE {
    uuid id PK
    uuid tenant_id FK
    text name
    text language
    enum category "utility|marketing|authentication"
    enum meta_status "pending|approved|rejected|paused"
    jsonb components
  }
  PROMPT_VERSION {
    uuid id PK
    text key
    int version
    text content
    bool active
  }
  AI_RUN {
    uuid id PK
    uuid tenant_id FK
    uuid conversation_id FK
    uuid prompt_version_id FK
    text model
    int input_tokens
    int output_tokens
    numeric cost_usd
    int latency_ms
    enum outcome "replied|handover|blocked|error"
  }
  AI_TOOL_CALL {
    uuid id PK
    uuid tenant_id FK
    uuid ai_run_id FK
    text tool_name
    jsonb arguments
    jsonb result
    enum decision "executed|denied|needs_approval|error"
    text denial_reason
  }
  APPROVAL_REQUEST {
    uuid id PK
    uuid tenant_id FK
    text action
    jsonb payload
    enum status "pending|approved|rejected|expired"
    uuid decided_by
  }
  VOICE_CALL {
    uuid id PK
    uuid tenant_id FK
    enum direction "inbound|outbound"
    text provider_call_id UK
    uuid contact_id FK
    int duration_s
    numeric cost
    bool recording_consented
    text outcome
    text summary
  }
  CALL_TRANSCRIPT {
    uuid id PK
    uuid tenant_id FK
    uuid call_id FK
    jsonb segments
    timestamptz purge_after
  }
```

## 5. Calendar, deals, fees

```mermaid
erDiagram
  MEMBERSHIP ||--o| CALENDAR_CONNECTION : has
  VIEWING }o--|| PROPERTY : at
  VIEWING }o--|| LEAD : for
  VIEWING }o--|| MEMBERSHIP : agent
  DEAL }o--|| LEAD : from
  DEAL }o--|| PROPERTY : on
  DEAL ||--o{ DEAL_STAGE_HISTORY : logs
  DEAL ||--o{ DEAL_DOCUMENT : has
  DEAL_DOCUMENT ||--o{ DOCUMENT_VERSION : versions
  DEAL ||--o{ DEAL_MILESTONE : has
  DEAL ||--o{ COMMISSION_SPLIT : pays
  FEE_SCHEDULE ||--o{ FEE_RULE : has
  CALCULATION_RECORD }o--|| FEE_SCHEDULE : used

  CALENDAR_CONNECTION {
    uuid id PK
    uuid tenant_id FK
    uuid membership_id FK
    enum provider "google|microsoft"
    text calendar_id
    bytea refresh_token_encrypted
    text scopes
    bool auto_confirm_ai_bookings
    timestamptz revoked_at
  }
  VIEWING {
    uuid id PK
    uuid tenant_id FK
    uuid property_id FK
    uuid lead_id FK
    uuid agent_membership_id FK
    timestamptz starts_at
    timestamptz ends_at
    enum status "requested|confirmed|rescheduled|cancelled|completed|no_show"
    text external_event_id
    jsonb feedback
  }
  DEAL {
    uuid id PK
    uuid tenant_id FK
    enum pipeline "sales|rental"
    text stage
    uuid lead_id FK
    uuid property_id FK
    numeric agreed_price
    numeric commission_pct
    numeric commission_amount
    enum status "open|won|lost"
  }
  DEAL_STAGE_HISTORY {
    uuid id PK
    uuid tenant_id FK
    uuid deal_id FK
    text from_stage
    text to_stage
    uuid changed_by
  }
  DEAL_MILESTONE {
    uuid id PK
    uuid tenant_id FK
    uuid deal_id FK
    text name
    date due_on
    timestamptz completed_at
  }
  DEAL_DOCUMENT {
    uuid id PK
    uuid tenant_id FK
    uuid deal_id FK
    text template_key "e.g. form_f, tenancy_contract"
    enum status "draft|pending_approval|approved|superseded"
  }
  DOCUMENT_VERSION {
    uuid id PK
    uuid tenant_id FK
    uuid document_id FK
    int version
    text storage_key
    uuid created_by
    uuid approved_by
  }
  COMMISSION_SPLIT {
    uuid id PK
    uuid tenant_id FK
    uuid deal_id FK
    uuid membership_id FK
    numeric pct
    numeric amount
    enum status "pending|invoiced|paid"
  }
  FEE_SCHEDULE {
    uuid id PK
    uuid tenant_id "null = platform template"
    text emirate
    enum transaction_type "ready_sale|off_plan|mortgage|rental|commercial"
    int version
    date effective_from
    date effective_to
    text source_url
    uuid verified_by
    timestamptz verified_at
    bool is_sample "true for seed data"
  }
  FEE_RULE {
    uuid id PK
    uuid schedule_id FK
    text code "dld_transfer|trustee|mortgage_reg|noc|broker_commission|vat"
    enum calc "percent|fixed|tiered|percent_of_rule"
    jsonb params
    text payer "buyer|seller|tenant|landlord"
  }
  CALCULATION_RECORD {
    uuid id PK
    uuid tenant_id FK
    uuid schedule_id FK
    jsonb inputs
    jsonb breakdown
    numeric total
  }
```

## 6. Key indexes and constraints

| Table | Index / constraint |
|---|---|
| property | `(tenant_id, status, listing_type, emirate, property_type, bedrooms, price)`; unique `(tenant_id, reference)`; GIN on `amenities`; trigram on `(building, unit_no)` for duplicate detection |
| property_embedding | HNSW `embedding vector_cosine_ops`; `(tenant_id)` |
| contact | unique partial `(tenant_id, phone_e164) where deleted_at is null and merged_into_id is null`; trigram on `full_name` |
| lead | `(tenant_id, assigned_membership_id, stage)`, `(tenant_id, last_activity_at desc)` |
| message | unique `(provider_message_id)`; `(tenant_id, conversation_id, created_at)` |
| consent_record | `(tenant_id, contact_id, channel, purpose, captured_at desc)` |
| webhook_event | unique `(provider, external_id)` |
| usage_record | `(tenant_id, meter, occurred_at)` — consider monthly partitioning |
| audit_log | `(tenant_id, created_at desc)`, `(tenant_id, entity_type, entity_id)` — monthly partitioning |

## 7. Full table list

Platform: `user`, `session`, `mfa_factor`, `plan`, `feature_flag`, `webhook_event`, `security_event`, `support_ticket`, `prompt_version`, `outbox_event`.
Tenant: `agency`, `agency_settings`, `membership`, `team`, `invitation`, `audit_log`, `subscription`, `usage_record`, `invoice`, `spending_cap`, `project`, `property`, `property_permit`, `property_media`, `property_embedding`, `import_batch`, `import_row`, `contact`, `contact_identity`, `consent_record`, `suppression_entry`, `lead_source`, `lead`, `lead_assignment_history`, `requirement`, `match_result`, `tag`, `lead_tag`, `note`, `task`, `campaign`, `campaign_recipient`, `whatsapp_account`, `message_template`, `conversation`, `message`, `ai_run`, `ai_tool_call`, `approval_request`, `voice_compliance_config`, `voice_call`, `call_transcript`, `calendar_connection`, `viewing`, `deal`, `deal_stage_history`, `deal_milestone`, `deal_document`, `document_version`, `commission_split`, `fee_schedule`, `fee_rule`, `calculation_record`, `brand_kit`, `generated_asset`, `landing_page`, `utm_visit`.

## 8. RLS policy template

```sql
ALTER TABLE property ENABLE ROW LEVEL SECURITY;
ALTER TABLE property FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON property
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- app role: no BYPASSRLS, not table owner
GRANT SELECT, INSERT, UPDATE, DELETE ON property TO propforce_app;
```

If `app.tenant_id` is unset, `current_setting(..., true)` returns NULL and the policy matches no rows (fail closed).
