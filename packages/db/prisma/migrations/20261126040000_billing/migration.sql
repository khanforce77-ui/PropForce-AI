-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'cancelled');

-- CreateEnum
CREATE TYPE "UsageMeter" AS ENUM ('ai_replies', 'whatsapp_messages');

-- CreateEnum
CREATE TYPE "CapAction" AS ENUM ('warn', 'block');

-- CreateTable
CREATE TABLE "billing_plan" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_monthly_aed" DECIMAL(12,2),
    "seat_limit" INTEGER,
    "listing_limit" INTEGER,
    "ai_replies_monthly" INTEGER,
    "whatsapp_numbers" INTEGER,
    "storage_gb" INTEGER,
    "lead_booster" BOOLEAN NOT NULL DEFAULT false,
    "voice" TEXT NOT NULL DEFAULT 'none',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "billing_plan_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "subscription" (
    "tenant_id" UUID NOT NULL,
    "plan_code" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'trialing',
    "trial_ends_at" TIMESTAMPTZ(3),
    "current_period_end" TIMESTAMPTZ(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT,
    "provider_customer_id" TEXT,
    "provider_subscription_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "spending_cap" (
    "tenant_id" UUID NOT NULL,
    "meter" "UsageMeter" NOT NULL,
    "monthly_limit" INTEGER NOT NULL,
    "action" "CapAction" NOT NULL DEFAULT 'warn',
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "spending_cap_pkey" PRIMARY KEY ("tenant_id","meter")
);

-- CreateIndex
CREATE INDEX "subscription_status_idx" ON "subscription"("status");

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_plan_code_fkey" FOREIGN KEY ("plan_code") REFERENCES "billing_plan"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spending_cap" ADD CONSTRAINT "spending_cap_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "billing_plan" ADD CONSTRAINT "billing_plan_voice" CHECK ("voice" IN ('none', 'inbound', 'inbound_outbound'));
ALTER TABLE "billing_plan" ADD CONSTRAINT "billing_plan_price" CHECK ("price_monthly_aed" IS NULL OR "price_monthly_aed" >= 0);
ALTER TABLE "spending_cap" ADD CONSTRAINT "spending_cap_limit" CHECK ("monthly_limit" >= 0);

-- Draft plan limits from the feature matrix (prices not set: the platform admin sets them).
INSERT INTO "billing_plan" ("code", "name", "seat_limit", "listing_limit", "ai_replies_monthly", "whatsapp_numbers", "storage_gb", "lead_booster", "voice", "sort_order", "updated_at") VALUES
  ('trial',        'Trial',        3,    200,  200,   1,    5,    false, 'none',             0, now()),
  ('starter',      'Starter',      3,    200,  1000,  1,    10,   false, 'none',             1, now()),
  ('professional', 'Professional', 10,   1000, 5000,  1,    50,   true,  'none',             2, now()),
  ('agency',       'Agency',       30,   5000, 20000, 3,    200,  true,  'inbound',          3, now()),
  ('enterprise',   'Enterprise',   NULL, NULL, NULL,  NULL, NULL, true,  'inbound_outbound', 4, now());

-- ───── Grants ─────
GRANT SELECT, UPDATE ON "billing_plan" TO propforce_app;
GRANT SELECT, INSERT, UPDATE ON "subscription" TO propforce_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "spending_cap" TO propforce_app;

-- ───── Row-level security (fail closed) ─────
-- Plans: everyone signed in may read the catalogue; only a platform admin may change it.
ALTER TABLE "billing_plan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_plan" FORCE ROW LEVEL SECURITY;
CREATE POLICY plan_read ON "billing_plan" FOR SELECT USING (true);
CREATE POLICY plan_platform_write ON "billing_plan" FOR UPDATE
  USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());

ALTER TABLE "subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscription" FORCE ROW LEVEL SECURITY;
ALTER TABLE "spending_cap" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spending_cap" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "subscription" FOR ALL
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON "spending_cap" FOR ALL
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY platform_admin_read ON "subscription" FOR SELECT USING (app_is_platform_admin());
CREATE POLICY platform_admin_read ON "spending_cap" FOR SELECT USING (app_is_platform_admin());
