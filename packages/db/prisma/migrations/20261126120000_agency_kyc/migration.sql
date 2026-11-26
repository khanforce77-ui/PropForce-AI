-- Agency KYC (Dubai): the documents an agency uploads at registration (trade licence, MOA, Ejari,
-- ORN card, owners' passports and Emirates IDs, employees' broker cards and Emirates IDs, permits)
-- and PropForce's per-document review. With platform.require_agency_documents on, an agency cannot
-- submit for approval until every required document is uploaded, and cannot be approved (go live)
-- until every required document is approved.
-- CreateEnum
CREATE TYPE "AgencyDocumentType" AS ENUM ('trade_license', 'moa', 'ejari', 'orn_certificate', 'owner_passport', 'owner_emirates_id', 'employee_brn_card', 'employee_emirates_id', 'permit', 'employee_list');

-- CreateEnum
CREATE TYPE "AgencyDocumentStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "agency" ADD COLUMN     "website" TEXT,
ADD COLUMN     "kyc_instructions" TEXT,
ADD COLUMN     "kyc_instructions_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "agency_owner" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "nationality" TEXT,
    "share_percent" INTEGER,
    "uae_resident" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agency_owner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_employee" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "designation" TEXT,
    "is_broker" BOOLEAN NOT NULL DEFAULT true,
    "brn" TEXT,
    "email" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agency_employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_document" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "AgencyDocumentType" NOT NULL,
    "owner_id" UUID,
    "employee_id" UUID,
    "label" TEXT,
    "document_number" TEXT,
    "expires_at" DATE,
    "status" "AgencyDocumentStatus" NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "content_type" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by" UUID,
    "ai_status" TEXT NOT NULL DEFAULT 'not_checked',
    "ai_result" JSONB,
    "ai_model" TEXT,
    "ai_checked_at" TIMESTAMPTZ(3),

    CONSTRAINT "agency_document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agency_owner_tenant_id_idx" ON "agency_owner"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "agency_owner_id_tenant_id_key" ON "agency_owner"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "agency_employee_tenant_id_idx" ON "agency_employee"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "agency_employee_id_tenant_id_key" ON "agency_employee"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "agency_document_tenant_id_type_idx" ON "agency_document"("tenant_id", "type");

-- CreateIndex
CREATE INDEX "agency_document_status_uploaded_at_idx" ON "agency_document"("status", "uploaded_at");

-- AddForeignKey
ALTER TABLE "agency_owner" ADD CONSTRAINT "agency_owner_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_employee" ADD CONSTRAINT "agency_employee_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_document" ADD CONSTRAINT "agency_document_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_document" ADD CONSTRAINT "agency_document_owner_id_tenant_id_fkey" FOREIGN KEY ("owner_id", "tenant_id") REFERENCES "agency_owner"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_document" ADD CONSTRAINT "agency_document_employee_id_tenant_id_fkey" FOREIGN KEY ("employee_id", "tenant_id") REFERENCES "agency_employee"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agency" ADD CONSTRAINT "agency_website_check" CHECK (
  website IS NULL OR (length(website) <= 200 AND website ~ '^https?://')
);
ALTER TABLE "agency" ADD CONSTRAINT "agency_kyc_instructions_check" CHECK (
  kyc_instructions IS NULL OR length(kyc_instructions) <= 4000
);

ALTER TABLE "agency_owner" ADD CONSTRAINT "agency_owner_check" CHECK (
  length(full_name) BETWEEN 2 AND 120
  AND (nationality IS NULL OR length(nationality) <= 60)
  AND (share_percent IS NULL OR share_percent BETWEEN 0 AND 100)
);

ALTER TABLE "agency_employee" ADD CONSTRAINT "agency_employee_check" CHECK (
  length(full_name) BETWEEN 2 AND 120
  AND (designation IS NULL OR length(designation) <= 80)
  AND (brn IS NULL OR length(brn) BETWEEN 1 AND 32)
  AND (email IS NULL OR length(email) <= 254)
);

-- Owner documents belong to an owner, employee documents to an employee, the rest to the agency.
ALTER TABLE "agency_document" ADD CONSTRAINT "agency_document_check" CHECK (
  content_type IN ('application/pdf', 'image/jpeg')
  AND octet_length(bytes) BETWEEN 1 AND 15728640
  AND length(file_name) BETWEEN 1 AND 200
  AND (label IS NULL OR length(label) <= 120)
  AND (document_number IS NULL OR length(document_number) <= 64)
  AND (reason IS NULL OR length(reason) <= 500)
  AND ai_status IN ('not_checked', 'checked', 'failed')
  AND (owner_id IS NOT NULL) = (type IN ('owner_passport', 'owner_emirates_id'))
  AND (employee_id IS NOT NULL) = (type IN ('employee_brn_card', 'employee_emirates_id'))
);

-- ───── Row-level security ─────
GRANT SELECT, INSERT, UPDATE, DELETE ON "agency_owner", "agency_employee", "agency_document" TO propforce_app;

ALTER TABLE "agency_owner" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agency_owner" FORCE ROW LEVEL SECURITY;
ALTER TABLE "agency_employee" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agency_employee" FORCE ROW LEVEL SECURITY;
ALTER TABLE "agency_document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agency_document" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "agency_owner" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON "agency_employee" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON "agency_document" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- Platform admins see the review queue across agencies; decisions are written in the agency's
-- tenant context. No public portal policy: the portal never reads these tables.
CREATE POLICY platform_admin_read ON "agency_owner" FOR SELECT USING (app_is_platform_admin());
CREATE POLICY platform_admin_read ON "agency_employee" FOR SELECT USING (app_is_platform_admin());
CREATE POLICY platform_admin_read ON "agency_document" FOR SELECT USING (app_is_platform_admin());

INSERT INTO "feature_flag" ("key", "description", "enabled", "updated_at") VALUES
  ('platform.require_agency_documents',
   'New agencies upload their trade licence, MOA, Ejari, ORN card, owners'' and employees'' IDs before submitting, and go live only after PropForce approves every required document.',
   true, now())
ON CONFLICT ("key") DO NOTHING;
