-- CreateEnum
CREATE TYPE "VoiceTranscriptPolicy" AS ENUM ('summary_only', 'full_transcript');

-- CreateEnum
CREATE TYPE "VoiceDirection" AS ENUM ('inbound', 'outbound');

-- AlterEnum
ALTER TYPE "ContactSource" ADD VALUE IF NOT EXISTS 'phone';

-- CreateTable
CREATE TABLE "voice_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'vapi',
    "provider_phone_number_id" TEXT NOT NULL,
    "phone_e164" TEXT,
    "label" TEXT,
    "transcript_policy" "VoiceTranscriptPolicy" NOT NULL DEFAULT 'summary_only',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "voice_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_call" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "line_id" UUID NOT NULL,
    "provider_call_id" TEXT NOT NULL,
    "direction" "VoiceDirection" NOT NULL DEFAULT 'inbound',
    "caller_e164" TEXT,
    "contact_id" UUID,
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "duration_sec" INTEGER,
    "cost_usd" DECIMAL(10,4),
    "ended_reason" TEXT,
    "summary" TEXT,
    "transcript" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_call_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voice_line_provider_phone_number_id_key" ON "voice_line"("provider_phone_number_id");

-- CreateIndex
CREATE INDEX "voice_line_tenant_id_idx" ON "voice_line"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "voice_line_id_tenant_id_key" ON "voice_line"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "voice_call_tenant_id_created_at_idx" ON "voice_call"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "voice_call_tenant_id_contact_id_idx" ON "voice_call"("tenant_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "voice_call_tenant_id_provider_call_id_key" ON "voice_call"("tenant_id", "provider_call_id");

-- AddForeignKey
ALTER TABLE "voice_line" ADD CONSTRAINT "voice_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_call" ADD CONSTRAINT "voice_call_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_call" ADD CONSTRAINT "voice_call_line_id_tenant_id_fkey" FOREIGN KEY ("line_id", "tenant_id") REFERENCES "voice_line"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_call" ADD CONSTRAINT "voice_call_contact_id_tenant_id_fkey" FOREIGN KEY ("contact_id", "tenant_id") REFERENCES "contact"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "voice_line" ADD CONSTRAINT "voice_line_provider" CHECK ("provider" IN ('vapi'));
ALTER TABLE "voice_line" ADD CONSTRAINT "voice_line_provider_id_format" CHECK ("provider_phone_number_id" ~ '^[A-Za-z0-9_-]{1,100}$');
ALTER TABLE "voice_call" ADD CONSTRAINT "voice_call_duration" CHECK ("duration_sec" IS NULL OR "duration_sec" >= 0);

-- ───── Grants ─────
-- Lines are switched off, never deleted, so their call history stays.
GRANT SELECT, INSERT, UPDATE ON "voice_line" TO propforce_app;
-- Calls are a record: the app may add and read them, never edit them (erasure cascades from contact).
GRANT SELECT, INSERT ON "voice_call" TO propforce_app;

-- ───── Row-level security (fail closed) ─────
ALTER TABLE "voice_line" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "voice_line" FORCE ROW LEVEL SECURITY;
ALTER TABLE "voice_call" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "voice_call" FORCE ROW LEVEL SECURITY;

-- Webhooks arrive before the agency is known. The router sets app.voice_phone_number_id for one
-- query and may then read only the line row for that number (to learn its tenant).
CREATE POLICY voice_line_select ON "voice_line" FOR SELECT
  USING (
    tenant_id = app_current_tenant()
    OR provider_phone_number_id = nullif(current_setting('app.voice_phone_number_id', true), '')
  );
CREATE POLICY voice_line_insert ON "voice_line" FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY voice_line_update ON "voice_line" FOR UPDATE
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON "voice_call" FOR ALL
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY platform_admin_read ON "voice_line" FOR SELECT USING (app_is_platform_admin());
CREATE POLICY platform_admin_read ON "voice_call" FOR SELECT USING (app_is_platform_admin());
