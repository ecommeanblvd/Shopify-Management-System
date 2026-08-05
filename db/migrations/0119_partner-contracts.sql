-- Hợp đồng ship hộ/fulfillment với đối tác brand (MMP soạn, ops upload).
-- Nhiều bản mỗi đối tác (gốc + phụ lục + gia hạn) — giữ lịch sử, không ghi đè.
CREATE TABLE IF NOT EXISTS "ship_ho_partner_contracts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "partner_brand_slug" text NOT NULL REFERENCES "mmp_brands"("slug"),
  "title" text NOT NULL,
  "file_key" text NOT NULL,
  "filename" text NOT NULL,
  "content_type" text NOT NULL,
  "byte_size" integer NOT NULL,
  "signed_at" date,
  "expires_at" date,
  "note" text,
  "uploaded_at" timestamp DEFAULT now() NOT NULL,
  "uploaded_by" text
);
CREATE INDEX IF NOT EXISTS "ship_ho_partner_contracts_partner_idx"
  ON "ship_ho_partner_contracts" ("partner_brand_slug");
