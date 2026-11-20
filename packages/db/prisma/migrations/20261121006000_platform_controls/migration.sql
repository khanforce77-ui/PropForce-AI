-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('not_required', 'pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "agency" ADD COLUMN     "approval_status" "ApprovalStatus" NOT NULL DEFAULT 'not_required',
ADD COLUMN     "listing_limit" INTEGER,
ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'trial',
ADD COLUMN     "reviewed_at" TIMESTAMPTZ(3),
ADD COLUMN     "reviewed_by" UUID,
ADD COLUMN     "seat_limit" INTEGER,
ADD COLUMN     "status_reason" TEXT;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "suspended_at" TIMESTAMPTZ(3),
ADD COLUMN     "suspended_reason" TEXT;

-- CreateTable
CREATE TABLE "platform_audit_log" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_audit_log_created_at_idx" ON "platform_audit_log"("created_at" DESC);


-- ───── Grants ─────
-- Platform admins manage feature flags and platform settings (stored as flags).
GRANT INSERT, UPDATE ON "feature_flag" TO propforce_app;
-- The platform audit log is append-only for the application.
GRANT SELECT, INSERT ON "platform_audit_log" TO propforce_app;

ALTER TABLE "agency" ADD CONSTRAINT "agency_limits_check" CHECK (
  (seat_limit IS NULL OR seat_limit >= 1) AND (listing_limit IS NULL OR listing_limit >= 0)
);

-- ───── Platform settings and flags ─────
INSERT INTO "feature_flag" ("key", "description", "enabled", "updated_at") VALUES
  ('platform.require_agency_approval',
   'New agencies wait for platform admin approval after onboarding before they become active.',
   false, now()),
  ('platform.allow_signups',
   'Anyone can register a new agency. Turn off to stop new sign-ups.',
   true, now()),
  ('voice.outbound_calls',
   'Outbound AI voice calls. Keep off until telemarketing approvals are verified.',
   false, now())
ON CONFLICT ("key") DO NOTHING;
