/**
 * Tắt các dòng demand_per_kg FedEx ÁP THỪA: trong cửa sổ hiệu lực của dòng,
 * có đủ đơn (≥ MIN_ORDERS) nhưng FedEx thực thu demand cho RẤT ÍT (< THRESHOLD)
 * → cột PDF parse nhầm dịch vụ (vd US/CA kỳ đông: IP thực thu 0). Tắt để engine
 * hết thừa demand. Validate bằng billed thật. Dry-run mặc định; --apply mới ghi.
 *
 *   railway run -- npx tsx scripts/fix-fedex-demand-overapply.ts [--apply]
 */
import { and, eq, gte, lt, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';

const FEDEX_ACCT = '5683f3c0-9249-40c1-a3e7-d967f0d62c29';
const MIN_ORDERS = 3;       // đủ mẫu để kết luận
const DEMAND_FRACTION = 0.25; // < 25% đơn bị thu → coi là parse nhầm cột → thừa

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const rows = await db.select({
    id: schema.carrierSurcharges.id, val: schema.carrierSurcharges.value,
    cc: schema.carrierSurcharges.countryCodes, starts: schema.carrierSurcharges.startsAt,
    ends: schema.carrierSurcharges.endsAt, active: schema.carrierSurcharges.active,
  }).from(schema.carrierSurcharges)
    .where(and(eq(schema.carrierSurcharges.kind, 'demand_per_kg'), eq(schema.carrierSurcharges.carrierAccountId, FEDEX_ACCT)));

  const toDisable: string[] = [];
  for (const r of rows) {
    if (!r.active || !r.starts || !r.ends) continue;
    const ccs = Array.isArray(r.cc) ? (r.cc as string[]) : [];
    if (ccs.length === 0) continue;
    const orders = await db.select({ dem: schema.shipmentCharges.demand })
      .from(schema.shipmentCharges)
      .innerJoin(schema.shipments, eq(schema.shipments.id, schema.shipmentCharges.shipmentId))
      .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shipments.orderId))
      .where(and(eq(schema.shipments.carrierKey, 'fedex'), inArray(schema.shopifyOrders.shipCountry, ccs),
        gte(schema.shipments.labelCreatedAt, r.starts), lt(schema.shipments.labelCreatedAt, r.ends)));
    if (orders.length < MIN_ORDERS) continue;
    const nDem = orders.filter((o) => Number(o.dem) > 0).length;
    if (nDem / orders.length < DEMAND_FRACTION) {
      toDisable.push(r.id);
      console.log(`TẮT: ${ccs.slice(0, 3).join(',')} ${String(r.starts).slice(0, 10)}→${String(r.ends).slice(0, 10)} val=${Math.round(Number(r.val))} | đơn=${orders.length} thu=${nDem} (${Math.round(nDem / orders.length * 100)}%)`);
    }
  }
  console.log(`\nSố dòng demand thừa cần tắt: ${toDisable.length}`);
  if (apply && toDisable.length) {
    for (const id of toDisable) await db.update(schema.carrierSurcharges).set({ active: false }).where(eq(schema.carrierSurcharges.id, id));
    console.log(`✓ Đã tắt ${toDisable.length} dòng.`);
  } else if (!apply) {
    console.log('[DRY-RUN] Thêm --apply để tắt.');
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
