-- UAE cost calculator: fee rules. Rows without a tenant are PropForce templates, seeded as
-- UNVERIFIED samples (never facts); an agency overrides one by adding its own row with the same
-- emirate + code, and can mark it verified.
CREATE TABLE "fee_rule" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "emirate" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "calculators" TEXT[] NOT NULL,
    "payer" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "rate_pct" DECIMAL(7,4),
    "amount" DECIMAL(12,2),
    "vat" BOOLEAN NOT NULL DEFAULT false,
    "refundable" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unverified_sample',
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(3),
    "effective_from" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fee_rule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fee_rule_check" CHECK (
      payer IN ('buyer', 'seller', 'tenant', 'landlord')
      AND basis IN ('price', 'loan', 'annual_rent')
      AND status IN ('unverified_sample', 'verified')
      AND (rate_pct IS NULL OR rate_pct BETWEEN 0 AND 100)
      AND (amount IS NULL OR amount >= 0)
      AND (rate_pct IS NOT NULL OR amount IS NOT NULL)
      AND calculators <@ ARRAY['ready_sale', 'off_plan_sale', 'mortgage', 'rental', 'commercial_rental']
      AND length(code) BETWEEN 1 AND 60 AND length(label) BETWEEN 1 AND 120
      AND length(source) BETWEEN 1 AND 500
      AND (status = 'unverified_sample' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL))
    )
);

CREATE INDEX "fee_rule_tenant_id_emirate_idx" ON "fee_rule"("tenant_id", "emirate");
CREATE UNIQUE INDEX "fee_rule_template_key" ON "fee_rule"("emirate", "code") WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX "fee_rule_tenant_key" ON "fee_rule"("tenant_id", "emirate", "code") WHERE tenant_id IS NOT NULL;

ALTER TABLE "fee_rule" ADD CONSTRAINT "fee_rule_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───── Row-level security ─────
GRANT SELECT, INSERT, UPDATE, DELETE ON "fee_rule" TO propforce_app;
ALTER TABLE "fee_rule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fee_rule" FORCE ROW LEVEL SECURITY;

-- Templates are readable by every agency; an agency reads and writes only its own overrides.
CREATE POLICY template_read ON "fee_rule" FOR SELECT
  USING (tenant_id IS NULL AND app_current_tenant() IS NOT NULL);
CREATE POLICY tenant_isolation ON "fee_rule" FOR ALL
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY platform_admin_read ON "fee_rule" FOR SELECT
  USING (app_is_platform_admin());

