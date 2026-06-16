/**
 * Verify địa chỉ đơn Shopify qua FedEx Address Validation → lưu phân loại
 * (RESIDENTIAL/BUSINESS), giao-được (DPV/Resolved), vấn đề (thiếu suite…) và
 * địa chỉ chuẩn hoá. Rate-limited. Cần đơn ĐÃ có shipAddress1 (re-sync trước).
 *   railway run -- npx tsx scripts/verify-shopify-addresses.ts [--limit N] [--refresh]
 */
import { and, eq, isNull, isNotNull, desc } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { verifyAddress, type AddressInput } from '@/lib/fedex/address';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };

async function main(): Promise<void> {
  const limit = Number(arg('limit') ?? '300');
  const refresh = process.argv.includes('--refresh');
  const rows = await db.select({
    id: schema.shopifyOrders.id, num: schema.shopifyOrders.shopifyOrderNumber,
    a1: schema.shopifyOrders.shipAddress1, a2: schema.shopifyOrders.shipAddress2,
    city: schema.shopifyOrders.shipCity, prov: schema.shopifyOrders.shipProvinceCode,
    pc: schema.shopifyOrders.shipPostcode, country: schema.shopifyOrders.shipCountry,
  }).from(schema.shopifyOrders)
    .where(and(isNotNull(schema.shopifyOrders.shipAddress1), isNotNull(schema.shopifyOrders.shipCountry),
      ...(refresh ? [] : [isNull(schema.shopifyOrders.addrVerifiedAt)])))
    .orderBy(desc(schema.shopifyOrders.processedAtShopify)).limit(limit);

  console.log(`Cần verify: ${rows.length} đơn${refresh ? ' (refresh)' : ' (chưa verify)'}.`);
  const tally: Record<string, number> = {};
  let undeliverable = 0, n = 0;
  const now = new Date();
  for (const r of rows) {
    const input: AddressInput = {
      streetLines: [r.a1 ?? '', r.a2 ?? ''].filter((s) => s.trim()),
      city: r.city, stateOrProvinceCode: r.prov, postalCode: r.pc, countryCode: r.country!,
    };
    try {
      const v = await verifyAddress(input);
      tally[v.classification] = (tally[v.classification] ?? 0) + 1;
      if (!v.deliverable) undeliverable += 1;
      await db.update(schema.shopifyOrders).set({
        addrClass: v.classification, addrDeliverable: v.deliverable,
        addrIssue: v.issue, addrStandardized: v.standardized, addrVerifiedAt: now,
      }).where(eq(schema.shopifyOrders.id, r.id));
      n += 1; if (n % 20 === 0) console.log(`  …${n}`);
    } catch (e) { console.log(`  ${r.num}: LỖI ${(e as Error).message.slice(0, 60)}`); }
    await sleep(300);
  }
  console.log(`\n✓ Verify ${n} đơn | phân loại ${JSON.stringify(tally)} | KHÔNG giao được (cần kiểm): ${undeliverable}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
