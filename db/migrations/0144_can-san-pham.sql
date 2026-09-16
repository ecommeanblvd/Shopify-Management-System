CREATE TABLE IF NOT EXISTS can_san_pham_quyet_dinh (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sku text NOT NULL,
  can_cu_g numeric(12, 3),
  can_moi_g numeric(12, 3) NOT NULL,
  quyet_dinh text NOT NULL,
  ket_qua text,
  loi text,
  variant_ids text[] NOT NULL DEFAULT '{}',
  quyet_by text,
  quyet_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS can_san_pham_quyet_dinh_sku_idx ON can_san_pham_quyet_dinh (store_id, sku);
INSERT INTO feature_flags (feature_key, store_id, enabled)
  SELECT 'product-weights', id, true FROM stores WHERE shop_domain = 'meanblvd.myshopify.com'
  ON CONFLICT (feature_key, store_id) DO NOTHING;
