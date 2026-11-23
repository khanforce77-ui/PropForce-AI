-- Embedded Signup tokens can expire (e.g. 60 days): track it so agencies reconnect in time.
ALTER TABLE "whatsapp_account" ADD COLUMN "token_expires_at" TIMESTAMPTZ(3);
