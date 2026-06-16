/**
 * Backfill CHỈ ĐỊA CHỈ (street/bang/tên) cho đơn 1 store — nhanh hơn full
 * backfill nhiều lần (UPDATE 1 dòng/đơn, KHÔNG upsert line/refund). Dùng cho
 * store lớn mà full backfill bị cắt vì giới hạn thời gian.
 *   railway run -- npx tsx scripts/backfill-addresses-light.ts <storeId>
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { submitBackfillBulkQuery } from '@/features/shopify-orders/backfill/submit-bulk-query';
import { pollBulkOperation } from '@/features/shopify-orders/backfill/poll-bulk-operation';
import { streamBulkResult } from '@/features/shopify-orders/backfill/stream-jsonl';

async function main(): Promise<void> {
  const storeId = process.argv[2];
  if (!storeId) { console.error('usage: backfill-addresses-light <storeId>'); process.exit(1); }
  const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

  console.log('Submit bulk query...');
  await submitBackfillBulkQuery(storeId, since);
  const start = Date.now();
  let url: string | null = null;
  while (true) {
    if (Date.now() - start > 30 * 60 * 1000) throw new Error('bulk stuck > 30m');
    const s = await pollBulkOperation(storeId);
    if (!s) throw new Error('no bulk in flight');
    if (['FAILED', 'CANCELLED', 'EXPIRED'].includes(s.status)) throw new Error(`bulk ${s.status}`);
    if (s.status === 'COMPLETED') { url = s.url; break; }
    await new Promise((r) => setTimeout(r, 15_000));
  }
  if (!url) { console.log('Bulk xong nhưng rỗng (0 đơn).'); process.exit(0); }

  let updated = 0, withAddr = 0;
  await streamBulkResult(url, async (orders) => {
    for (const o of orders) {
      const a = o.shippingAddress;
      if (!a) continue;
      await db.update(schema.shopifyOrders).set({
        shipAddress1: a.address1 ?? null, shipAddress2: a.address2 ?? null,
        shipProvinceCode: a.provinceCode ?? null, shipName: a.name ?? null, shipCompany: a.company ?? null,
      }).where(eq(schema.shopifyOrders.shopifyOrderId, o.id));
      updated += 1;
      if (a.address1) withAddr += 1;
      if (updated % 200 === 0) console.log(`  …${updated} (có street: ${withAddr})`);
    }
  });
  console.log(`✓ Cập nhật ${updated} đơn | có street: ${withAddr}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
