ALTER TABLE shipments ADD COLUMN IF NOT EXISTS ly_do_doi_chieu text;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS ly_do_bang_chung text;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS ly_do_doi_chieu_at timestamp;
ALTER TABLE ship_ho_orders ADD COLUMN IF NOT EXISTS ly_do_doi_chieu text;
ALTER TABLE ship_ho_orders ADD COLUMN IF NOT EXISTS ly_do_bang_chung text;
ALTER TABLE ship_ho_orders ADD COLUMN IF NOT EXISTS ly_do_doi_chieu_at timestamp;
