/**
 * Re-sync đơn Shopify (bulk backfill 365 ngày) để kéo ĐỊA CHỈ ĐẦY ĐỦ (street)
 * sau khi mở rộng query — phục vụ verify FedEx Address Validation. Idempotent
 * (upsert). Chạy lần lượt từng store (Shopify chỉ cho 1 bulk op/shop).
 *   railway run -- npx tsx scripts/resync-shopify-addresses.ts
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { runBackfillForStore } from '@/features/shopify-orders/backfill/run-backfill';

async function main(): Promise<void> {
  // Tùy chọn: truyền storeId để chỉ re-sync 1 store (vd store lớn chạy riêng).
  const onlyStore = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
  const all = await db.select({ id: schema.stores.id, name: schema.stores.name, status: schema.stores.status })
    .from(schema.stores).where(eq(schema.stores.status, 'active'));
  const stores = onlyStore ? all.filter((s) => s.id === onlyStore) : all;
  console.log(`Re-sync ${stores.length} store active...\n`);
  // This script's job is to REFRESH addresses on orders already in the DB, so it
  // must re-fetch the recent window (not the dedup default, which would skip them).
  const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  let total = 0;
  for (const s of stores) {
    try {
      const res = await runBackfillForStore(s.id, { filterClause: `created_at:>=${since}` });
      total += res.ordersIngested;
      console.log(`✓ ${s.name}: ${res.ordersIngested} đơn (${Math.round(res.durationMs / 1000)}s)`);
    } catch (e) {
      console.log(`✗ ${s.name}: LỖI ${(e as Error).message.slice(0, 80)}`);
    }
  }
  console.log(`\nTổng đơn re-sync: ${total}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
