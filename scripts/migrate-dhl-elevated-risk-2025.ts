/**
 * Thêm dòng config DHL Elevated Risk (ER) cho NĂM 2025: 770,000đ/shipment,
 * country_fixed, chịu fuel + VAT, hiệu lực 2025-01-01 → 2026-01-01.
 *
 * Bối cảnh: engine hiện chỉ có ER 918,000đ từ 2026-03-05 nên pack 2025 ship
 * trước mốc đó không được tính ER → đối soát lệch "hoá đơn thu ER nhưng hệ thống
 * không tính". 2025 DHL áp ER 770,000 cho 13 nước rủi ro cao (operator xác nhận).
 *
 * 13 nước (ISO-2): Iraq IQ, Israel IL, Iran IR, Ukraine UA, Afghanistan AF,
 * Pakistan PK, DR Congo CD, Sudan SD, South Sudan SS, North Korea KP, Libya LY,
 * Mali ML, Yemen YE.
 *
 * Window 2025-01-01 → 2026-01-01 KHỚP với dòng ER 918k hiện tại bắt đầu
 * 2026-03-05 (không chồng lấn; IR/KP chuyển sang Restricted Destination 918k từ
 * 2026-01-01).
 *
 * Chạy: dotenv -- tsx scripts/migrate-dhl-elevated-risk-2025.ts [--apply]
 */
import 'dotenv/config';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';

const COUNTRIES = ['IQ', 'IL', 'IR', 'UA', 'AF', 'PK', 'CD', 'SD', 'SS', 'KP', 'LY', 'ML', 'YE'];
const VALUE = '770000';
const STARTS = new Date(Date.UTC(2025, 0, 1)); // 2025-01-01
const ENDS = new Date(Date.UTC(2026, 0, 1));   // 2026-01-01 (exclusive)
const NOTE =
  'Elevated Risk (High Risk) 770,000đ/shipment — DHL áp 2025 cho 13 nước rủi ro ' +
  '(IQ,IL,IR,UA,AF,PK,CD,SD,SS,KP,LY,ML,YE). Chịu fuel + VAT. Hiệu lực 2025 → ' +
  '2026-01-01; từ 2026-03-05 đổi thành 918,000đ (dòng ER riêng). Operator xác nhận 2026-06-12.';

async function main() {
  const apply = process.argv.includes('--apply');

  // DHL account id
  const acct = await db
    .select({ id: schema.carrierAccounts.id, carrierKey: schema.carriers.key })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(eq(schema.carrierAccounts.enabled, true));
  const dhl = acct.find((a) => a.carrierKey === 'dhl');
  if (!dhl) throw new Error('Không tìm thấy DHL carrier account (enabled).');
  console.log('DHL account:', dhl.id);

  // Idempotent: đã có dòng ER 2025 (value 770000, starts 2025-01-01) chưa?
  const existing = await db
    .select({ id: schema.carrierSurcharges.id })
    .from(schema.carrierSurcharges)
    .where(and(
      eq(schema.carrierSurcharges.carrierAccountId, dhl.id),
      eq(schema.carrierSurcharges.kind, 'country_fixed'),
      eq(schema.carrierSurcharges.value, VALUE),
    ));
  if (existing.length > 0) {
    console.log('ĐÃ TỒN TẠI dòng ER 770,000 — bỏ qua (idempotent). id:', existing.map((e) => e.id).join(','));
    process.exit(0);
  }

  console.log('\n=== SẼ GHI ===');
  console.log('  kind: country_fixed | value: 770,000đ | apply_mode: always');
  console.log('  fuelable: true | vatable: (default=vatable)');
  console.log('  starts:', STARTS.toISOString().slice(0, 10), '| ends:', ENDS.toISOString().slice(0, 10), '(exclusive)');
  console.log('  countries:', JSON.stringify(COUNTRIES));

  // Bao nhiêu pack DHL 2025 thuộc các nước này (để biết tác động đối soát)
  const affected = await db
    .select({ country: schema.shopifyOrders.shipCountry, n: sql<number>`count(*)::int` })
    .from(schema.shipments)
    .innerJoin(schema.shipmentCharges, eq(schema.shipmentCharges.shipmentId, schema.shipments.id))
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shipments.orderId))
    .where(and(
      eq(schema.shipments.carrierKey, 'dhl'),
      inArray(schema.shopifyOrders.shipCountry, COUNTRIES),
      gte(schema.shipments.labelCreatedAt, STARTS),
      lt(schema.shipments.labelCreatedAt, ENDS),
    ))
    .groupBy(schema.shopifyOrders.shipCountry);
  console.log('\n=== Pack DHL 2025 thuộc nước ER (sẽ được cộng ER khi đối soát lại) ===');
  let tot = 0;
  for (const r of affected.sort((a, b) => Number(b.n) - Number(a.n))) { console.log(`  ${r.country}: ${r.n}`); tot += Number(r.n); }
  console.log('  TỔNG:', tot, 'pack');

  if (!apply) {
    console.log('\n⚠ DRY RUN — chưa ghi. Chạy lại với --apply để ghi.');
    process.exit(0);
  }

  await db.insert(schema.carrierSurcharges).values({
    carrierAccountId: dhl.id,
    kind: 'country_fixed',
    value: VALUE,
    countryCodes: COUNTRIES,
    active: true,
    startsAt: STARTS,
    endsAt: ENDS,
    fuelable: true,
    applyMode: 'always',
    note: NOTE,
  });
  console.log('\n✅ ĐÃ GHI dòng ER 770,000 cho DHL 2025.');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
