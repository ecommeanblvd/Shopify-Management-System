/**
 * Dựng lại TOÀN BỘ phụ phí xăng dầu (fuel_percent) cho DHL = đúng bảng
 * gatewayexpress.vn/dhl/phu-phi-xang-dau (nguồn giá FIX, không đổi, không tính
 * ngược từ đối soát). XOÁ hết dòng fuel_percent DHL cũ (kể cả các dòng đã chỉnh
 * theo hoá đơn) rồi ghi lại từ bảng gateway.
 *
 * Granularity theo gateway: 2025 + 2026 Jan–Mar = THEO THÁNG; từ 2026-04 = THEO TUẦN.
 *
 * Chạy: dotenv -- tsx scripts/migrate-dhl-fuel-gateway-rebuild.ts [--apply]
 */
import 'dotenv/config';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';

const U = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

interface FuelRow { start: Date; end: Date | null; pct: string; label: string }

// Tháng (gateway): start = 1st tháng, end = 1st tháng kế.
const MONTHLY: Array<[number, number, string]> = [
  // 2025
  [2025, 1, '25.75'], [2025, 2, '29.25'], [2025, 3, '29.75'], [2025, 4, '28.25'],
  [2025, 5, '27.50'], [2025, 6, '26.75'], [2025, 7, '27.00'], [2025, 8, '31.00'],
  [2025, 9, '30.00'], [2025, 10, '29.75'], [2025, 11, '30.00'], [2025, 12, '31.50'],
  // 2026 Jan–Mar
  [2026, 1, '30.00'], [2026, 2, '28.75'], [2026, 3, '30.50'],
];

// Tuần (gateway) từ 2026-04. Mốc thứ Hai; dòng cuối mở (open) = giá hiện hành.
const WEEKLY: FuelRow[] = [
  { start: U(2026, 4, 1), end: U(2026, 4, 13), pct: '39.00', label: '01–12/04/2026' },
  { start: U(2026, 4, 13), end: U(2026, 4, 20), pct: '46.00', label: '13–19/04/2026' },
  { start: U(2026, 4, 20), end: U(2026, 4, 27), pct: '47.75', label: '20–26/04/2026' },
  { start: U(2026, 4, 27), end: U(2026, 5, 4), pct: '48.00', label: '27/04–03/05/2026' },
  { start: U(2026, 5, 4), end: U(2026, 5, 11), pct: '47.00', label: '04–10/05/2026' },
  { start: U(2026, 5, 11), end: U(2026, 5, 18), pct: '46.75', label: '11–17/05/2026' },
  { start: U(2026, 5, 18), end: U(2026, 5, 25), pct: '47.25', label: '18–24/05/2026' },
  { start: U(2026, 5, 25), end: U(2026, 6, 1), pct: '47.75', label: '25–31/05/2026' },
  { start: U(2026, 6, 1), end: U(2026, 6, 8), pct: '48.75', label: '01–07/06/2026' },
  { start: U(2026, 6, 8), end: U(2026, 6, 15), pct: '48.75', label: '08–14/06/2026' },
  { start: U(2026, 6, 15), end: null, pct: '47.00', label: '15–21/06/2026 (mở)' },
];

async function main() {
  const apply = process.argv.includes('--apply');

  const acct = await db
    .select({ id: schema.carrierAccounts.id, key: schema.carriers.key })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(eq(schema.carrierAccounts.enabled, true));
  const dhl = acct.find((a) => a.key === 'dhl');
  if (!dhl) throw new Error('Không tìm thấy DHL account.');

  const rows: FuelRow[] = [
    ...MONTHLY.map(([y, m, pct]) => ({
      start: U(y, m, 1),
      end: m === 12 ? U(y + 1, 1, 1) : U(y, m + 1, 1),
      pct,
      label: `Tháng ${m}/${y}`,
    })),
    ...WEEKLY,
  ];

  const existing = await db
    .select({ id: schema.carrierSurcharges.id, value: schema.carrierSurcharges.value, startsAt: schema.carrierSurcharges.startsAt })
    .from(schema.carrierSurcharges)
    .where(and(eq(schema.carrierSurcharges.carrierAccountId, dhl.id), eq(schema.carrierSurcharges.kind, 'fuel_percent')));

  console.log(`DHL account: ${dhl.id}`);
  console.log(`\n=== SẼ XOÁ ${existing.length} dòng fuel_percent DHL cũ ===`);
  console.log(`=== SẼ GHI ${rows.length} dòng theo gateway (15 tháng + 11 tuần) ===`);
  for (const r of rows) {
    console.log(`  ${r.start.toISOString().slice(0, 10)} → ${r.end ? r.end.toISOString().slice(0, 10) : '(mở)'} : ${r.pct}%  [${r.label}]`);
  }

  if (!apply) {
    console.log('\n⚠ DRY RUN — chưa ghi. Chạy lại với --apply.');
    process.exit(0);
  }

  await db.transaction(async (tx) => {
    await tx.delete(schema.carrierSurcharges).where(and(
      eq(schema.carrierSurcharges.carrierAccountId, dhl.id),
      eq(schema.carrierSurcharges.kind, 'fuel_percent'),
    ));
    await tx.insert(schema.carrierSurcharges).values(rows.map((r) => ({
      carrierAccountId: dhl.id,
      kind: 'fuel_percent' as const,
      value: r.pct,
      active: true,
      startsAt: r.start,
      endsAt: r.end,
      applyMode: 'always',
      lastAutoSource: 'gatewayexpress.vn/dhl (fix)',
      note: `DHL fuel ${r.pct}% — ${r.label}. Nguồn FIX gatewayexpress.vn/dhl/phu-phi-xang-dau (không tính ngược đối soát). 2026-06-12.`,
    })));
  });
  console.log(`\n✅ ĐÃ DỰNG LẠI ${rows.length} dòng fuel DHL theo gateway.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
