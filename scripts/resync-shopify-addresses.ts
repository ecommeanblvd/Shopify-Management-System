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
  const stores = await db.select({ id: schema.stores.id, name: schema.stores.name, status: schema.stores.status })
    .from(schema.stores).where(eq(schema.stores.status, 'active'));
  console.log(`Re-sync ${stores.length} store active...\n`);
  let total = 0;
  for (const s of stores) {
    try {
      const res = await runBackfillForStore(s.id);
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
