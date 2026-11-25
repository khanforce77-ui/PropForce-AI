-- Phase 2: property viewings on agents' calendars.
-- CreateEnum
CREATE TYPE "ViewingStatus" AS ENUM ('requested', 'confirmed', 'completed', 'cancelled', 'no_show');

-- CreateEnum
CREATE TYPE "ViewingSource" AS ENUM ('agent', 'ai', 'portal');

-- CreateTable
CREATE TABLE "viewing" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "agent_membership_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "ViewingStatus" NOT NULL DEFAULT 'confirmed',
    "source" "ViewingSource" NOT NULL DEFAULT 'agent',
    "notes" TEXT,
    "outcome" TEXT,
    "external_event_id" TEXT,
    "confirmed_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "viewing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "viewing_tenant_id_agent_membership_id_starts_at_idx" ON "viewing"("tenant_id", "agent_membership_id", "starts_at");

-- CreateIndex
CREATE INDEX "viewing_tenant_id_starts_at_idx" ON "viewing"("tenant_id", "starts_at");

-- CreateIndex
CREATE INDEX "viewing_tenant_id_lead_id_idx" ON "viewing"("tenant_id", "lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "viewing_id_tenant_id_key" ON "viewing"("id", "tenant_id");

-- AddForeignKey
ALTER TABLE "viewing" ADD CONSTRAINT "viewing_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viewing" ADD CONSTRAINT "viewing_lead_id_tenant_id_fkey" FOREIGN KEY ("lead_id", "tenant_id") REFERENCES "lead"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viewing" ADD CONSTRAINT "viewing_property_id_tenant_id_fkey" FOREIGN KEY ("property_id", "tenant_id") REFERENCES "property"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viewing" ADD CONSTRAINT "viewing_agent_membership_id_tenant_id_fkey" FOREIGN KEY ("agent_membership_id", "tenant_id") REFERENCES "membership"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;


ALTER TABLE "viewing" ADD CONSTRAINT "viewing_time_order" CHECK ("ends_at" > "starts_at");

-- ───── Grants ─────
GRANT SELECT, INSERT, UPDATE, DELETE ON "viewing" TO propforce_app;

-- ───── Row-level security (fail closed) ─────
ALTER TABLE "viewing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "viewing" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "viewing" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY platform_admin_read ON "viewing" FOR SELECT USING (app_is_platform_admin());
