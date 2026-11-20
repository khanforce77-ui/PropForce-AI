-- CreateEnum
CREATE TYPE "WhatsAppAccountStatus" AS ENUM ('active', 'disconnected');

-- CreateEnum
CREATE TYPE "ConversationMode" AS ENUM ('ai', 'human');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "MessageAuthor" AS ENUM ('client', 'ai', 'agent', 'system');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('received', 'sent', 'delivered', 'read', 'failed');

-- CreateTable
CREATE TABLE "whatsapp_account" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "waba_id" TEXT NOT NULL,
    "phone_number_id" TEXT NOT NULL,
    "display_phone_number" TEXT NOT NULL,
    "access_token_enc" BYTEA NOT NULL,
    "status" "WhatsAppAccountStatus" NOT NULL DEFAULT 'active',
    "connected_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "whatsapp_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "whatsapp_account_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "mode" "ConversationMode" NOT NULL DEFAULT 'ai',
    "assigned_membership_id" UUID,
    "last_inbound_at" TIMESTAMPTZ(3),
    "last_message_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unread_count" INTEGER NOT NULL DEFAULT 0,
    "state" JSONB NOT NULL DEFAULT '{}',
    "summary" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "author" "MessageAuthor" NOT NULL,
    "author_user_id" UUID,
    "wamid" TEXT,
    "type" TEXT NOT NULL,
    "body" TEXT,
    "media_id" TEXT,
    "media_mime_type" TEXT,
    "status" "MessageStatus" NOT NULL,
    "error_code" INTEGER,
    "status_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_account_phone_number_id_key" ON "whatsapp_account"("phone_number_id");

-- CreateIndex
CREATE INDEX "whatsapp_account_tenant_id_idx" ON "whatsapp_account"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_account_id_tenant_id_key" ON "whatsapp_account"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "conversation_tenant_id_last_message_at_idx" ON "conversation"("tenant_id", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX "conversation_tenant_id_assigned_membership_id_idx" ON "conversation"("tenant_id", "assigned_membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_tenant_id_whatsapp_account_id_contact_id_key" ON "conversation"("tenant_id", "whatsapp_account_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_id_tenant_id_key" ON "conversation"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "message_tenant_id_conversation_id_created_at_idx" ON "message"("tenant_id", "conversation_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "message_tenant_id_wamid_key" ON "message"("tenant_id", "wamid");

-- AddForeignKey
ALTER TABLE "whatsapp_account" ADD CONSTRAINT "whatsapp_account_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_whatsapp_account_id_tenant_id_fkey" FOREIGN KEY ("whatsapp_account_id", "tenant_id") REFERENCES "whatsapp_account"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_contact_id_tenant_id_fkey" FOREIGN KEY ("contact_id", "tenant_id") REFERENCES "contact"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_assigned_membership_id_tenant_id_fkey" FOREIGN KEY ("assigned_membership_id", "tenant_id") REFERENCES "membership"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_conversation_id_tenant_id_fkey" FOREIGN KEY ("conversation_id", "tenant_id") REFERENCES "conversation"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ───── Integrity ─────
ALTER TABLE "whatsapp_account" ADD CONSTRAINT "whatsapp_account_ids_check"
  CHECK ("phone_number_id" ~ '^[0-9]{1,32}$' AND "waba_id" ~ '^[0-9]{1,32}$');
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_unread_check" CHECK ("unread_count" >= 0);
ALTER TABLE "message" ADD CONSTRAINT "message_author_direction_check" CHECK (
  ("direction" = 'inbound' AND "author" = 'client')
  OR ("direction" = 'outbound' AND "author" IN ('ai', 'agent', 'system'))
);

-- ───── Grants ─────
-- Accounts are disconnected (status), never deleted by the application.
GRANT SELECT, INSERT, UPDATE ON "whatsapp_account" TO propforce_app;
GRANT SELECT, INSERT, UPDATE ON "conversation" TO propforce_app;
-- Messages are never deleted by the application; status changes are updates.
GRANT SELECT, INSERT, UPDATE ON "message" TO propforce_app;

-- ───── Row-level security (fail closed) ─────
ALTER TABLE "whatsapp_account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_account" FORCE ROW LEVEL SECURITY;
ALTER TABLE "conversation"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversation"     FORCE ROW LEVEL SECURITY;
ALTER TABLE "message"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message"          FORCE ROW LEVEL SECURITY;

-- Webhooks arrive before the agency is known. The router sets app.wa_phone_number_id for one
-- query and may then read only the account row for that number (to learn its tenant).
CREATE POLICY whatsapp_account_select ON "whatsapp_account" FOR SELECT
  USING (
    tenant_id = app_current_tenant()
    OR phone_number_id = nullif(current_setting('app.wa_phone_number_id', true), '')
  );
CREATE POLICY whatsapp_account_insert ON "whatsapp_account" FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY whatsapp_account_update ON "whatsapp_account" FOR UPDATE
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON "conversation" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON "message" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
