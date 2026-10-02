/**
 * Nạp mốc hãng lấy hàng (`picked_up_at`) từ lịch sử quét FedEx.
 *
 * Vì sao cần: `shipped_at` là lúc mình tạo nhãn, không phải lúc hàng đi — và phụ phí xăng dầu
 * tính theo tuần của NGÀY ĐI. Xem `features/ship-ho/ngay-lay-hang.ts`.
 *
 * FedEx chỉ giữ dữ liệu track 90 ngày, nên đơn cũ hơn sẽ trả NOTFOUND — ghi nhận và bỏ qua,
 * không coi là lỗi.
 *
 * Chạy: railway run --service Shopify-Management-System npx tsx scripts/nap-ngay-lay-hang.ts [--ap-dung]
 */
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { layLichSuQuet } from '@/lib/fedex/track';
import { mocLayHang } from '@/features/ship-ho/ngay-lay-hang';

const AP = process.argv.includes('--ap-dung');
const LO = 30; // FedEx nhận tối đa 30 mã mỗi lượt

async function main() {
  const don = await db.select({
    id: schema.shipHoOrders.id, code: schema.shipHoOrders.code,
    awb: schema.shipHoOrders.trackingNumber, gui: schema.shipHoOrders.shippedAt,
  }).from(schema.shipHoOrders)
    .innerJoin(schema.carrierAccounts, eq(schema.carrierAccounts.id, schema.shipHoOrders.carrierAccountId))
    .where(and(
      isNotNull(schema.shipHoOrders.trackingNumber),
      isNull(schema.shipHoOrders.pickedUpAt),
      sql`${schema.carrierAccounts.name} ILIKE 'FedEx%'`,
    ));
  console.log(`${don.length} đơn FedEx chưa có ngày lấy hàng.\n`);

  let co = 0, khong = 0, lech = 0;
  for (let i = 0; i < don.length; i += LO) {
    const lo = don.slice(i, i + LO);
    const quet = await layLichSuQuet(lo.map((d) => d.awb!));
    for (const d of lo) {
      const r = quet.get(d.awb!);
      const moc = r && !('loi' in r) ? mocLayHang(r.suKien as { eventType?: string | null; date?: string | null }[]) : null;
      if (!moc) { khong++; continue; }
      co++;
      const ngay = moc.toISOString().slice(0, 10);
      if (ngay !== String(d.gui)) { lech++; console.log(`   ${d.code}: ngày gửi đang lưu ${d.gui} → hãng lấy hàng ${ngay}`); }
      if (AP) await db.update(schema.shipHoOrders).set({ pickedUpAt: moc })
        .where(eq(schema.shipHoOrders.id, d.id));
    }
  }
  console.log(`\nLấy được: ${co} · không có dữ liệu (quá 90 ngày hoặc chưa quét): ${khong}`);
  console.log(`Lệch với ngày gửi đang lưu: ${lech}`);
  if (!AP) console.log('\nCHỈ ĐẾM — thêm --ap-dung để ghi.');
  process.exit(0);
}
main();
