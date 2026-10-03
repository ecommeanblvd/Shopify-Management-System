/**
 * Cổng chốt kỳ sẽ chặn những kỳ nào, vì lý do gì — CHỈ ĐỌC, không ghi gì.
 *
 * Chạy TRƯỚC khi gắn cổng vào `phatHanhBangKe`: một cổng chặn mất kỳ đã phát hành trót lọt là
 * cổng sai, và biết điều đó sau khi bật thì đã muộn.
 *
 * Chạy: railway run --service Shopify-Management-System npx tsx scripts/soi-cong-chot-ky.ts
 */
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';
import { kiemCongChotKy, type DonKiemCong } from '@/features/ship-ho/cong-chot-ky';
import type { TuanFuel } from '@/features/ship-ho/tuan-fuel';

const n = (v: unknown) => Number(v ?? 0);

async function main(): Promise<void> {
  /* Bảng tuần THEO TỪNG HÃNG: ngày 21/09/2026 FedEx là 51,75% còn Aramex là 30%. Nạp chung
   * một bảng là so đơn Aramex với mức FedEx — bản đầu của script này mắc đúng lỗi đó. */
  const tuanTheoHang = new Map<string, TuanFuel[]>();
  for (const x of (await db.execute<Record<string, unknown>>(sql`
    SELECT s.carrier_account_id acc, s.starts_at::date tu, s.ends_at::date den, s.value::numeric pct
    FROM carrier_surcharges s
    WHERE s.kind = 'fuel_percent' AND s.starts_at IS NOT NULL ORDER BY s.starts_at;`)).rows) {
    const k = String(x.acc);
    const ds = tuanTheoHang.get(k) ?? [];
    ds.push({ tu: String(x.tu), den: x.den ? String(x.den) : null, pct: n(x.pct) });
    tuanTheoHang.set(k, ds);
  }

  const ke = await db.execute<Record<string, unknown>>(sql`
    SELECT id, partner_brand_slug brand, period_start::date ky, status
    FROM ship_ho_statements ORDER BY period_start;`);

  let xanh = 0, do_ = 0;
  for (const k of ke.rows) {
    const don = (await db.execute<Record<string, unknown>>(sql`
      SELECT o.code, ca.name hang, o.carrier_account_id acc, o.picked_up_at, o.shipped_at::date gui, o.actual_bill_breakdown ab
      FROM ship_ho_orders o LEFT JOIN carrier_accounts ca ON ca.id = o.carrier_account_id
      WHERE o.statement_id = ${k.id};`)).rows
      .map((x): DonKiemCong => {
        const ab = x.ab as Record<string, unknown> | null;
        return {
          code: String(x.code), tenHang: x.hang == null ? null : String(x.hang),
          carrierAccountId: x.acc == null ? null : String(x.acc),
          pickedUpAt: x.picked_up_at as Date | null, shippedAt: x.gui == null ? null : String(x.gui),
          bill: ab == null ? null : {
            base: n(ab.base), discount: n(ab.discount), remote: n(ab.remote), demand: n(ab.demand),
            signature: n(ab.signature), residential: n(ab.residential),
            addressCorrection: n(ab.addressCorrection), fuel: n(ab.fuel),
          },
        };
      });
    const loi = kiemCongChotKy(don, tuanTheoHang);
    const nhan = `${String(k.brand).padEnd(12)} ${k.ky} ${String(k.status).padEnd(7)} ${String(don.length).padStart(3)} đơn`;
    if (loi.length === 0) { xanh++; console.log(`✓ ${nhan}`); continue; }
    do_++;
    const theoMa = new Map<string, number>();
    for (const l of loi) theoMa.set(l.ma, (theoMa.get(l.ma) ?? 0) + 1);
    console.log(`✗ ${nhan} — ${loi.length} đơn hỏng (${[...theoMa].map(([m, c]) => `${m}:${c}`).join(' ')})`);
    for (const l of loi.slice(0, 5)) console.log(`     ${l.code} [${l.ma}] ${l.ly}`);
    if (loi.length > 5) console.log(`     … còn ${loi.length - 5} đơn`);
  }
  console.log(`\nTổng: ${xanh} kỳ qua cổng · ${do_} kỳ bị chặn`);
  process.exit(0);
}
main();
