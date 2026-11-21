
-- CreateTable
CREATE TABLE "property_photo" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "original" BYTEA NOT NULL,
    "display" BYTEA NOT NULL,
    "thumb" BYTEA NOT NULL,
    "mark_sha256" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "property_photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_logo" (
    "tenant_id" UUID NOT NULL,
    "bytes" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agency_logo_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateIndex
CREATE INDEX "property_photo_tenant_id_property_id_position_idx" ON "property_photo"("tenant_id", "property_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "property_photo_id_tenant_id_key" ON "property_photo"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "property_photo_property_id_sha256_key" ON "property_photo"("property_id", "sha256");

-- AddForeignKey
ALTER TABLE "property_photo" ADD CONSTRAINT "property_photo_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_photo" ADD CONSTRAINT "property_photo_property_id_tenant_id_fkey" FOREIGN KEY ("property_id", "tenant_id") REFERENCES "property"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_logo" ADD CONSTRAINT "agency_logo_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "property_photo" ADD CONSTRAINT "property_photo_check" CHECK (
  position BETWEEN 0 AND 99
  AND sha256 ~ '^[0-9a-f]{64}$'
  AND (mark_sha256 IS NULL OR mark_sha256 ~ '^[0-9a-f]{64}$')
  AND width BETWEEN 400 AND 2560
  AND height BETWEEN 400 AND 2560
  AND version >= 1
  AND octet_length(original) BETWEEN 1 AND 10485760
  AND octet_length(display) BETWEEN 1 AND 4194304
  AND octet_length(thumb) BETWEEN 1 AND 1048576
);

ALTER TABLE "agency_logo" ADD CONSTRAINT "agency_logo_check" CHECK (
  sha256 ~ '^[0-9a-f]{64}$'
  AND width BETWEEN 1 AND 800
  AND height BETWEEN 1 AND 800
  AND octet_length(bytes) BETWEEN 1 AND 2097152
);

-- ───── Row-level security ─────
GRANT SELECT, INSERT, UPDATE, DELETE ON "property_photo" TO propforce_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "agency_logo" TO propforce_app;
ALTER TABLE "property_photo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "property_photo" FORCE ROW LEVEL SECURITY;
ALTER TABLE "agency_logo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agency_logo" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "property_photo" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

CREATE POLICY tenant_isolation ON "agency_logo" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- The public portal sees the photos of listings it can show (the property policy decides that).
-- Read-only. The API only ever selects the watermarked columns for the portal.
CREATE POLICY public_portal_read ON "property_photo" FOR SELECT
  USING (
    app_is_public_portal()
    AND EXISTS (
      SELECT 1 FROM "property" p
      WHERE p.id = property_photo.property_id AND p.tenant_id = property_photo.tenant_id
    )
  );

-- Platform admins' read-only cross-agency view.
CREATE POLICY platform_admin_read ON "property_photo" FOR SELECT USING (app_is_platform_admin());
CREATE POLICY platform_admin_read ON "agency_logo" FOR SELECT USING (app_is_platform_admin());
