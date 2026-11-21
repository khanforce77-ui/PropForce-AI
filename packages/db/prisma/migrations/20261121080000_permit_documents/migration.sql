-- AlterTable
ALTER TABLE "property_permit" ALTER COLUMN "permit_number" DROP NOT NULL;

-- CreateTable
CREATE TABLE "property_permit_document" (
    "permit_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "content_type" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "property_permit_document_pkey" PRIMARY KEY ("permit_id")
);

-- CreateIndex
CREATE INDEX "property_permit_document_tenant_id_idx" ON "property_permit_document"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "property_permit_document_permit_id_tenant_id_key" ON "property_permit_document"("permit_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "property_permit_id_tenant_id_key" ON "property_permit"("id", "tenant_id");

-- AddForeignKey
ALTER TABLE "property_permit_document" ADD CONSTRAINT "property_permit_document_permit_id_tenant_id_fkey" FOREIGN KEY ("permit_id", "tenant_id") REFERENCES "property_permit"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "property_permit_document" ADD CONSTRAINT "property_permit_document_check" CHECK (
  content_type IN ('application/pdf', 'image/jpeg', 'image/png')
  AND octet_length(bytes) BETWEEN 1 AND 5242880
  AND sha256 ~ '^[0-9a-f]{64}$'
  AND length(file_name) BETWEEN 1 AND 200
);

-- ───── Row-level security ─────
-- Private to the agency. Deliberately no public_portal_read policy: the portal never sees permits'
-- documents, only the authority, number and expiry date.
GRANT SELECT, INSERT, UPDATE, DELETE ON "property_permit_document" TO propforce_app;
ALTER TABLE "property_permit_document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "property_permit_document" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "property_permit_document" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

CREATE POLICY platform_admin_read ON "property_permit_document" FOR SELECT
  USING (app_is_platform_admin());
