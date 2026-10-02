-- Link PUBLIC cho brand xem NGUỒN phụ phí ship hộ (CEO 02/10/2026).
--
-- Mục đích: brand nhìn một dòng phụ phí trên bảng kê (vd đối soát tháng 7) và cần biết dòng đó
-- là gì, tính thế nào, căn cứ ở đâu. Phụ phí là pass-through — hãng thu MEAN, MEAN thu lại
-- brand đúng số đó (price-structure.ts: "phụ phí = pass-through cost") — nên công khai mức phụ
-- phí không hở giá vốn hay lãi.
--
-- MỘT LINK SỐNG CHO MỖI BRAND, ép ở TẦNG DB bằng unique index có điều kiện. Không dựa vào mã
-- nhớ thu hồi link cũ: hai link sống cùng lúc là hai thứ phải nhớ thu hồi, và sẽ có cái bị quên
-- — rồi một link tưởng đã chết vẫn mở được.
--
-- Token 32 byte ngẫu nhiên, KHÔNG mang thông tin brand: đoán được một token là đọc được phụ phí
-- của brand khác.

CREATE TABLE IF NOT EXISTS "brand_surcharge_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "partner_brand_slug" text NOT NULL REFERENCES "mmp_brands"("slug"),
  "token" text NOT NULL UNIQUE,
  "created_by" text REFERENCES "user"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "revoked_at" timestamp
);

-- Tra token → brand ở mỗi lượt mở trang. Index CÓ ĐIỀU KIỆN để chỉ quét link còn hiệu lực.
CREATE INDEX IF NOT EXISTS "brand_surcharge_links_token_idx"
  ON "brand_surcharge_links" ("token") WHERE "revoked_at" IS NULL;

-- Ép một-link-sống. Thu hồi xong `revoked_at` khác NULL nên dòng cũ rời khỏi index này.
CREATE UNIQUE INDEX IF NOT EXISTS "brand_surcharge_links_mot_link_song_idx"
  ON "brand_surcharge_links" ("partner_brand_slug") WHERE "revoked_at" IS NULL;
