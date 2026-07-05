-- Wishlist Page (spec 2026-07-05): catalog sản phẩm cho recommendation + cache identity.
CREATE TABLE IF NOT EXISTS shopify_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  shopify_product_id text NOT NULL,
  title text NOT NULL,
  handle text NOT NULL,
  vendor text,
  product_type text,
  tags text[],
  image_url text,
  price_min numeric(14,2),
  currency text,
  available_for_sale boolean NOT NULL DEFAULT false,
  status text NOT NULL,
  synced_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS shopify_products_store_product_idx ON shopify_products(store_id, shopify_product_id);
CREATE INDEX IF NOT EXISTS shopify_products_store_status_idx ON shopify_products(store_id, status);
CREATE INDEX IF NOT EXISTS shopify_products_store_vendor_idx ON shopify_products(store_id, vendor);

CREATE TABLE IF NOT EXISTS customer_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  shopify_customer_id text NOT NULL,
  email text,
  resolved_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_identities_store_customer_idx ON customer_identities(store_id, shopify_customer_id);
