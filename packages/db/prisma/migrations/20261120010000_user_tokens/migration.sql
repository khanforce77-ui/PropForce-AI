
-- CreateEnum
CREATE TYPE "UserTokenType" AS ENUM ('email_verification', 'password_reset');

-- CreateTable
CREATE TABLE "user_token" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "UserTokenType" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_token_token_hash_key" ON "user_token"("token_hash");

-- CreateIndex
CREATE INDEX "user_token_user_id_type_idx" ON "user_token"("user_id", "type");

-- AddForeignKey
ALTER TABLE "user_token" ADD CONSTRAINT "user_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Platform table (no tenant_id): accessed only by the auth module.
GRANT SELECT, INSERT, UPDATE, DELETE ON "user_token" TO propforce_app;
