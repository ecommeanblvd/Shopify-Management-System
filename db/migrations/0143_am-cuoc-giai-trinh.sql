CREATE TABLE IF NOT EXISTS am_cuoc_giai_trinh (
  order_id uuid PRIMARY KEY REFERENCES shopify_orders(id) ON DELETE CASCADE,
  ly_do text NOT NULL,
  thuoc_ve text NOT NULL,
  chi_tiet jsonb NOT NULL DEFAULT '{}'::jsonb,
  ghi_chu text,
  nguon text NOT NULL DEFAULT 'tay',
  created_by text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS am_cuoc_giai_trinh_thuoc_ve_idx ON am_cuoc_giai_trinh (thuoc_ve);
