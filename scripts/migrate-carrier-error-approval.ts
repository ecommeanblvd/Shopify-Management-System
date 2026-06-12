/**
 * Migration một lần: thêm enum value 'carrier_error' + 2 cột snapshot vào
 * shipment_reconcile_status. Enum ADD VALUE phải chạy NGOÀI transaction và
 * trước khi dùng → tách statement. Idempotent (IF NOT EXISTS).
 *
 * Chạy: dotenv -- tsx scripts/migrate-carrier-error-approval.ts
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

async function main() {
  await db.execute(sql`ALTER TYPE reconcile_status ADD VALUE IF NOT EXISTS 'carrier_error'`);
  await db.execute(sql`ALTER TABLE shipment_reconcile_status ADD COLUMN IF NOT EXISTS carrier_error_kind text`);
  await db.execute(sql`ALTER TABLE shipment_reconcile_status ADD COLUMN IF NOT EXISTS delta_vnd_at_review numeric(16,2)`);
  console.log('OK: carrier_error enum + cột snapshot đã thêm.');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
