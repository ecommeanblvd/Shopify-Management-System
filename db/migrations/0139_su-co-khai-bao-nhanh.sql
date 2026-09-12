ALTER TABLE ship_ho_orders ADD COLUMN IF NOT EXISTS brand_reference text;
CREATE INDEX IF NOT EXISTS ship_ho_orders_brand_ref_idx ON ship_ho_orders (brand_reference) WHERE brand_reference IS NOT NULL;

ALTER TABLE ship_ho_su_co ADD COLUMN IF NOT EXISTS dien_bien jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ship_ho_su_co ADD COLUMN IF NOT EXISTS da_chot_tien boolean NOT NULL DEFAULT false;
UPDATE ship_ho_su_co SET da_chot_tien = true WHERE tong_chi_phi_vnd > 0 AND da_chot_tien = false;
