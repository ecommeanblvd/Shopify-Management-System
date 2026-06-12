/** Thêm cột step_floor_kg cho carrier_surcharges. Chạy: dotenv -- tsx scripts/migrate-surcharge-step-floor.ts */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
async function main() {
  await db.execute(sql`ALTER TABLE carrier_surcharges ADD COLUMN IF NOT EXISTS step_floor_kg numeric(10,3)`);
  console.log('OK: carrier_surcharges thêm step_floor_kg.');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
