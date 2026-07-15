/**
 * Re-sync TOÀN BỘ đơn Shopify (all-time) để cập nhật field mới — hiện dùng cho
 * ship rev THỰC NHẬN (shippingLines.discountedPriceSet, sau giảm promo ship).
 * Idempotent (upsert). Chạy tuần tự từng store (Shopify chỉ cho 1 bulk op/shop).
 *
 *   railway run npx tsx scripts/resync-orders-full.ts               # tất cả store active
 *   railway run npx tsx scripts/resync-orders-full.ts tinhatelier   # 1 store (name/domain/id)
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { runBackfillForStore } from '@/features/shopify-orders/backfill/run-backfill';

// created_at ≥ mốc này = mọi đơn (trước ngày công ty tồn tại) → re-fetch + upsert ALL.
const ALL_TIME = 'created_at:>=2015-01-01';

async function main(): Promise<void> {
  const arg = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
  const all = await db
    .select({ id: schema.stores.id, name: schema.stores.name, domain: schema.stores.shopDomain, status: schema.stores.status })
    .from(schema.stores)
    .where(eq(schema.stores.status, 'active'));
  const stores = arg ? all.filter((s) => s.name === arg || s.domain === arg || s.id === arg) : all;

  if (stores.length === 0) { process.stderr.write(`Không tìm thấy store "${arg}".\n`); process.exit(1); }
  process.stdout.write(`Re-sync ${stores.length} store (all-time)...\n`);

  let total = 0;
  for (const s of stores) {
    try {
      const r = await runBackfillForStore(s.id, { filterClause: ALL_TIME });
      total += r.ordersIngested;
      process.stdout.write(`  ✓ ${s.name}: ${r.ordersIngested} đơn (${Math.round(r.durationMs / 1000)}s)\n`);
    } catch (e) {
      process.stdout.write(`  ✗ ${s.name}: LỖI ${(e as Error).message.slice(0, 100)}\n`);
    }
  }
  process.stdout.write(`\nXONG — re-sync ${total} đơn.\n`);
  process.exit(0);
}

main().catch((e) => { process.stderr.write(`fatal: ${e instanceof Error ? e.stack : String(e)}\n`); process.exit(1); });
