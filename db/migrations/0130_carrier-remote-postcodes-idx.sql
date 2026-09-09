-- Trang Orders tải chậm (đo 09/09/2026): engine ước phí ship nạp ODA cho 5 carrier account, mỗi lượt quét ~81k dòng của các
-- nước trong trang rồi mới lọc theo mã bưu chính (1,4 s/account server-side). load.ts nay tách truy vấn thành 3 nhánh; hai nhánh
-- sau cần index mới:
--   (b) mã rút gọn (bỏ ký tự ngăn cách) → index biểu thức;
--   (c) dòng ghi TÊN THÀNH PHỐ thay mã (không có chữ số, ~24k dòng) → index từng phần.
-- Tìm kiếm đơn theo mã/tên khách (ILIKE '%…%') quét tuần tự 9k đơn ~0,8 s → GIN trigram.
CREATE INDEX IF NOT EXISTS carrier_remote_postcodes_account_country_rutgon_idx
  ON carrier_remote_postcodes (carrier_account_id, country_code, (upper(regexp_replace(postcode_pattern, '[^A-Za-z0-9]', '', 'g'))));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS carrier_remote_postcodes_thanh_pho_idx
  ON carrier_remote_postcodes (carrier_account_id, country_code)
  WHERE postcode_pattern !~ '[0-9]';--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS shopify_orders_number_trgm_idx ON shopify_orders USING gin (shopify_order_number gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS shopify_orders_ship_name_trgm_idx ON shopify_orders USING gin (ship_name gin_trgm_ops);
