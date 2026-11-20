-- PropForce AI · Phase 1 · identity, tenancy and row-level security.

-- Extensions used now (citext) and by later migrations (pgvector, trigram search).
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- CreateSchema

-- CreateEnum
CREATE TYPE "MfaFactorType" AS ENUM ('totp', 'recovery_code');

-- CreateEnum
CREATE TYPE "AgencyStatus" AS ENUM ('pending', 'active', 'suspended', 'cancelled');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('owner', 'admin', 'manager', 'agent');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('active', 'suspended', 'removed');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('user', 'ai', 'system', 'platform');

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "password_hash" TEXT,
    "email_verified_at" TIMESTAMPTZ(3),
    "full_name" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "is_platform_admin" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_factor" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "MfaFactorType" NOT NULL,
    "secret_encrypted" BYTEA,
    "code_hash" TEXT,
    "verified_at" TIMESTAMPTZ(3),
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_factor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flag" (
    "key" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "overrides" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "feature_flag_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "agency" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "emirate" TEXT NOT NULL,
    "trade_license_no" TEXT,
    "orn" TEXT,
    "status" "AgencyStatus" NOT NULL DEFAULT 'pending',
    "onboarded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_settings" (
    "tenant_id" UUID NOT NULL,
    "branding" JSONB NOT NULL DEFAULT '{}',
    "ai_settings" JSONB NOT NULL DEFAULT '{}',
    "listing_freshness_days" INTEGER NOT NULL DEFAULT 14,
    "outbound_voice_enabled" BOOLEAN NOT NULL DEFAULT false,
    "retention_policy" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agency_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "team" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "team_id" UUID,
    "role" "Role" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'active',
    "brn" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "role" "Role" NOT NULL,
    "team_id" UUID,
    "token_hash" TEXT NOT NULL,
    "invited_by" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_type" "ActorType" NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_refresh_token_hash_key" ON "session"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "session_user_id_idx" ON "session"("user_id");

-- CreateIndex
CREATE INDEX "session_family_id_idx" ON "session"("family_id");

-- CreateIndex
CREATE INDEX "mfa_factor_user_id_type_idx" ON "mfa_factor"("user_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "agency_slug_key" ON "agency"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "team_tenant_id_name_key" ON "team"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "membership_user_id_idx" ON "membership"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "membership_tenant_id_user_id_key" ON "membership"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_token_hash_key" ON "invitation"("token_hash");

-- CreateIndex
CREATE INDEX "invitation_tenant_id_email_idx" ON "invitation"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_created_at_idx" ON "audit_log"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_entity_type_entity_id_idx" ON "audit_log"("tenant_id", "entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_factor" ADD CONSTRAINT "mfa_factor_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_settings" ADD CONSTRAINT "agency_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team" ADD CONSTRAINT "team_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ═════════════════════════════ Row-level security ═════════════════════════════
--
-- The application connects as a login role that is a member of `propforce_app`. That role does not
-- own the tables and has no BYPASSRLS, so every query is filtered by the policies below.
-- Tenant context is set per transaction by the application:
--   SELECT set_config('app.tenant_id', '<uuid>', true);
--   SELECT set_config('app.user_id',   '<uuid>', true);
-- When the context is missing, the helper functions return NULL and policies match no rows
-- (fail closed).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'propforce_app') THEN
    CREATE ROLE propforce_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;

CREATE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

GRANT USAGE ON SCHEMA public TO propforce_app;
GRANT EXECUTE ON FUNCTION app_current_tenant(), app_current_user() TO propforce_app;

-- Platform tables: no tenant column, accessed only by auth/platform services.
GRANT SELECT, INSERT, UPDATE, DELETE ON "user", "session", "mfa_factor" TO propforce_app;
GRANT SELECT ON "feature_flag" TO propforce_app;

-- Tenant tables.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON "agency", "agency_settings", "team", "membership", "invitation" TO propforce_app;
-- Audit log is append-only for the application.
GRANT SELECT, INSERT ON "audit_log" TO propforce_app;

ALTER TABLE "agency"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agency"          FORCE ROW LEVEL SECURITY;
ALTER TABLE "agency_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agency_settings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "team"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "team"            FORCE ROW LEVEL SECURITY;
ALTER TABLE "membership"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "membership"      FORCE ROW LEVEL SECURITY;
ALTER TABLE "invitation"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitation"      FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_log"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log"       FORCE ROW LEVEL SECURITY;

-- Membership: tenant members see the tenant's memberships; a signed-in user also sees their own
-- memberships in every agency (needed to list "my agencies" before a tenant is selected).
CREATE POLICY membership_select ON "membership" FOR SELECT
  USING (tenant_id = app_current_tenant() OR user_id = app_current_user());
CREATE POLICY membership_write ON "membership" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- Agency: the current tenant, plus read-only visibility of agencies the user belongs to.
CREATE POLICY agency_select ON "agency" FOR SELECT
  USING (
    id = app_current_tenant()
    OR id IN (SELECT m.tenant_id FROM "membership" m WHERE m.user_id = app_current_user())
  );
CREATE POLICY agency_write ON "agency" FOR ALL
  USING (id = app_current_tenant())
  WITH CHECK (id = app_current_tenant());

CREATE POLICY tenant_isolation ON "agency_settings" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

CREATE POLICY tenant_isolation ON "team" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- Invitation: tenant scope, plus lookup by token hash when accepting an invite (the accepting
-- user has no tenant context yet). The hash is set with app.invite_token_hash for that one query.
CREATE POLICY invitation_select ON "invitation" FOR SELECT
  USING (
    tenant_id = app_current_tenant()
    OR token_hash = nullif(current_setting('app.invite_token_hash', true), '')
  );
CREATE POLICY invitation_write ON "invitation" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

CREATE POLICY tenant_isolation ON "audit_log" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
