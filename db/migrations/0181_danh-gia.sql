-- Module Trustpilot Review (CEO duyệt 28/09) — xem docs/superpowers/specs/2026-09-28-danh-gia-design.md
--
-- MỘT bảng, không bảng con: 45 bản ghi trong 17 tháng (2,6 ca/tháng) và một ô
-- `Follow-up & Resolution` duy nhất — thêm bảng ghi chú append-only là làm nặng vô ích.
--
-- `vendor` LƯU THÀNH CỘT chứ không suy lúc hiển thị: một đơn có thể nhiều brand,
-- và đếm một đánh giá cho hai brand là đúng lỗi cộng trùng đã sửa ở module sự cố.

CREATE TABLE IF NOT EXISTS danh_gia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ma_danh_gia text NOT NULL UNIQUE,
  ngay date NOT NULL,
  -- 1–5, số NGUYÊN. Kiểm ở features/danh-gia/phan-loai.ts (4.5 là dữ liệu sai,
  -- không phải nửa sao).
  so_sao integer NOT NULL,
  -- 40% dòng Lark để trống cột trang đánh giá nên nullable, KHÔNG ép về 'khac'.
  trang text,
  -- Lời KHÁCH viết.
  noi_dung text,
  -- Phân tích của CX. Tách hẳn khỏi `noi_dung`: bảng Lark dồn cả hai vào một ô
  -- `Reason`, có ca là lời khách bằng tiếng Anh, có ca là ghi chú CX bằng tiếng Việt.
  ghi_chu_cx text,
  trang_thai text,
  kenh_lien_he text,
  -- Đã lọc rác: 22/45 dòng Lark trả về cả 75 quốc gia thay vì một nước.
  quoc_gia text,
  khach_email text,
  khach_ten text,
  store_id uuid REFERENCES stores(id) ON DELETE SET NULL,
  order_id uuid REFERENCES shopify_orders(id) ON DELETE SET NULL,
  -- Giữ chuỗi mã đơn kể cả khi chưa nối được (chỉ 28/39 mã khớp hệ thống).
  ma_don text,
  -- Trống = chưa rõ brand (đơn nhiều vendor, hoặc không nối được đơn).
  vendor text,
  theo_doi text,
  lark_record_id text UNIQUE,
  tao_boi text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS danh_gia_sao_idx ON danh_gia(so_sao);
CREATE INDEX IF NOT EXISTS danh_gia_ngay_idx ON danh_gia(ngay DESC);
CREATE INDEX IF NOT EXISTS danh_gia_vendor_idx ON danh_gia(vendor);
CREATE INDEX IF NOT EXISTS danh_gia_trang_thai_idx ON danh_gia(trang_thai);
