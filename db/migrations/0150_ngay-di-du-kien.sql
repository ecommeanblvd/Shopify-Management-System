-- Ngày đi hàng theo Lark ("Label Created Date"), GIỮ NGUYÊN cả ngày tương lai: Ops hold kiện
-- sang ngày khác thì màn Đóng hàng phải nhảy theo (CEO 22/09/2026). Khác label_created_at —
-- cột đó là mốc ship THỰC, dùng chọn bảng giá/phụ phí xăng nên không nhận ngày tương lai.
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS ngay_di_du_kien timestamp;
