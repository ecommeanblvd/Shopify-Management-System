ALTER TABLE ship_ho_orders ADD COLUMN IF NOT EXISTS lark_record_id text;
ALTER TABLE ship_ho_orders ADD COLUMN IF NOT EXISTS lark_order_number text;
ALTER TABLE ship_ho_orders ADD COLUMN IF NOT EXISTS lark_synced_at timestamp;
CREATE UNIQUE INDEX IF NOT EXISTS ship_ho_orders_lark_record_idx ON ship_ho_orders (lark_record_id) WHERE lark_record_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ship_ho_orders_tracking_idx ON ship_ho_orders (tracking_number);
