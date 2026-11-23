-- Phase 2: AI turns on WhatsApp (audit of every run and tool call) and per-message AI claim.

-- AlterTable
ALTER TABLE "message" ADD COLUMN     "ai_claimed_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "ai_run" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "handover_reason" TEXT,
    "injection_suspected" BOOLEAN NOT NULL,
    "grounding_failures" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_tool_call" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "tool" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "outcome" TEXT NOT NULL,
    "code" TEXT,
    "latency_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_tool_call_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_run_tenant_id_created_at_idx" ON "ai_run"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_run_tenant_id_conversation_id_created_at_idx" ON "ai_run"("tenant_id", "conversation_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_tool_call_tenant_id_run_id_idx" ON "ai_tool_call"("tenant_id", "run_id");

-- CreateIndex
CREATE INDEX "ai_tool_call_tenant_id_conversation_id_created_at_idx" ON "ai_tool_call"("tenant_id", "conversation_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_conversation_id_tenant_id_fkey" FOREIGN KEY ("conversation_id", "tenant_id") REFERENCES "conversation"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_tool_call" ADD CONSTRAINT "ai_tool_call_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ───── Integrity ─────
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_values_check" CHECK (
  "outcome" IN ('reply', 'handover')
  AND "input_tokens" >= 0 AND "output_tokens" >= 0 AND "latency_ms" >= 0
);
ALTER TABLE "ai_tool_call" ADD CONSTRAINT "ai_tool_call_values_check" CHECK (
  "outcome" IN ('ok', 'approval_required', 'refused', 'error') AND "latency_ms" >= 0
);

-- ───── Grants ─────
-- Audit records are append-only for the application.
GRANT SELECT, INSERT ON "ai_run" TO propforce_app;
GRANT SELECT, INSERT ON "ai_tool_call" TO propforce_app;

-- ───── Row-level security (fail closed) ─────
ALTER TABLE "ai_run"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_run"       FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_tool_call" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_tool_call" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_run" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON "ai_tool_call" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
