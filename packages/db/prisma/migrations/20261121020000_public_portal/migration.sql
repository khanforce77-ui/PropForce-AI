-- CreateEnum
CREATE TYPE "PortalEnquiryStatus" AS ENUM ('new', 'contacted', 'converted', 'spam', 'closed');

-- CreateEnum
CREATE TYPE "PortalContactChannel" AS ENUM ('whatsapp', 'call');

-- AlterTable
ALTER TABLE "membership" ADD COLUMN     "public_phone_e164" TEXT,
ADD COLUMN     "whatsapp_e164" TEXT;

-- CreateTable
CREATE TABLE "portal_enquiry" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "email" CITEXT,
    "message" TEXT NOT NULL,
    "status" "PortalEnquiryStatus" NOT NULL DEFAULT 'new',
    "consent_contact" BOOLEAN NOT NULL,
    "consent_marketing" BOOLEAN NOT NULL DEFAULT false,
    "consent_text" TEXT NOT NULL,
    "consent_at" TIMESTAMPTZ(3) NOT NULL,
    "ip_hash" TEXT,
    "user_agent" TEXT,
    "lead_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_enquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_contact_event" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "channel" "PortalContactChannel" NOT NULL,
    "ip_hash" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_contact_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_rate_hit" (
    "id" BIGSERIAL NOT NULL,
    "bucket" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_rate_hit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portal_enquiry_tenant_id_created_at_idx" ON "portal_enquiry"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "portal_enquiry_tenant_id_membership_id_created_at_idx" ON "portal_enquiry"("tenant_id", "membership_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "portal_enquiry_tenant_id_property_id_idx" ON "portal_enquiry"("tenant_id", "property_id");

-- CreateIndex
CREATE INDEX "portal_contact_event_tenant_id_created_at_idx" ON "portal_contact_event"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "portal_contact_event_tenant_id_membership_id_created_at_idx" ON "portal_contact_event"("tenant_id", "membership_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "public_rate_hit_bucket_created_at_idx" ON "public_rate_hit"("bucket", "created_at");

-- AddForeignKey
ALTER TABLE "portal_enquiry" ADD CONSTRAINT "portal_enquiry_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_enquiry" ADD CONSTRAINT "portal_enquiry_property_id_tenant_id_fkey" FOREIGN KEY ("property_id", "tenant_id") REFERENCES "property"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_enquiry" ADD CONSTRAINT "portal_enquiry_membership_id_tenant_id_fkey" FOREIGN KEY ("membership_id", "tenant_id") REFERENCES "membership"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_contact_event" ADD CONSTRAINT "portal_contact_event_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_contact_event" ADD CONSTRAINT "portal_contact_event_property_id_tenant_id_fkey" FOREIGN KEY ("property_id", "tenant_id") REFERENCES "property"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_contact_event" ADD CONSTRAINT "portal_contact_event_membership_id_tenant_id_fkey" FOREIGN KEY ("membership_id", "tenant_id") REFERENCES "membership"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ───── Integrity checks ─────
ALTER TABLE "membership" ADD CONSTRAINT "membership_public_phones_check" CHECK (
  (public_phone_e164 IS NULL OR public_phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
  AND (whatsapp_e164 IS NULL OR whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$')
);
ALTER TABLE "portal_enquiry" ADD CONSTRAINT "portal_enquiry_fields_check" CHECK (
  phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  AND consent_contact
  AND char_length(full_name) BETWEEN 1 AND 120
  AND char_length(message) BETWEEN 1 AND 2000
);

-- ───── Public portal: read-only view of published listings ─────
-- The public website has no user and no tenant. A transaction opts in with
-- app.public_portal = 'on' (only withPublicPortal does this) and then sees, across agencies:
--   * agencies that are active and approved (or need no approval),
--   * active memberships (the agents) of those agencies whose user is not suspended,
--   * listings that are active, not deleted, still fresh, assigned to an active agent of an
--     active agency, and carry an unexpired advertising permit,
--   * unexpired permits.
-- Only SELECT is granted this way. Columns are chosen by the API (never owner data, unit numbers,
-- internal notes or emails). Nothing else that is tenant-scoped becomes visible.
CREATE FUNCTION app_is_public_portal() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(current_setting('app.public_portal', true), '') = 'on' $$;
GRANT EXECUTE ON FUNCTION app_is_public_portal() TO propforce_app;

CREATE POLICY public_portal_read ON "agency" FOR SELECT
  USING (
    app_is_public_portal()
    AND status = 'active'
    AND approval_status IN ('not_required', 'approved')
  );

-- "user" has no row-level security; the subquery only checks the platform suspension flag.
CREATE POLICY public_portal_read ON "membership" FOR SELECT
  USING (
    app_is_public_portal()
    AND status = 'active'
    AND EXISTS (SELECT 1 FROM "user" u WHERE u.id = membership.user_id AND u.suspended_at IS NULL)
  );

CREATE POLICY public_portal_read ON "property_permit" FOR SELECT
  USING (app_is_public_portal() AND valid_until >= current_date);

CREATE POLICY public_portal_read ON "property" FOR SELECT
  USING (
    app_is_public_portal()
    AND status = 'active'
    AND deleted_at IS NULL
    AND listing_expires_at > now()
    AND assigned_membership_id IS NOT NULL
    -- These subqueries are themselves filtered by the public policies above.
    AND EXISTS (SELECT 1 FROM "agency" a WHERE a.id = property.tenant_id)
    AND EXISTS (
      SELECT 1 FROM "membership" m
      WHERE m.id = property.assigned_membership_id AND m.tenant_id = property.tenant_id
    )
    AND EXISTS (
      SELECT 1 FROM "property_permit" pp
      WHERE pp.property_id = property.id AND pp.tenant_id = property.tenant_id
    )
  );

-- ───── Enquiries and contact clicks ─────
GRANT SELECT, INSERT, UPDATE ON "portal_enquiry" TO propforce_app;
GRANT SELECT, INSERT ON "portal_contact_event" TO propforce_app;
GRANT SELECT, INSERT, DELETE ON "public_rate_hit" TO propforce_app;
GRANT USAGE ON SEQUENCE "public_rate_hit_id_seq" TO propforce_app;

ALTER TABLE "portal_enquiry"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_enquiry"       FORCE ROW LEVEL SECURITY;
ALTER TABLE "portal_contact_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_contact_event" FORCE ROW LEVEL SECURITY;

-- The agency sees and works its own enquiries.
CREATE POLICY tenant_isolation ON "portal_enquiry" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON "portal_contact_event" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- The public portal may only add rows (never read them back), and only for a publicly visible
-- listing, filed under that listing's agency and its assigned agent.
CREATE POLICY public_portal_insert ON "portal_enquiry" FOR INSERT
  WITH CHECK (
    app_is_public_portal()
    AND EXISTS (
      SELECT 1 FROM "property" p
      WHERE p.id = portal_enquiry.property_id
        AND p.tenant_id = portal_enquiry.tenant_id
        AND p.assigned_membership_id = portal_enquiry.membership_id
    )
  );
CREATE POLICY public_portal_insert ON "portal_contact_event" FOR INSERT
  WITH CHECK (
    app_is_public_portal()
    AND EXISTS (
      SELECT 1 FROM "property" p
      WHERE p.id = portal_contact_event.property_id
        AND p.tenant_id = portal_contact_event.tenant_id
        AND p.assigned_membership_id = portal_contact_event.membership_id
    )
  );
