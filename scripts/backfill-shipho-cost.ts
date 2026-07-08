/**
 * Backfill cước gốc dự tính cho đơn ship hộ cũ (carrier_cost_vnd NULL).
 * Re-quote qua estimateForBrand → lưu carrierKey/carrierCostVnd/markupPercent/breakdown.
 * KHÔNG đụng chargedVnd (giữ nguyên giá đã báo brand).
 */
import { isNull, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { estimateForBrand } from '@/features/ship-ho/brand-estimate';

async function main() {
  const rows = await db.select().from(schema.shipHoOrders).where(isNull(schema.shipHoOrders.carrierCostVnd));
  console.log(`Đơn thiếu cước gốc: ${rows.length}`);
  let ok = 0, skip = 0;
  for (const o of rows) {
    const est = await estimateForBrand(o.partnerBrandSlug, {
      country: o.country,
      city: o.city ?? undefined,
      postcode: o.postcode ?? undefined,
      weightKg: Number(o.weightKg),
      dimLengthCm: o.dimLengthCm != null ? Number(o.dimLengthCm) : undefined,
      dimWidthCm: o.dimWidthCm != null ? Number(o.dimWidthCm) : undefined,
      dimHeightCm: o.dimHeightCm != null ? Number(o.dimHeightCm) : undefined,
      packagingType: (o.packagingType as 'bag' | 'box' | null) ?? undefined,
      service: 'express',
    });
    if (!est.ok) { console.log(`  ✗ ${o.code} (${o.country}) → ${est.code}: ${est.error}`); skip++; continue; }
    await db.update(schema.shipHoOrders).set({
      carrierKey: est.internal.carrierKey,
      carrierAccountId: est.internal.carrierAccountId,
      carrierCostVnd: String(est.internal.carrierCostVnd),
      markupPercent: String(est.internal.markupPercent),
      quoteBreakdown: est.internal.breakdown,
    }).where(eq(schema.shipHoOrders.id, o.id));
    const margin = Number(o.chargedVnd ?? 0) - est.internal.carrierCostVnd;
    console.log(`  ✓ ${o.code} (${o.country}) carrier=${est.internal.carrierKey} cước gốc=${est.internal.carrierCostVnd.toLocaleString('vi-VN')} margin=${margin.toLocaleString('vi-VN')}`);
    ok++;
  }
  console.log(`\nXong: ${ok} cập nhật, ${skip} bỏ qua.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
