-- Hợp đồng MMP đẩy sang qua API (JSON + HTML): loại, version idempotency, nguồn.
ALTER TABLE "ship_ho_partner_contracts" ADD COLUMN "contract_type" text;
ALTER TABLE "ship_ho_partner_contracts" ADD COLUMN "version" text;
ALTER TABLE "ship_ho_partner_contracts" ADD COLUMN "generated_at" timestamp;
ALTER TABLE "ship_ho_partner_contracts" ADD COLUMN "source" text DEFAULT 'upload' NOT NULL;
-- Cùng brand + cùng version = MỘT bản: push lại chỉ update (idempotent).
CREATE UNIQUE INDEX IF NOT EXISTS "ship_ho_partner_contracts_brand_version_idx"
  ON "ship_ho_partner_contracts" ("partner_brand_slug", "version")
  WHERE "version" IS NOT NULL;
