/** Thêm enum value 'disputing' (đang đòi NCC). Chạy: dotenv -- tsx scripts/migrate-reconcile-disputing.ts */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
async function main() {
  await db.execute(sql`ALTER TYPE reconcile_status ADD VALUE IF NOT EXISTS 'disputing'`);
  console.log('OK: reconcile_status thêm disputing.');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
