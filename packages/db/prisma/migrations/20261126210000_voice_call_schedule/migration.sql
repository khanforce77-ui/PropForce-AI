-- Scheduled and bulk AI calls: when a queued outbound call may ring.
ALTER TABLE "voice_call" ADD COLUMN "scheduled_at" TIMESTAMPTZ(3);
