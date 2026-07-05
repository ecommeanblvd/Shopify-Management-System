-- Order Journey (spec 2026-07-05): bảng hợp nhất cancel/claim + danh mục hub return.
CREATE TABLE IF NOT EXISTS return_hubs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  recipient_name text NOT NULL,
  address_line1 text NOT NULL,
  address_line2 text,
  city text NOT NULL,
  state text,
  postal_code text,
  country text NOT NULL,
  phone text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_order_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES shopify_orders(id) ON DELETE CASCADE,
  shopify_customer_id text NOT NULL,
  order_number text,
  kind text NOT NULL,
  status text NOT NULL,
  reason_codes text[],
  description text,
  photo_keys text[],
  fault text,
  return_hub_id uuid REFERENCES return_hubs(id),
  return_shipping_payer text,
  return_tracking_number text,
  return_carrier text,
  order_total numeric(14,2) NOT NULL,
  refund_percent integer NOT NULL,
  refund_amount numeric(14,2) NOT NULL,
  currency text NOT NULL,
  admin_note text,
  rejected_reason text,
  reviewed_at timestamp,
  approved_at timestamp,
  tracking_added_at timestamp,
  received_at timestamp,
  qc_at timestamp,
  refunded_at timestamp,
  refunded_marked_by text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_order_requests_store_status_idx ON customer_order_requests(store_id, status);
CREATE INDEX IF NOT EXISTS customer_order_requests_order_idx ON customer_order_requests(order_id);
CREATE INDEX IF NOT EXISTS customer_order_requests_customer_idx ON customer_order_requests(store_id, shopify_customer_id);
