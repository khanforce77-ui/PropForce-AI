-- Phase 3: deals, commission splits and checklists.
-- CreateEnum
CREATE TYPE "DealType" AS ENUM ('sale', 'rental');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('pending', 'invoiced', 'received');

-- CreateTable
CREATE TABLE "deal" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "type" "DealType" NOT NULL,
    "stage" TEXT NOT NULL,
    "lead_id" UUID,
    "contact_id" UUID NOT NULL,
    "property_id" UUID,
    "agent_membership_id" UUID NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "commission_percent" DECIMAL(5,2),
    "commission_amount" DECIMAL(14,2),
    "vat_percent" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "commission_status" "CommissionStatus" NOT NULL DEFAULT 'pending',
    "invoice_number" TEXT,
    "invoiced_at" TIMESTAMPTZ(3),
    "commission_received_at" TIMESTAMPTZ(3),
    "expected_close_date" DATE,
    "closed_at" TIMESTAMPTZ(3),
    "lost_reason" TEXT,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_commission_split" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "membership_id" UUID,
    "party_name" TEXT,
    "percent" DECIMAL(5,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_commission_split_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_task" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "due_date" DATE,
    "done_at" TIMESTAMPTZ(3),
    "done_by" UUID,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deal_tenant_id_type_stage_idx" ON "deal"("tenant_id", "type", "stage");

-- CreateIndex
CREATE INDEX "deal_tenant_id_agent_membership_id_idx" ON "deal"("tenant_id", "agent_membership_id");

-- CreateIndex
CREATE INDEX "deal_tenant_id_closed_at_idx" ON "deal"("tenant_id", "closed_at");

-- CreateIndex
CREATE UNIQUE INDEX "deal_tenant_id_reference_key" ON "deal"("tenant_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "deal_id_tenant_id_key" ON "deal"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "deal_commission_split_tenant_id_deal_id_idx" ON "deal_commission_split"("tenant_id", "deal_id");

-- CreateIndex
CREATE INDEX "deal_commission_split_tenant_id_membership_id_idx" ON "deal_commission_split"("tenant_id", "membership_id");

-- CreateIndex
CREATE INDEX "deal_task_tenant_id_deal_id_position_idx" ON "deal_task"("tenant_id", "deal_id", "position");

-- AddForeignKey
ALTER TABLE "deal" ADD CONSTRAINT "deal_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal" ADD CONSTRAINT "deal_lead_id_tenant_id_fkey" FOREIGN KEY ("lead_id", "tenant_id") REFERENCES "lead"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal" ADD CONSTRAINT "deal_contact_id_tenant_id_fkey" FOREIGN KEY ("contact_id", "tenant_id") REFERENCES "contact"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal" ADD CONSTRAINT "deal_property_id_tenant_id_fkey" FOREIGN KEY ("property_id", "tenant_id") REFERENCES "property"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal" ADD CONSTRAINT "deal_agent_membership_id_tenant_id_fkey" FOREIGN KEY ("agent_membership_id", "tenant_id") REFERENCES "membership"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_commission_split" ADD CONSTRAINT "deal_commission_split_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_commission_split" ADD CONSTRAINT "deal_commission_split_deal_id_tenant_id_fkey" FOREIGN KEY ("deal_id", "tenant_id") REFERENCES "deal"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_commission_split" ADD CONSTRAINT "deal_commission_split_membership_id_tenant_id_fkey" FOREIGN KEY ("membership_id", "tenant_id") REFERENCES "membership"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_task" ADD CONSTRAINT "deal_task_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_task" ADD CONSTRAINT "deal_task_deal_id_tenant_id_fkey" FOREIGN KEY ("deal_id", "tenant_id") REFERENCES "deal"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "deal" ADD CONSTRAINT "deal_price_positive" CHECK ("price" > 0);
ALTER TABLE "deal" ADD CONSTRAINT "deal_commission_range"
  CHECK (("commission_percent" IS NULL OR "commission_percent" BETWEEN 0 AND 100)
     AND ("commission_amount" IS NULL OR "commission_amount" >= 0)
     AND "vat_percent" BETWEEN 0 AND 100);
ALTER TABLE "deal_commission_split" ADD CONSTRAINT "deal_split_percent_range" CHECK ("percent" > 0 AND "percent" <= 100);
ALTER TABLE "deal_commission_split" ADD CONSTRAINT "deal_split_party"
  CHECK (("membership_id" IS NOT NULL) <> ("party_name" IS NOT NULL));

-- ───── Grants ─────
GRANT SELECT, INSERT, UPDATE, DELETE ON "deal", "deal_commission_split", "deal_task" TO propforce_app;

-- ───── Row-level security (fail closed) ─────
ALTER TABLE "deal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deal" FORCE ROW LEVEL SECURITY;
ALTER TABLE "deal_commission_split" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deal_commission_split" FORCE ROW LEVEL SECURITY;
ALTER TABLE "deal_task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deal_task" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "deal" FOR ALL
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON "deal_commission_split" FOR ALL
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON "deal_task" FOR ALL
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY platform_admin_read ON "deal" FOR SELECT USING (app_is_platform_admin());
CREATE POLICY platform_admin_read ON "deal_commission_split" FOR SELECT USING (app_is_platform_admin());
