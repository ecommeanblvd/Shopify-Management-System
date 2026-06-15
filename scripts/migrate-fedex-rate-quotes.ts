/**
 * Tạo bảng fedex_rate_quotes (cache báo giá FedEx Rate API per shipment).
 * Idempotent. Chạy: pnpm exec dotenv -- tsx scripts/migrate-fedex-rate-quotes.ts
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

async function main(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS fedex_rate_quotes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      shipment_id uuid NOT NULL UNIQUE REFERENCES shipments(id) ON DELETE CASCADE,
      service text NOT NULL,
      rate_type text NOT NULL DEFAULT 'ACCOUNT',
      currency text NOT NULL,
      ship_date timestamp,
      total_net_charge numeric(16,2),
      base_charge numeric(16,2),
      fuel numeric(16,2),
      fuel_percent numeric(8,4),
      residential numeric(16,2),
      remote numeric(16,2),
      demand numeric(16,2),
      ancillary numeric(16,2),
      vat numeric(16,2),
      discount numeric(16,2),
      billing_weight_kg numeric(10,3),
      rate_zone text,
      raw jsonb,
      quoted_at timestamp NOT NULL DEFAULT now(),
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS fedex_rate_quotes_shipment_idx ON fedex_rate_quotes(shipment_id)`);
  console.log('✓ fedex_rate_quotes sẵn sàng.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
