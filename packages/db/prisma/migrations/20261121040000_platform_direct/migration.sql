-- AlterTable
ALTER TABLE "agency" ADD COLUMN     "is_platform_owned" BOOLEAN NOT NULL DEFAULT false;

-- At most one platform-owned agency.
CREATE UNIQUE INDEX "agency_one_platform_owned" ON "agency" ("is_platform_owned") WHERE "is_platform_owned";
