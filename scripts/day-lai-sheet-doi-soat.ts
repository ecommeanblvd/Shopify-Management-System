/**
 * ĐẨY LẠI bảng kê đã phát hành lên sheet đối soát của brand, để áp định dạng mới.
 *
 * Vì sao cần (CEO 14/10/2026): khối định dạng sheet — đóng băng tiêu đề, nền đậm chữ trắng,
 * cột ngày dd/mm/yyyy, dòng tổng bằng công thức — chỉ ra đời 08/10 (commit 332d5e6e). Các kỳ
 * phát hành TRƯỚC mốc đó (mirer và white-chic, phát hành 01/10) có tab nhưng chưa có định
 * dạng. Kalisa đã được đẩy lại sau 08/10 nên trông đúng.
 *
 * AN TOÀN: tab do MÁY sở hữu, mỗi lượt đẩy là xoá sạch rồi ghi lại — nên đẩy lại không làm
 * mất gì người ta gõ tay (họ không gõ vào tab này). SỐ cũng không đổi: `dayBangKeLenSheet`
 * dựng dòng từ breakdown ĐÃ LƯU của đơn, không tính lại giá. Luật giá mới 14/10 không chạm
 * vào kỳ đã phát hành (xem chốt chặn `kyDaChot` trong `reconcile-actions.ts`).
 *
 * CHẠY THỬ LÀ MẶC ĐỊNH. Có `--ap-dung` mới ghi thật — đây là sheet brand đang nhìn.
 *
 *   railway run --service Shopify-Management-System npx tsx scripts/day-lai-sheet-doi-soat.ts
 *   railway run --service Shopify-Management-System npx tsx scripts/day-lai-sheet-doi-soat.ts --ap-dung
 *   ... thêm `--brand=mirer` để giới hạn một brand.
 */
import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { dayBangKeLenSheet, tenTabKy } from '@/features/ship-ho/day-sheet';

const AP = process.argv.includes('--ap-dung');
const chiBrand = process.argv.find((x) => x.startsWith('--brand='))?.slice('--brand='.length) ?? null;

async function main(): Promise<void> {
  const ke = await db.select({
    id: schema.shipHoStatements.id,
    brand: schema.shipHoStatements.partnerBrandSlug,
    ky: schema.shipHoStatements.periodStart,
    loai: schema.shipHoStatements.type,
    soDon: schema.shipHoStatements.orderCount,
  }).from(schema.shipHoStatements).where(eq(schema.shipHoStatements.status, 'issued'));

  const coSheet = new Set((await db.select({ slug: schema.shipHoPartners.brandSlug })
    .from(schema.shipHoPartners)
    .where(and(isNotNull(schema.shipHoPartners.doiSoatSheetId), ne(schema.shipHoPartners.doiSoatSheetId, ''))))
    .map((x) => x.slug));

  const can = ke
    .filter((k) => chiBrand == null || k.brand === chiBrand)
    .sort((a, b) => (a.brand + a.ky).localeCompare(b.brand + b.ky));

  console.log(`${AP ? 'ÁP DỤNG' : 'CHẠY THỬ'} — ${can.length} bảng kê đã phát hành${chiBrand ? ` (brand ${chiBrand})` : ''}\n`);
  let ok = 0, boQua = 0, loi = 0;
  for (const k of can) {
    const tab = tenTabKy(String(k.ky), String(k.loai));
    const nhan = `${k.brand.padEnd(12)} ${tab.padEnd(10)} ${String(k.soDon ?? 0).padStart(3)} đơn`;
    if (!coSheet.has(k.brand)) { console.log(`- ${nhan}  — brand chưa gắn sheet, bỏ qua`); boQua += 1; continue; }
    if (!AP) { console.log(`- ${nhan}  — sẽ ghi lại tab "${tab}"`); ok += 1; continue; }
    try {
      const r = await dayBangKeLenSheet(k.id);
      console.log(`${r.ok ? '✓' : '✗'} ${nhan}  — ${r.detail}`);
      if (r.ok) ok += 1; else loi += 1;
    } catch (e) {
      console.log(`✗ ${nhan}  — ${e instanceof Error ? e.message : String(e)}`);
      loi += 1;
    }
  }
  console.log(`\nXong: ${ok} ${AP ? 'đã ghi' : 'sẽ ghi'} · ${boQua} bỏ qua · ${loi} lỗi`);
  if (!AP) console.log('Chưa ghi gì cả. Thêm --ap-dung để ghi thật.');
  process.exit(loi > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
