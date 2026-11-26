-- AI calling: agency-written call scripts and outbound AI calls to contacts.

-- CreateEnum
CREATE TYPE "VoiceCallStatus" AS ENUM ('queued', 'ringing', 'in_progress', 'ended', 'failed');

-- CreateEnum
CREATE TYPE "VoiceCallOutcome" AS ENUM (
  'interested', 'not_interested', 'callback_requested', 'viewing_requested',
  'wrong_number', 'do_not_call', 'no_answer', 'voicemail', 'other'
);

-- CreateTable
CREATE TABLE "voice_script" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL DEFAULT 'service',
    "language" TEXT NOT NULL DEFAULT 'en',
    "first_message" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "questions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "transcript_policy" "VoiceTranscriptPolicy" NOT NULL DEFAULT 'summary_only',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "voice_script_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "voice_script_tenant_id_idx" ON "voice_script"("tenant_id");
CREATE UNIQUE INDEX "voice_script_id_tenant_id_key" ON "voice_script"("id", "tenant_id");
ALTER TABLE "voice_script" ADD CONSTRAINT "voice_script_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "voice_script" ADD CONSTRAINT "voice_script_language" CHECK ("language" IN ('en', 'ar'));
ALTER TABLE "voice_script" ADD CONSTRAINT "voice_script_sizes" CHECK (
  char_length("name") BETWEEN 1 AND 80
  AND char_length("first_message") BETWEEN 1 AND 500
  AND char_length("instructions") BETWEEN 1 AND 8000
  AND coalesce(array_length("questions", 1), 0) <= 10
);

-- Outbound calls: placed from PropForce with a script, possibly on the platform's shared number
-- (no agency line), and updated as the provider reports progress.
ALTER TABLE "voice_call" ALTER COLUMN "line_id" DROP NOT NULL;
ALTER TABLE "voice_call"
  ADD COLUMN "script_id" UUID,
  ADD COLUMN "requested_by" UUID,
  ADD COLUMN "lead_id" UUID,
  ADD COLUMN "status" "VoiceCallStatus" NOT NULL DEFAULT 'ended',
  ADD COLUMN "outcome" "VoiceCallOutcome",
  ADD COLUMN "answers" JSONB,
  ADD COLUMN "callback_at" TEXT,
  ADD COLUMN "error" TEXT,
  ADD COLUMN "keep_transcript" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "voice_call_tenant_id_script_id_idx" ON "voice_call"("tenant_id", "script_id");
ALTER TABLE "voice_call" ADD CONSTRAINT "voice_call_script_id_tenant_id_fkey" FOREIGN KEY ("script_id", "tenant_id") REFERENCES "voice_script"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "voice_call" ADD CONSTRAINT "voice_call_lead_id_tenant_id_fkey" FOREIGN KEY ("lead_id", "tenant_id") REFERENCES "lead"("id", "tenant_id") ON DELETE SET NULL ("lead_id") ON UPDATE CASCADE;
-- Inbound calls always arrive on an agency line.
ALTER TABLE "voice_call" ADD CONSTRAINT "voice_call_line_required" CHECK ("direction" = 'outbound' OR "line_id" IS NOT NULL);

-- ───── Grants ─────
-- Scripts are switched off, never deleted, so past calls keep the script they used.
GRANT SELECT, INSERT, UPDATE ON "voice_script" TO propforce_app;
-- Calls stay a record: only the fields the provider reports later may change.
GRANT UPDATE ("provider_call_id", "status", "started_at", "ended_at", "duration_sec", "cost_usd",
  "ended_reason", "summary", "transcript", "outcome", "answers", "callback_at", "error")
  ON "voice_call" TO propforce_app;

-- ───── Row-level security (fail closed) ─────
ALTER TABLE "voice_script" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "voice_script" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "voice_script" FOR ALL
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY platform_admin_read ON "voice_script" FOR SELECT USING (app_is_platform_admin());
