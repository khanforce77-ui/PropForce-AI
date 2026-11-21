-- Permit QR link: the URL inside the regulator's QR code, drawn on the public listing page.
ALTER TABLE "property_permit" ADD COLUMN "verification_url" TEXT;
ALTER TABLE "property_permit" ADD CONSTRAINT "property_permit_verification_url_check" CHECK (
  verification_url IS NULL
  OR (length(verification_url) <= 500 AND verification_url ~ '^https://([a-z0-9-]+\.)*gov\.ae(/|\?|$)')
);

-- Visitors' reports about public listings.
CREATE TABLE "portal_listing_report" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "ip_hash" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_listing_report_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "portal_listing_report_check" CHECK (
      reason IN ('not_available', 'wrong_price', 'wrong_details', 'wrong_photos', 'fraud', 'other')
      AND status IN ('open', 'resolved', 'dismissed')
      AND (details IS NULL OR length(details) <= 1000)
      AND (email IS NULL OR length(email) <= 254)
    )
);

CREATE INDEX "portal_listing_report_tenant_id_created_at_idx" ON "portal_listing_report"("tenant_id", "created_at" DESC);
CREATE INDEX "portal_listing_report_property_id_idx" ON "portal_listing_report"("property_id");

ALTER TABLE "portal_listing_report" ADD CONSTRAINT "portal_listing_report_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portal_listing_report" ADD CONSTRAINT "portal_listing_report_property_id_tenant_id_fkey" FOREIGN KEY ("property_id", "tenant_id") REFERENCES "property"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───── Row-level security ─────
GRANT SELECT, INSERT, UPDATE ON "portal_listing_report" TO propforce_app;
ALTER TABLE "portal_listing_report" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_listing_report" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "portal_listing_report" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

CREATE POLICY platform_admin_read ON "portal_listing_report" FOR SELECT
  USING (app_is_platform_admin());

-- The public portal may only add reports (never read them back), for a publicly visible listing,
-- filed under that listing's agency.
CREATE POLICY public_portal_insert ON "portal_listing_report" FOR INSERT
  WITH CHECK (
    app_is_public_portal()
    AND EXISTS (
      SELECT 1 FROM "property" p
      WHERE p.id = portal_listing_report.property_id
        AND p.tenant_id = portal_listing_report.tenant_id
    )
  );
