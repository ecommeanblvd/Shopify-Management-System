/* eslint-disable no-console */
/**
 * Catch-up đơn còn sót: đặt mốc đồng bộ về <SINCE> (mặc định 2026-06-10) cho mọi
 * store active rồi chạy runHourlySync 1 lượt → kéo & upsert hết đơn updated từ mốc
 * đó tới giờ (qua đường GraphQL paged đã kiểm chứng). Cũng reset cờ backfill kẹt.
 *
 *   npx dotenv -- tsx scripts/catchup-orders.ts [--since=2026-06-10]
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { runHourlySync } from '../features/shopify-orders/cron/hourly-sync';

async function main() {
  const since = process.argv.find((a) => a.startsWith('--since='))?.split('=')[1] ?? '2026-06-10';
  const sinceDate = new Date(`${since}T00:00:00.000Z`);
  if (Number.isNaN(sinceDate.getTime())) throw new Error(`--since không hợp lệ: ${since}`);

  // 1) Gỡ cờ backfill kẹt 'running' (chặn chạy lại).
  const unstuck = await db
    .update(schema.shopifySyncState)
    .set({ backfillStatus: 'idle' })
    .where(eq(schema.shopifySyncState.backfillStatus, 'running'))
    .returning({ storeId: schema.shopifySyncState.storeId });
  if (unstuck.length) console.log(`Reset ${unstuck.length} backfill kẹt 'running' → 'idle'.`);

  // 2) Đặt mốc lastCronSyncAt = since cho mọi store active.
  const stores = await db.select().from(schema.stores).where(eq(schema.stores.status, 'active'));
  for (const s of stores) {
    await db
      .insert(schema.shopifySyncState)
      .values({ storeId: s.id, lastCronSyncAt: sinceDate })
      .onConflictDoUpdate({ target: schema.shopifySyncState.storeId, set: { lastCronSyncAt: sinceDate } });
  }
  console.log(`Đặt mốc đồng bộ = ${since} cho ${stores.length} store. Đang kéo đơn...`);

  // 3) Chạy sync — kéo updated_at >= since, upsert, rồi set lastCronSyncAt = now.
  const res = await runHourlySync();
  console.log('\n=== KẾT QUẢ ===');
  for (const r of res) console.log(`${r.storeName}\tingested=${r.ingested}${r.error ? `\tERROR: ${r.error}` : ''}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
