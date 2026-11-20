-- CreateEnum
CREATE TYPE "ContactSource" AS ENUM ('manual', 'import', 'whatsapp', 'portal', 'referral', 'website', 'walk_in', 'other');

-- CreateEnum
CREATE TYPE "ConsentChannel" AS ENUM ('whatsapp', 'sms', 'email', 'phone_call');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('service', 'marketing');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('granted', 'withdrawn');

-- CreateEnum
CREATE TYPE "LeadIntent" AS ENUM ('buy', 'rent', 'sell', 'let');

-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('new', 'contacted', 'qualified', 'viewing', 'negotiating', 'won', 'lost');

-- CreateEnum
CREATE TYPE "LeadActivityType" AS ENUM ('note', 'stage_changed', 'assigned', 'created');

-- CreateTable
CREATE TABLE "contact" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone_e164" TEXT,
    "email" CITEXT,
    "nationality" TEXT,
    "preferred_language" TEXT,
    "source" "ContactSource" NOT NULL DEFAULT 'manual',
    "owner_membership_id" UUID,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "do_not_contact" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_record" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "channel" "ConsentChannel" NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "status" "ConsentStatus" NOT NULL,
    "method" TEXT NOT NULL,
    "evidence" TEXT,
    "recorded_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "intent" "LeadIntent" NOT NULL,
    "stage" "LeadStage" NOT NULL DEFAULT 'new',
    "assigned_membership_id" UUID,
    "property_id" UUID,
    "source" "ContactSource" NOT NULL DEFAULT 'manual',
    "emirate" TEXT,
    "communities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "property_types" "PropertyType"[] DEFAULT ARRAY[]::"PropertyType"[],
    "bedrooms_min" INTEGER,
    "bedrooms_max" INTEGER,
    "budget_min" DECIMAL(14,2),
    "budget_max" DECIMAL(14,2),
    "next_follow_up_at" TIMESTAMPTZ(3),
    "lost_reason" TEXT,
    "closed_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_activity" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "type" "LeadActivityType" NOT NULL,
    "body" TEXT,
    "from_value" TEXT,
    "to_value" TEXT,
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_tenant_id_email_idx" ON "contact"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "contact_tenant_id_owner_membership_id_idx" ON "contact"("tenant_id", "owner_membership_id");

-- CreateIndex
CREATE INDEX "contact_tenant_id_created_at_idx" ON "contact"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "contact_tenant_id_phone_e164_key" ON "contact"("tenant_id", "phone_e164");

-- CreateIndex
CREATE UNIQUE INDEX "contact_id_tenant_id_key" ON "contact"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "consent_record_tenant_id_contact_id_channel_purpose_created_idx" ON "consent_record"("tenant_id", "contact_id", "channel", "purpose", "created_at" DESC);

-- CreateIndex
CREATE INDEX "lead_tenant_id_stage_idx" ON "lead"("tenant_id", "stage");

-- CreateIndex
CREATE INDEX "lead_tenant_id_assigned_membership_id_stage_idx" ON "lead"("tenant_id", "assigned_membership_id", "stage");

-- CreateIndex
CREATE INDEX "lead_tenant_id_contact_id_idx" ON "lead"("tenant_id", "contact_id");

-- CreateIndex
CREATE INDEX "lead_tenant_id_next_follow_up_at_idx" ON "lead"("tenant_id", "next_follow_up_at");

-- CreateIndex
CREATE UNIQUE INDEX "lead_id_tenant_id_key" ON "lead"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "lead_activity_tenant_id_lead_id_created_at_idx" ON "lead_activity"("tenant_id", "lead_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "contact" ADD CONSTRAINT "contact_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact" ADD CONSTRAINT "contact_owner_membership_id_tenant_id_fkey" FOREIGN KEY ("owner_membership_id", "tenant_id") REFERENCES "membership"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_contact_id_tenant_id_fkey" FOREIGN KEY ("contact_id", "tenant_id") REFERENCES "contact"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_contact_id_tenant_id_fkey" FOREIGN KEY ("contact_id", "tenant_id") REFERENCES "contact"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_assigned_membership_id_tenant_id_fkey" FOREIGN KEY ("assigned_membership_id", "tenant_id") REFERENCES "membership"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_property_id_tenant_id_fkey" FOREIGN KEY ("property_id", "tenant_id") REFERENCES "property"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activity" ADD CONSTRAINT "lead_activity_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activity" ADD CONSTRAINT "lead_activity_lead_id_tenant_id_fkey" FOREIGN KEY ("lead_id", "tenant_id") REFERENCES "lead"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───── Integrity ─────
ALTER TABLE "contact" ADD CONSTRAINT "contact_phone_e164_check"
  CHECK ("phone_e164" IS NULL OR "phone_e164" ~ '^\+[1-9][0-9]{6,14}$');
ALTER TABLE "contact" ADD CONSTRAINT "contact_reachable_check"
  CHECK ("phone_e164" IS NOT NULL OR "email" IS NOT NULL);
ALTER TABLE "lead" ADD CONSTRAINT "lead_numbers_check" CHECK (
  ("budget_min" IS NULL OR "budget_min" >= 0)
  AND ("budget_max" IS NULL OR "budget_max" >= 0)
  AND ("budget_min" IS NULL OR "budget_max" IS NULL OR "budget_min" <= "budget_max")
  AND ("bedrooms_min" IS NULL OR "bedrooms_min" >= 0)
  AND ("bedrooms_max" IS NULL OR "bedrooms_max" >= 0)
  AND ("bedrooms_min" IS NULL OR "bedrooms_max" IS NULL OR "bedrooms_min" <= "bedrooms_max")
);

-- ───── Grants ─────
GRANT SELECT, INSERT, UPDATE, DELETE ON "contact", "lead" TO propforce_app;
-- Consent history and lead timeline are append-only for the application.
-- (They are still removed by cascade when the contact or lead is erased.)
GRANT SELECT, INSERT ON "consent_record", "lead_activity" TO propforce_app;

-- ───── Row-level security (fail closed) ─────
ALTER TABLE "contact"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact"        FORCE ROW LEVEL SECURITY;
ALTER TABLE "consent_record" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consent_record" FORCE ROW LEVEL SECURITY;
ALTER TABLE "lead"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead"           FORCE ROW LEVEL SECURITY;
ALTER TABLE "lead_activity"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_activity"  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "contact" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON "consent_record" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON "lead" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON "lead_activity" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
