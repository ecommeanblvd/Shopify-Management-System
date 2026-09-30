/**
 * Tính lại giá thu của các đơn ship hộ đang mang markup KHÁC bậc của brand (CEO 30/09/2026).
 *
 * Bối cảnh: từ 08/09 đến 30/09, bước tính lại theo hoá đơn đọc cột `ship_ho_orders.markup_percent`
 * thay vì bậc của brand. Cột đó trên đơn cũ là giá trị legacy trước khi có hệ bậc (kalisa 30,
 * brand khác 20), nên đơn đã chốt giá bị đẩy lên — #KLS1990 từ 1.567.050đ (đã gửi MMP 23/07)
 * thành 1.711.590đ. Luật đã sửa; script này dọn các đơn đã trót nhảy giá.
 *
 * Cách làm: KHÔNG tự ghi giá. Chỉ gỡ đóng băng (`reconcile_status`) rồi gọi đúng lõi đối soát
 * của hệ thống — nó tính lại bằng luật mới, ghi breakdown và bắn `order.reconciled` sang MMP
 * qua đường đã có test. Đơn nào tính lại lỗi thì để nguyên trạng thái gỡ băng, cron sau tự lành.
 *
 * Chạy:  railway run --service Shopify-Management-System npx tsx scripts/tinh-lai-gia-theo-bac.ts [--ap-dung]
 * Không cờ = CHỈ ĐẾM (không đụng gì).
 */
import { sql, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { markupTheoBac } from '@/features/ship-ho/tier-pricing';
import { reconcileShipHoFromCarrierBillsCore } from '@/features/ship-ho/reconcile-actions';

const AP_DUNG = process.argv.includes('--ap-dung');
const N = (v: unknown): number => (v == null ? 0 : Number(v));
const tien = (v: number) => v.toLocaleString('vi-VN') + 'đ';

interface DonLech {
  id: string; code: string; ref: string | null; brand: string;
  markupDangDung: number; markupTheoBac: number; giaHienTai: number;
}

/** Đơn có breakdown bán ra mà markup suy ngược từ chính số đã lưu ≠ markup theo bậc. */
async function timDonLech(): Promise<DonLech[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT o.id, o.code, o.brand_reference, o.partner_brand_slug,
           o.actual_bill_breakdown AS ab, o.actual_charged_vnd,
           p.strategic, p.tier_override_code, p.tier_code
      FROM ship_ho_orders o
      LEFT JOIN ship_ho_partners p ON p.brand_slug = o.partner_brand_slug
     WHERE o.actual_bill_breakdown ? 'sell' AND o.reconcile_status = 'reconciled';
  `);

  const out: DonLech[] = [];
  for (const r of rows.rows) {
    const ab = r.ab as Record<string, unknown> | null;
    const sb = ab?.sell as Record<string, unknown> | null;
    if (!ab || !sb) continue;
    // Cước net trên bill = base − chiết khấu; markup đã dùng = baseVnd bán ra / net − 1.
    const net = N(ab.base) + N(ab.discount);
    const baseBanRa = N(sb.baseVnd);
    if (!(net > 0) || !(baseBanRa > 0)) continue;
    const dangDung = Math.round((baseBanRa / net - 1) * 10000) / 100;
    const theoBac = markupTheoBac({
      strategic: (r.strategic as boolean) ?? false,
      tierOverrideCode: (r.tier_override_code as string) ?? null,
      tierCode: (r.tier_code as string) ?? null,
    });
    // Ngưỡng 0,05 điểm %: nuốt sai số làm tròn của phép suy ngược, không nuốt lệch bậc
    // (hai bậc gần nhau cách nhau 4 điểm %).
    if (Math.abs(dangDung - theoBac) < 0.05) continue;
    out.push({
      id: r.id as string, code: r.code as string, ref: (r.brand_reference as string) ?? null,
      brand: r.partner_brand_slug as string, markupDangDung: dangDung, markupTheoBac: theoBac,
      giaHienTai: Math.round(N(r.actual_charged_vnd)),
    });
  }
  return out;
}

async function main() {
  const lech = await timDonLech();
  console.log(`Đơn đang tính bằng markup khác bậc: ${lech.length}`);
  console.table(lech.map((d) => ({
    code: d.code, ref: d.ref, brand: d.brand,
    'đang dùng': `${d.markupDangDung}%`, 'theo bậc': `${d.markupTheoBac}%`, 'giá hiện tại': tien(d.giaHienTai),
  })));
  if (lech.length === 0) { console.log('Không có gì để làm.'); process.exit(0); }

  if (!AP_DUNG) {
    console.log('\nCHỈ ĐẾM — chưa đụng gì. Thêm --ap-dung để tính lại và bắn giá mới sang MMP.');
    process.exit(0);
  }

  const ids = lech.map((d) => d.id);
  // Gỡ đóng băng: lõi đối soát bỏ qua đơn `reconciled` mà bill không đổi (donDaDongBang).
  await db.update(schema.shipHoOrders).set({ reconcileStatus: 'pending' })
    .where(inArray(schema.shipHoOrders.id, ids));
  console.log(`\nĐã gỡ đóng băng ${ids.length} đơn. Chạy lõi đối soát…`);

  const tomTat = await reconcileShipHoFromCarrierBillsCore();
  console.log('Lõi đối soát:', JSON.stringify({
    matched: tomTat.matched, requoted: tomTat.requoted, frozen: tomTat.frozen, errors: tomTat.errors.length,
  }));
  if (tomTat.errors.length > 0) console.log('Lỗi:', JSON.stringify(tomTat.errors.slice(0, 10), null, 2));

  // Đối chiếu sau khi chạy: giá mới + trạng thái có về `reconciled` không.
  const sau = await db.select({
    id: schema.shipHoOrders.id, code: schema.shipHoOrders.code,
    gia: schema.shipHoOrders.actualChargedVnd, trangThai: schema.shipHoOrders.reconcileStatus,
  }).from(schema.shipHoOrders).where(inArray(schema.shipHoOrders.id, ids));
  const theoId = new Map(sau.map((s) => [s.id, s]));

  let tongGiam = 0, chuaVe = 0;
  console.table(lech.map((d) => {
    const s = theoId.get(d.id);
    const moi = Math.round(N(s?.gia));
    tongGiam += d.giaHienTai - moi;
    if (s?.trangThai !== 'reconciled') chuaVe += 1;
    return { code: d.code, ref: d.ref, truoc: tien(d.giaHienTai), sau: tien(moi),
      lech: tien(moi - d.giaHienTai), 'trạng thái': s?.trangThai ?? '?' };
  }));
  console.log(`\nTổng giá giảm về: ${tien(tongGiam)}`);
  if (chuaVe > 0) console.log(`CẢNH BÁO: ${chuaVe} đơn chưa về 'reconciled' — cron sau sẽ tính lại.`);

  const con = await timDonLech();
  console.log(`Còn lệch sau khi chạy: ${con.length}`);
  process.exit(0);
}
main();
