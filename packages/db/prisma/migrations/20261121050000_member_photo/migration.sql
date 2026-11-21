-- CreateTable
CREATE TABLE "member_photo" (
    "membership_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "content_type" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "member_photo_pkey" PRIMARY KEY ("membership_id")
);

-- CreateIndex
CREATE INDEX "member_photo_tenant_id_idx" ON "member_photo"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "member_photo_membership_id_tenant_id_key" ON "member_photo"("membership_id", "tenant_id");

-- AddForeignKey
ALTER TABLE "member_photo" ADD CONSTRAINT "member_photo_membership_id_tenant_id_fkey" FOREIGN KEY ("membership_id", "tenant_id") REFERENCES "membership"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "member_photo" ADD CONSTRAINT "member_photo_check" CHECK (
  content_type IN ('image/webp', 'image/jpeg', 'image/png')
  AND octet_length(bytes) BETWEEN 1 AND 204800
  AND sha256 ~ '^[0-9a-f]{64}$'
);

-- ───── Row-level security ─────
GRANT SELECT, INSERT, UPDATE, DELETE ON "member_photo" TO propforce_app;
ALTER TABLE "member_photo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "member_photo" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "member_photo" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- The public portal sees the photo of an agent it can show: an active, unsuspended agent (the
-- membership policy) of an active, approved agency (the agency policy). Read-only.
CREATE POLICY public_portal_read ON "member_photo" FOR SELECT
  USING (
    app_is_public_portal()
    AND EXISTS (SELECT 1 FROM "agency" a WHERE a.id = member_photo.tenant_id)
    AND EXISTS (
      SELECT 1 FROM "membership" m
      WHERE m.id = member_photo.membership_id AND m.tenant_id = member_photo.tenant_id
    )
  );

-- Platform admins' read-only cross-agency view.
CREATE POLICY platform_admin_read ON "member_photo" FOR SELECT USING (app_is_platform_admin());
