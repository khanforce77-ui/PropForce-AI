-- Marketing studio: AI caption drafts (reviewed before use) and UTM attribution on enquiries and leads.
-- CreateEnum
CREATE TYPE "caption_platform" AS ENUM ('instagram', 'facebook', 'linkedin', 'whatsapp_status');
-- CreateEnum
CREATE TYPE "caption_status" AS ENUM ('draft', 'approved', 'discarded');
-- AlterTable
ALTER TABLE "lead" ADD COLUMN     "utm_campaign" TEXT,
ADD COLUMN     "utm_medium" TEXT,
ADD COLUMN     "utm_source" TEXT;
-- AlterTable
ALTER TABLE "portal_enquiry" ADD COLUMN     "utm_campaign" TEXT,
ADD COLUMN     "utm_medium" TEXT,
ADD COLUMN     "utm_source" TEXT;
-- CreateTable
CREATE TABLE "marketing_caption" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "platform" "caption_platform" NOT NULL,
    "language" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" "caption_status" NOT NULL DEFAULT 'draft',
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "created_by" UUID NOT NULL,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketing_caption_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "marketing_caption_tenant_id_property_id_created_at_idx" ON "marketing_caption"("tenant_id", "property_id", "created_at" DESC);
-- CreateIndex
CREATE INDEX "marketing_caption_tenant_id_created_at_idx" ON "marketing_caption"("tenant_id", "created_at" DESC);
-- AddForeignKey
ALTER TABLE "marketing_caption" ADD CONSTRAINT "marketing_caption_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "marketing_caption" ADD CONSTRAINT "marketing_caption_property_id_tenant_id_fkey" FOREIGN KEY ("property_id", "tenant_id") REFERENCES "property"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───── Checks ─────
ALTER TABLE "marketing_caption" ADD CONSTRAINT "marketing_caption_language" CHECK ("language" IN ('en', 'ar'));
ALTER TABLE "marketing_caption" ADD CONSTRAINT "marketing_caption_text_len" CHECK (char_length("text") BETWEEN 1 AND 3000);
ALTER TABLE "marketing_caption" ADD CONSTRAINT "marketing_caption_tokens" CHECK ("input_tokens" >= 0 AND "output_tokens" >= 0);
ALTER TABLE "portal_enquiry" ADD CONSTRAINT "portal_enquiry_utm_len" CHECK (
  coalesce(char_length("utm_source"), 0) <= 100 AND coalesce(char_length("utm_medium"), 0) <= 100
  AND coalesce(char_length("utm_campaign"), 0) <= 100
);
ALTER TABLE "lead" ADD CONSTRAINT "lead_utm_len" CHECK (
  coalesce(char_length("utm_source"), 0) <= 100 AND coalesce(char_length("utm_medium"), 0) <= 100
  AND coalesce(char_length("utm_campaign"), 0) <= 100
);

-- ───── Grants ─────
-- Captions are discarded rather than deleted, so token spend stays counted.
GRANT SELECT, INSERT, UPDATE ON "marketing_caption" TO propforce_app;

-- ───── Row-level security (fail closed) ─────
ALTER TABLE "marketing_caption" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketing_caption" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "marketing_caption" FOR ALL
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY platform_admin_read ON "marketing_caption" FOR SELECT USING (app_is_platform_admin());
