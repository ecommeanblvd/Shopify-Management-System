/**
 * Backfill quote FedEx Rate API cho đơn FedEx (lưu cache fedex_rate_quotes).
 * Rate-limited. Bỏ qua đơn đã cache trừ khi --refresh. Cần env FedEx prod
 * → chạy qua: railway run -- npx tsx scripts/backfill-fedex-quotes.ts [--limit N] [--refresh]
 */
import { and, eq, isNotNull, isNull, desc } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { quoteShipmentToCache } from '@/features/carrier-rates/fedex-quote-cache';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };

async function main(): Promise<void> {
  const limit = Number(arg('limit') ?? '50');
  const refresh = process.argv.includes('--refresh');

  const conds = [
    eq(schema.shipments.carrierKey, 'fedex'),
    isNotNull(schema.shopifyOrders.shipPostcode),
    isNotNull(schema.shipments.dimLengthCm),
    isNotNull(schema.shipments.labelCreatedAt),
  ];

  const rows = await db.select({
    sid: schema.shipments.id, ord: schema.shopifyOrders.shopifyOrderNumber,
    hub: schema.shipments.originHub, country: schema.shopifyOrders.shipCountry,
    postcode: schema.shopifyOrders.shipPostcode, wt: schema.shipments.actualWeightKg,
    l: schema.shipments.dimLengthCm, w: schema.shipments.dimWidthCm, h: schema.shipments.dimHeightCm,
    date: schema.shipments.labelCreatedAt, cachedAt: schema.fedexRateQuotes.quotedAt,
  }).from(schema.shipmentCharges)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.shipmentCharges.shipmentId))
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shipments.orderId))
    .leftJoin(schema.fedexRateQuotes, eq(schema.fedexRateQuotes.shipmentId, schema.shipments.id))
    .where(and(...conds, ...(refresh ? [] : [isNull(schema.fedexRateQuotes.id)])))
    .orderBy(desc(schema.shipments.labelCreatedAt))
    .limit(limit);

  console.log(`Cần quote: ${rows.length} đơn${refresh ? ' (refresh)' : ' (chưa cache)'}\n`);
  let ok = 0, fail = 0;
  for (const r of rows) {
    try {
      const res = await quoteShipmentToCache({
        shipmentId: r.sid, originHub: r.hub, country: r.country!, postcode: r.postcode!,
        weightKg: Number(r.wt), dims: { length: Number(r.l), width: Number(r.w), height: Number(r.h) },
        shipDate: r.date!,
      });
      if (res.ok) { ok += 1; if (ok % 10 === 0) console.log(`  …${ok} ok`); }
      else { fail += 1; console.log(`  ${r.ord}: không có quote ACCOUNT`); }
    } catch (e) {
      fail += 1; console.log(`  ${r.ord} ${r.country}: LỖI ${(e as Error).message.slice(0, 70)}`);
    }
    await sleep(350); // nhẹ tay rate-limit prod
  }
  console.log(`\n✓ Quote OK: ${ok} | lỗi/bỏ: ${fail}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
