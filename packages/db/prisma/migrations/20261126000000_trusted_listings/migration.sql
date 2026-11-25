-- Trusted listings (Dubai): PropForce review before a listing reaches the public portal, permit
-- purpose, a cross-agency duplicate-permit check, and the "Verified agent" badge.

-- CreateEnum
CREATE TYPE "ListingReviewStatus" AS ENUM ('not_required', 'pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "BrokerVerificationStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "membership" ADD COLUMN     "broker_verified_at" TIMESTAMPTZ(3),
ADD COLUMN     "broker_verified_until" DATE;

-- AlterTable
ALTER TABLE "property" ADD COLUMN     "review_reason" TEXT,
ADD COLUMN     "review_status" "ListingReviewStatus" NOT NULL DEFAULT 'not_required',
ADD COLUMN     "reviewed_at" TIMESTAMPTZ(3),
ADD COLUMN     "reviewed_by" UUID,
ADD COLUMN     "submitted_for_review_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "property_permit" ADD COLUMN     "purpose" "ListingType";

-- CreateTable
CREATE TABLE "broker_verification" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "brn" TEXT NOT NULL,
    "brn_expires_at" DATE NOT NULL,
    "status" "BrokerVerificationStatus" NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "card_content_type" TEXT NOT NULL,
    "card_bytes" BYTEA NOT NULL,
    "emirates_id_content_type" TEXT,
    "emirates_id_bytes" BYTEA,
    "submitted_by" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by" UUID,

    CONSTRAINT "broker_verification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "broker_verification_status_submitted_at_idx" ON "broker_verification"("status", "submitted_at");

-- CreateIndex
CREATE INDEX "broker_verification_tenant_id_idx" ON "broker_verification"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "broker_verification_membership_id_tenant_id_key" ON "broker_verification"("membership_id", "tenant_id");

-- CreateIndex
CREATE INDEX "property_review_status_submitted_for_review_at_idx" ON "property"("review_status", "submitted_for_review_at");

-- AddForeignKey
ALTER TABLE "broker_verification" ADD CONSTRAINT "broker_verification_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_verification" ADD CONSTRAINT "broker_verification_membership_id_tenant_id_fkey" FOREIGN KEY ("membership_id", "tenant_id") REFERENCES "membership"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "property" ADD CONSTRAINT "property_review_reason_check" CHECK (
  review_reason IS NULL OR length(review_reason) <= 500
);

ALTER TABLE "broker_verification" ADD CONSTRAINT "broker_verification_check" CHECK (
  length(brn) BETWEEN 1 AND 32
  AND card_content_type IN ('application/pdf', 'image/jpeg')
  AND octet_length(card_bytes) BETWEEN 1 AND 5242880
  AND (emirates_id_bytes IS NULL OR (
    emirates_id_content_type IN ('application/pdf', 'image/jpeg')
    AND octet_length(emirates_id_bytes) BETWEEN 1 AND 5242880
  ))
  AND (reason IS NULL OR length(reason) <= 500)
);

-- ───── Row-level security ─────
GRANT SELECT, INSERT, UPDATE, DELETE ON "broker_verification" TO propforce_app;
ALTER TABLE "broker_verification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "broker_verification" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "broker_verification" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- Platform admins see the review queue across agencies; decisions are written in the agency's
-- tenant context. No public portal policy: the portal only sees membership.broker_verified_until.
CREATE POLICY platform_admin_read ON "broker_verification" FOR SELECT
  USING (app_is_platform_admin());

-- Platform admins see every listing's permits for the review queue.
CREATE POLICY platform_admin_read ON "property_permit" FOR SELECT
  USING (app_is_platform_admin());

-- The public portal shows a listing only once PropForce's review allows it. RESTRICTIVE, so it is
-- added to the existing public_portal_read policy instead of replacing it; other contexts pass.
CREATE POLICY public_portal_review ON "property" AS RESTRICTIVE FOR SELECT
  USING (NOT app_is_public_portal() OR review_status IN ('not_required', 'approved'));

-- Duplicate-permit check across agencies: with app.permit_lookup set to a permit number, the
-- unexpired permits carrying exactly that number become visible (tenant, listing and authority
-- only are read). The API sets it for one query and clears it again.
CREATE POLICY permit_duplicate_lookup ON "property_permit" FOR SELECT
  USING (
    permit_number IS NOT NULL
    AND coalesce(current_setting('app.permit_lookup', true), '') <> ''
    AND permit_number = current_setting('app.permit_lookup', true)
    AND valid_until >= current_date
  );

-- New agencies' listings wait for a PropForce review before they appear on the public portal.
INSERT INTO "feature_flag" ("key", "description", "enabled", "updated_at") VALUES
  ('platform.require_listing_review',
   'New agencies'' listings wait for a PropForce review before they appear on the public portal. Agencies with 10 or more approved listings skip it.',
   true, now())
ON CONFLICT ("key") DO NOTHING;
