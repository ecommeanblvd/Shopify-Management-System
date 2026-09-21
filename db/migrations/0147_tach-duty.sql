-- db/migrations/0147_tach-duty.sql
-- Tách thuế/phí nhập khẩu (duty) khỏi cước ship hộ (spec 2026-09-21).
DO $$ BEGIN
  CREATE TYPE ship_ho_statement_type AS ENUM ('freight', 'duty');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE ship_ho_statements ADD COLUMN IF NOT EXISTS type ship_ho_statement_type NOT NULL DEFAULT 'freight';
ALTER TABLE ship_ho_orders ADD COLUMN IF NOT EXISTS actual_duty_vnd numeric(14,2);
ALTER TABLE ship_ho_orders ADD COLUMN IF NOT EXISTS duty_bill_numbers text[];
ALTER TABLE ship_ho_orders ADD COLUMN IF NOT EXISTS duty_statement_id uuid REFERENCES ship_ho_statements(id);
CREATE INDEX IF NOT EXISTS ship_ho_orders_duty_statement_idx ON ship_ho_orders(duty_statement_id);
