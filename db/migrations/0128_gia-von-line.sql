-- Giá vốn theo LINE đơn (spec docs/superpowers/specs/2026-09-08-gia-von-lai-gop-thang-design.md §3).
-- Hàng brand ký gửi: giá vốn = tiền trả brand theo bảng kê, biến thiên theo dòng
-- và gắn với KỲ thanh toán (tháng thực nhận), không gắn với ngày đặt.
CREATE TABLE order_line_cogs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES shopify_orders(id) ON DELETE CASCADE,
  shopify_line_id text NOT NULL,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'cogs',            -- 'cogs' | 'return' (return: amount âm)
  period text NOT NULL,                          -- 'YYYY-MM'
  amount numeric(14,2) NOT NULL,
  currency text NOT NULL,
  source text NOT NULL,                          -- 'brand_statement' | 'mmp' | 'csv' | 'shopify_unit_cost'
  brand_slug text,
  statement_ref text,
  detail jsonb,
  imported_by text REFERENCES "user"(id) ON DELETE SET NULL,
  imported_at timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX order_line_cogs_line_kind_period_idx ON order_line_cogs (order_id, shopify_line_id, kind, period);--> statement-breakpoint
CREATE INDEX order_line_cogs_period_idx ON order_line_cogs (period);--> statement-breakpoint
CREATE INDEX order_line_cogs_brand_period_idx ON order_line_cogs (brand_slug, period);--> statement-breakpoint
-- Dòng bảng kê không thuộc đơn Shopify (#MBLVDPO…, #MTB…): báo riêng, không trừ Rev Shopify.
CREATE TABLE brand_cogs_offline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_slug text NOT NULL,
  period text NOT NULL,
  kind text NOT NULL DEFAULT 'cogs',
  ref_code text NOT NULL,
  sku text,
  qty integer NOT NULL DEFAULT 1,
  amount numeric(14,2) NOT NULL,
  currency text NOT NULL,
  statement_ref text,
  imported_at timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX brand_cogs_offline_brand_period_idx ON brand_cogs_offline (brand_slug, period);--> statement-breakpoint
-- Tỉ giá THEO THÁNG để đổi doanh thu (USD) về VND. Một dòng/tháng/cặp tiền.
CREATE TABLE fx_month_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_currency text NOT NULL,
  to_currency text NOT NULL,
  period text NOT NULL,
  rate numeric(18,6) NOT NULL,                   -- 1 from = rate to
  source text NOT NULL DEFAULT 'manual',         -- 'manual' | 'vcb'
  updated_at timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX fx_month_rates_pair_period_idx ON fx_month_rates (from_currency, to_currency, period);
