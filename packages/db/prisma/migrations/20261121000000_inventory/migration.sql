-- CreateEnum
CREATE TYPE "ListingType" AS ENUM ('sale', 'rent');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('apartment', 'villa', 'townhouse', 'penthouse', 'office', 'retail', 'commercial', 'land', 'other');

-- CreateEnum
CREATE TYPE "Completion" AS ENUM ('ready', 'off_plan');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('draft', 'active', 'under_offer', 'sold', 'rented', 'archived');

-- CreateEnum
CREATE TYPE "Furnishing" AS ENUM ('unfurnished', 'semi_furnished', 'furnished');

-- CreateEnum
CREATE TYPE "RentPeriod" AS ENUM ('yearly', 'monthly');

-- AlterTable
ALTER TABLE "agency_settings" ADD COLUMN     "require_permit_to_publish" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "project" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "developer" TEXT,
    "emirate" TEXT NOT NULL,
    "community" TEXT,
    "handover_date" DATE,
    "payment_plan" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "listing_type" "ListingType" NOT NULL,
    "property_type" "PropertyType" NOT NULL,
    "completion" "Completion" NOT NULL DEFAULT 'ready',
    "status" "PropertyStatus" NOT NULL DEFAULT 'draft',
    "project_id" UUID,
    "assigned_membership_id" UUID,
    "title" TEXT,
    "emirate" TEXT NOT NULL,
    "community" TEXT,
    "sub_community" TEXT,
    "building" TEXT,
    "unit_no" TEXT,
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "area_sqft" DECIMAL(10,2),
    "price" DECIMAL(14,2),
    "rent_period" "RentPeriod",
    "furnishing" "Furnishing",
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "parking" INTEGER,
    "floor" INTEGER,
    "view" TEXT,
    "developer" TEXT,
    "handover_date" DATE,
    "payment_plan" JSONB,
    "service_charge_per_sqft" DECIMAL(8,2),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "description" TEXT,
    "listing_expires_at" TIMESTAMPTZ(3),
    "verified_at" TIMESTAMPTZ(3),
    "verified_by" UUID,
    "created_by" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_permit" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "authority" TEXT NOT NULL,
    "permit_number" TEXT NOT NULL,
    "valid_until" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_permit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_tenant_id_name_key" ON "project"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "project_id_tenant_id_key" ON "project"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "property_tenant_id_status_listing_type_idx" ON "property"("tenant_id", "status", "listing_type");

-- CreateIndex
CREATE INDEX "property_tenant_id_emirate_community_idx" ON "property"("tenant_id", "emirate", "community");

-- CreateIndex
CREATE INDEX "property_tenant_id_assigned_membership_id_idx" ON "property"("tenant_id", "assigned_membership_id");

-- CreateIndex
CREATE INDEX "property_tenant_id_created_at_idx" ON "property"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "property_tenant_id_reference_key" ON "property"("tenant_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "property_id_tenant_id_key" ON "property"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "property_permit_property_id_idx" ON "property_permit"("property_id");

-- CreateIndex
CREATE UNIQUE INDEX "property_permit_tenant_id_authority_permit_number_key" ON "property_permit"("tenant_id", "authority", "permit_number");

-- CreateIndex
CREATE UNIQUE INDEX "membership_id_tenant_id_key" ON "membership"("id", "tenant_id");

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property" ADD CONSTRAINT "property_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property" ADD CONSTRAINT "property_project_id_tenant_id_fkey" FOREIGN KEY ("project_id", "tenant_id") REFERENCES "project"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property" ADD CONSTRAINT "property_assigned_membership_id_tenant_id_fkey" FOREIGN KEY ("assigned_membership_id", "tenant_id") REFERENCES "membership"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_permit" ADD CONSTRAINT "property_permit_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_permit" ADD CONSTRAINT "property_permit_property_id_tenant_id_fkey" FOREIGN KEY ("property_id", "tenant_id") REFERENCES "property"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ───── Integrity checks ─────
ALTER TABLE "property" ADD CONSTRAINT "property_numbers_check" CHECK (
  (bedrooms IS NULL OR bedrooms BETWEEN 0 AND 50)
  AND (bathrooms IS NULL OR bathrooms BETWEEN 0 AND 50)
  AND (area_sqft IS NULL OR area_sqft > 0)
  AND (price IS NULL OR price > 0)
  AND (rent_period IS NULL OR listing_type = 'rent')
);

-- ───── Row-level security ─────
GRANT SELECT, INSERT, UPDATE, DELETE ON "project", "property", "property_permit" TO propforce_app;

ALTER TABLE "project"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project"         FORCE ROW LEVEL SECURITY;
ALTER TABLE "property"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "property"        FORCE ROW LEVEL SECURITY;
ALTER TABLE "property_permit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "property_permit" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "project" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON "property" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON "property_permit" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
