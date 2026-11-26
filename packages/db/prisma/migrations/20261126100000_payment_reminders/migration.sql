-- Developer accounts (agency.kind = developer), buyers' payment plans and installments, and
-- payment reminders by email, SMS and AI call with a per-developer schedule and templates.

-- CreateEnum
CREATE TYPE "AgencyKind" AS ENUM ('agency', 'developer');

-- CreateEnum
CREATE TYPE "PaymentPlanStatus" AS ENUM ('active', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('pending', 'paid', 'waived');

-- CreateEnum
CREATE TYPE "ReminderChannel" AS ENUM ('email', 'sms', 'ai_call');

-- CreateEnum
CREATE TYPE "ReminderDispatchStatus" AS ENUM ('sending', 'sent', 'skipped_no_consent', 'skipped_no_address', 'provider_pending', 'failed');

-- AlterTable
ALTER TABLE "agency" ADD COLUMN     "kind" "AgencyKind" NOT NULL DEFAULT 'agency';

-- CreateTable
CREATE TABLE "payment_plan" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "project_name" TEXT NOT NULL,
    "unit_ref" TEXT,
    "total_price" DECIMAL(14,2) NOT NULL,
    "status" "PaymentPlanStatus" NOT NULL DEFAULT 'active',
    "reminders_paused" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_installment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "due_date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'pending',
    "paid_at" TIMESTAMPTZ(3),
    "paid_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_installment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_reminder_config" (
    "tenant_id" UUID NOT NULL,
    "rules" JSONB NOT NULL DEFAULT '[]',
    "templates" JSONB NOT NULL DEFAULT '{}',
    "reply_to_email" CITEXT,
    "contact_phone" TEXT,
    "payment_instructions" TEXT,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_reminder_config_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "payment_reminder_dispatch" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "installment_id" UUID NOT NULL,
    "rule_id" TEXT NOT NULL,
    "offset_days" INTEGER NOT NULL,
    "channel" "ReminderChannel" NOT NULL,
    "status" "ReminderDispatchStatus" NOT NULL,
    "recipient" TEXT,
    "detail" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_reminder_dispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_plan_tenant_id_created_at_idx" ON "payment_plan"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "payment_plan_tenant_id_contact_id_idx" ON "payment_plan"("tenant_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_plan_id_tenant_id_key" ON "payment_plan"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "payment_installment_tenant_id_status_due_date_idx" ON "payment_installment"("tenant_id", "status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "payment_installment_plan_id_seq_key" ON "payment_installment"("plan_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "payment_installment_id_tenant_id_key" ON "payment_installment"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "payment_reminder_dispatch_tenant_id_created_at_idx" ON "payment_reminder_dispatch"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "payment_reminder_dispatch_installment_id_rule_id_channel_key" ON "payment_reminder_dispatch"("installment_id", "rule_id", "channel");

-- AddForeignKey
ALTER TABLE "payment_plan" ADD CONSTRAINT "payment_plan_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_plan" ADD CONSTRAINT "payment_plan_contact_id_tenant_id_fkey" FOREIGN KEY ("contact_id", "tenant_id") REFERENCES "contact"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_installment" ADD CONSTRAINT "payment_installment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_installment" ADD CONSTRAINT "payment_installment_plan_id_tenant_id_fkey" FOREIGN KEY ("plan_id", "tenant_id") REFERENCES "payment_plan"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reminder_config" ADD CONSTRAINT "payment_reminder_config_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reminder_dispatch" ADD CONSTRAINT "payment_reminder_dispatch_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reminder_dispatch" ADD CONSTRAINT "payment_reminder_dispatch_installment_id_tenant_id_fkey" FOREIGN KEY ("installment_id", "tenant_id") REFERENCES "payment_installment"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "payment_plan" ADD CONSTRAINT "payment_plan_total_price" CHECK ("total_price" > 0);
ALTER TABLE "payment_installment" ADD CONSTRAINT "payment_installment_amount" CHECK ("amount" > 0);
ALTER TABLE "payment_installment" ADD CONSTRAINT "payment_installment_seq" CHECK ("seq" >= 1);
ALTER TABLE "payment_reminder_dispatch" ADD CONSTRAINT "payment_reminder_dispatch_offset" CHECK ("offset_days" BETWEEN -90 AND 90);

-- ───── Grants ─────
GRANT SELECT, INSERT, UPDATE, DELETE ON "payment_plan" TO propforce_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "payment_installment" TO propforce_app;
GRANT SELECT, INSERT, UPDATE ON "payment_reminder_config" TO propforce_app;
-- The reminder log is a record: rows are added and their status settled, never deleted by the app
-- (erasure of the buyer cascades).
GRANT SELECT, INSERT, UPDATE ON "payment_reminder_dispatch" TO propforce_app;

-- ───── Row-level security (fail closed) ─────
ALTER TABLE "payment_plan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_plan" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payment_installment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_installment" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payment_reminder_config" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_reminder_config" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payment_reminder_dispatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_reminder_dispatch" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "payment_plan" FOR ALL
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON "payment_installment" FOR ALL
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON "payment_reminder_config" FOR ALL
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON "payment_reminder_dispatch" FOR ALL
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY platform_admin_read ON "payment_plan" FOR SELECT USING (app_is_platform_admin());
CREATE POLICY platform_admin_read ON "payment_installment" FOR SELECT USING (app_is_platform_admin());
CREATE POLICY platform_admin_read ON "payment_reminder_dispatch" FOR SELECT USING (app_is_platform_admin());

-- The daily reminder run starts with no tenant. It sets app.reminder_cron for one query and may
-- then see only active developer agencies (read-only), to run each one in its own tenant context.
CREATE POLICY reminder_cron_read ON "agency" FOR SELECT
  USING (
    coalesce(current_setting('app.reminder_cron', true), '') = 'on'
    AND kind = 'developer'
    AND status = 'active'
  );