-- Sample templates. Values are typical published figures, NOT verified: each agency must check
-- and confirm them (or enter its own) before quoting them to clients.
INSERT INTO "fee_rule" ("id", "tenant_id", "emirate", "code", "label", "calculators", "payer", "basis", "rate_pct", "amount", "vat", "refundable", "source", "updated_at") VALUES
  (gen_random_uuid(), NULL, 'Dubai', 'dld_transfer', 'DLD transfer fee', ARRAY['ready_sale','mortgage'], 'buyer', 'price', 4, 580, false, false, 'UNVERIFIED – sample. Check with the authority before relying on it.', now()),
  (gen_random_uuid(), NULL, 'Dubai', 'trustee_fee', 'Registration trustee fee', ARRAY['ready_sale','mortgage'], 'buyer', 'price', NULL, 4000, true, false, 'UNVERIFIED – sample. Check with the authority before relying on it.', now()),
  (gen_random_uuid(), NULL, 'Dubai', 'oqood', 'Oqood off-plan registration', ARRAY['off_plan_sale'], 'buyer', 'price', 4, 1150, false, false, 'UNVERIFIED – sample. Check with the authority before relying on it.', now()),
  (gen_random_uuid(), NULL, 'Dubai', 'agency_commission_sale', 'Agency commission', ARRAY['ready_sale','mortgage','off_plan_sale'], 'buyer', 'price', 2, NULL, true, false, 'UNVERIFIED – sample. Check with the authority before relying on it.', now()),
  (gen_random_uuid(), NULL, 'Dubai', 'mortgage_registration', 'Mortgage registration', ARRAY['mortgage'], 'buyer', 'loan', 0.25, 290, false, false, 'UNVERIFIED – sample. Check with the authority before relying on it.', now()),
  (gen_random_uuid(), NULL, 'Dubai', 'bank_arrangement', 'Bank arrangement fee', ARRAY['mortgage'], 'buyer', 'loan', 1, NULL, true, false, 'UNVERIFIED – sample. Check with the authority before relying on it.', now()),
  (gen_random_uuid(), NULL, 'Dubai', 'valuation', 'Bank valuation', ARRAY['mortgage'], 'buyer', 'price', NULL, 3000, true, false, 'UNVERIFIED – sample. Check with the authority before relying on it.', now()),
  (gen_random_uuid(), NULL, 'Dubai', 'ejari', 'Ejari registration', ARRAY['rental','commercial_rental'], 'tenant', 'annual_rent', NULL, 220, false, false, 'UNVERIFIED – sample. Check with the authority before relying on it.', now()),
  (gen_random_uuid(), NULL, 'Dubai', 'security_deposit', 'Security deposit', ARRAY['rental'], 'tenant', 'annual_rent', 5, NULL, false, true, 'UNVERIFIED – sample. Check with the authority before relying on it.', now()),
  (gen_random_uuid(), NULL, 'Dubai', 'security_deposit_commercial', 'Security deposit', ARRAY['commercial_rental'], 'tenant', 'annual_rent', 10, NULL, false, true, 'UNVERIFIED – sample. Check with the authority before relying on it.', now()),
  (gen_random_uuid(), NULL, 'Dubai', 'agency_commission_rent', 'Agency commission', ARRAY['rental','commercial_rental'], 'tenant', 'annual_rent', 5, NULL, true, false, 'UNVERIFIED – sample. Check with the authority before relying on it.', now()),
  (gen_random_uuid(), NULL, 'Dubai', 'dewa_deposit', 'DEWA deposit', ARRAY['rental'], 'tenant', 'annual_rent', NULL, 2000, false, true, 'UNVERIFIED – sample. Check with the authority before relying on it.', now()),
  (gen_random_uuid(), NULL, 'Dubai', 'commercial_rent_vat', 'VAT on commercial rent', ARRAY['commercial_rental'], 'tenant', 'annual_rent', 5, NULL, false, false, 'UNVERIFIED – sample. Check with the authority before relying on it.', now()),
  (gen_random_uuid(), NULL, 'Abu Dhabi', 'adrec_transfer', 'Transfer fee', ARRAY['ready_sale','mortgage'], 'buyer', 'price', 2, NULL, false, false, 'UNVERIFIED – sample. Check with the authority before relying on it.', now()),
  (gen_random_uuid(), NULL, 'Abu Dhabi', 'off_plan_registration', 'Off-plan registration', ARRAY['off_plan_sale'], 'buyer', 'price', 1, NULL, false, false, 'UNVERIFIED – sample. Check with the authority before relying on it.', now()),
  (gen_random_uuid(), NULL, 'Abu Dhabi', 'agency_commission_sale', 'Agency commission', ARRAY['ready_sale','mortgage','off_plan_sale'], 'buyer', 'price', 2, NULL, true, false, 'UNVERIFIED – sample. Check with the authority before relying on it.', now()),
  (gen_random_uuid(), NULL, 'Abu Dhabi', 'mortgage_registration', 'Mortgage registration', ARRAY['mortgage'], 'buyer', 'loan', 0.1, NULL, false, false, 'UNVERIFIED – sample. Check with the authority before relying on it.', now()),
  (gen_random_uuid(), NULL, 'Abu Dhabi', 'bank_arrangement', 'Bank arrangement fee', ARRAY['mortgage'], 'buyer', 'loan', 1, NULL, true, false, 'UNVERIFIED – sample. Check with the authority before relying on it.', now()),
  (gen_random_uuid(), NULL, 'Abu Dhabi', 'valuation', 'Bank valuation', ARRAY['mortgage'], 'buyer', 'price', NULL, 3000, true, false, 'UNVERIFIED – sample. Check with the authority before relying on it.', now()),
  (gen_random_uuid(), NULL, 'Abu Dhabi', 'tawtheeq', 'Tawtheeq registration', ARRAY['rental','commercial_rental'], 'tenant', 'annual_rent', NULL, 200, false, false, 'UNVERIFIED – sample. Check with the authority before relying on it.', now()),
  (gen_random_uuid(), NULL, 'Abu Dhabi', 'municipality_fee', 'Municipality fee', ARRAY['rental'], 'tenant', 'annual_rent', 3, NULL, false, false, 'UNVERIFIED – sample. Check with the authority before relying on it.', now()),
  (gen_random_uuid(), NULL, 'Abu Dhabi', 'security_deposit', 'Security deposit', ARRAY['rental'], 'tenant', 'annual_rent', 5, NULL, false, true, 'UNVERIFIED – sample. Check with the authority before relying on it.', now()),
  (gen_random_uuid(), NULL, 'Abu Dhabi', 'security_deposit_commercial', 'Security deposit', ARRAY['commercial_rental'], 'tenant', 'annual_rent', 10, NULL, false, true, 'UNVERIFIED – sample. Check with the authority before relying on it.', now()),
  (gen_random_uuid(), NULL, 'Abu Dhabi', 'agency_commission_rent', 'Agency commission', ARRAY['rental','commercial_rental'], 'tenant', 'annual_rent', 5, NULL, true, false, 'UNVERIFIED – sample. Check with the authority before relying on it.', now()),
  (gen_random_uuid(), NULL, 'Abu Dhabi', 'commercial_rent_vat', 'VAT on commercial rent', ARRAY['commercial_rental'], 'tenant', 'annual_rent', 5, NULL, false, false, 'UNVERIFIED – sample. Check with the authority before relying on it.', now());
