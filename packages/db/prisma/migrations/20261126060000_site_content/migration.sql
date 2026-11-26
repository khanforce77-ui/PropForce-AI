-- CreateTable
CREATE TABLE "site_setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "site_setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "site_banner" (
    "id" UUID NOT NULL,
    "placement" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'banner',
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "cta_label" TEXT,
    "link_url" TEXT,
    "advertiser" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "image" BYTEA,
    "image_width" INTEGER,
    "image_height" INTEGER,
    "image_sha256" TEXT,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "site_banner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_banner_placement_active_sort_order_idx" ON "site_banner"("placement", "active", "sort_order");

ALTER TABLE "site_setting" ADD CONSTRAINT "site_setting_key_check" CHECK (key IN ('portal', 'platform'));

ALTER TABLE "site_banner" ADD CONSTRAINT "site_banner_check" CHECK (
  placement IN ('home_hero', 'home_strip', 'search_top', 'listing_sidebar')
  AND kind IN ('banner', 'ad')
  AND char_length(title) BETWEEN 1 AND 120
  AND (link_url IS NULL OR link_url ~ '^(https://|/)')
  AND (image IS NULL OR octet_length(image) BETWEEN 1 AND 3145728)
  AND (image_sha256 IS NULL OR image_sha256 ~ '^[0-9a-f]{64}$')
  AND (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at)
  AND clicks >= 0
);

-- ───── Grants ─────
-- Platform-wide content, not tenant data: no row-level security. Only platform-admin routes
-- write it; the public portal reads what is active.
GRANT SELECT, INSERT, UPDATE ON "site_setting" TO propforce_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "site_banner" TO propforce_app;
