-- Phase 3: Lead Booster (WhatsApp template campaigns with approval).

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'pending_approval', 'approved', 'sending', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "CampaignRecipientStatus" AS ENUM ('queued', 'skipped', 'sent', 'failed', 'replied');

-- CreateTable
CREATE TABLE "campaign" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "whatsapp_account_id" UUID NOT NULL,
    "template_name" TEXT NOT NULL,
    "language_code" TEXT NOT NULL,
    "body_params" JSONB NOT NULL DEFAULT '[]',
    "audience" JSONB NOT NULL DEFAULT '{}',
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "daily_limit" INTEGER NOT NULL DEFAULT 250,
    "created_by" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(3),
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_recipient" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "status" "CampaignRecipientStatus" NOT NULL DEFAULT 'queued',
    "skip_reason" TEXT,
    "wamid" TEXT,
    "error_code" INTEGER,
    "sent_at" TIMESTAMPTZ(3),
    "replied_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_recipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_tenant_id_created_at_idx" ON "campaign"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "campaign_id_tenant_id_key" ON "campaign"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "campaign_recipient_tenant_id_campaign_id_status_idx" ON "campaign_recipient"("tenant_id", "campaign_id", "status");

-- CreateIndex
CREATE INDEX "campaign_recipient_tenant_id_contact_id_sent_at_idx" ON "campaign_recipient"("tenant_id", "contact_id", "sent_at");

-- CreateIndex
CREATE INDEX "campaign_recipient_tenant_id_sent_at_idx" ON "campaign_recipient"("tenant_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipient_campaign_id_contact_id_key" ON "campaign_recipient"("campaign_id", "contact_id");

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_whatsapp_account_id_tenant_id_fkey" FOREIGN KEY ("whatsapp_account_id", "tenant_id") REFERENCES "whatsapp_account"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_campaign_id_tenant_id_fkey" FOREIGN KEY ("campaign_id", "tenant_id") REFERENCES "campaign"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_contact_id_tenant_id_fkey" FOREIGN KEY ("contact_id", "tenant_id") REFERENCES "contact"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "campaign" ADD CONSTRAINT "campaign_daily_limit_range" CHECK ("daily_limit" BETWEEN 1 AND 100000);

-- ───── Grants ─────
GRANT SELECT, INSERT, UPDATE ON "campaign", "campaign_recipient" TO propforce_app;

-- ───── Row-level security (fail closed) ─────
ALTER TABLE "campaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaign" FORCE ROW LEVEL SECURITY;
ALTER TABLE "campaign_recipient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaign_recipient" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "campaign" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON "campaign_recipient" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY platform_admin_read ON "campaign" FOR SELECT USING (app_is_platform_admin());
CREATE POLICY platform_admin_read ON "campaign_recipient" FOR SELECT USING (app_is_platform_admin());
