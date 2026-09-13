ALTER TABLE carrier_bill_lines ADD COLUMN IF NOT EXISTS return_of_ship_ho_order_id uuid REFERENCES ship_ho_orders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS carrier_bill_lines_return_of_ship_ho_idx ON carrier_bill_lines (return_of_ship_ho_order_id);
