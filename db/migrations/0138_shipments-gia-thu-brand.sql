ALTER TABLE shipments ADD COLUMN IF NOT EXISTS brand_charge_vnd numeric(16, 2);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS brand_charge_at timestamp;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS brand_charge_note text;
CREATE INDEX IF NOT EXISTS shipments_brand_charge_idx ON shipments (brand_charge_vnd) WHERE brand_charge_vnd IS NOT NULL;
