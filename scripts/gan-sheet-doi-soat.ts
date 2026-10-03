/**
 * Gắn sheet đối soát cho brand rồi đẩy mọi kỳ đã có lên đó.
 *
 * Vì sao cần script tay: tài khoản dịch vụ KHÔNG tạo được sheet (Drive trả
 * `storageQuotaExceeded` — nó không có dung lượng Drive riêng), nên sheet phải do người tạo và
 * chia sẻ quyền writer. Script này nhận link, kiểm quyền THẬT, rồi mới ghi vào CSDL.
 *
 * Kiểm quyền trước khi ghi id: lưu một id mà tài khoản dịch vụ không mở được là mỗi lần chốt kỳ
 * lại hỏng một lượt, và lỗi chỉ hiện ra lúc đó chứ không hiện lúc gắn.
 *
 * Chạy:
 *   railway run --service Shopify-Management-System npx tsx scripts/gan-sheet-doi-soat.ts \
 *     lekieu=https://docs.google.com/spreadsheets/d/XXX/edit tinh=https://... [--ap-dung]
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { goiSheets } from '@/lib/google/sheets';
import { dayBangKeLenSheet } from '@/features/ship-ho/day-sheet';
// Dùng LẠI hàm tách id đã có của luồng nhập bảng kê COGS, không viết bản thứ hai: hai bản sao
// của một phép bóc chuỗi là hẹn ngày chúng nhận khác nhau (D-210).
import { sheetIdTuUrl } from '@/features/cogs/bang-ke-import';

const AP = process.argv.includes('--ap-dung');

async function main(): Promise<void> {
  const cap = process.argv.slice(2).filter((x) => x.includes('=')).map((x) => {
    const i = x.indexOf('=');
    return { brand: x.slice(0, i).trim(), link: x.slice(i + 1).trim() };
  });
  if (cap.length === 0) {
    console.log('Chưa truyền cặp nào. Dạng: <brand>=<link sheet>');
    process.exit(1);
  }

  for (const { brand, link } of cap) {
    const id = sheetIdTuUrl(link);
    if (!id) { console.log(`✗ ${brand}: link không phải Google Sheet — ${link.slice(0, 60)}`); continue; }

    const [dt] = await db.select({ slug: schema.shipHoPartners.brandSlug })
      .from(schema.shipHoPartners).where(eq(schema.shipHoPartners.brandSlug, brand)).limit(1);
    if (!dt) { console.log(`✗ ${brand}: không có đối tác ship hộ nào mang slug này`); continue; }

    // Mở thử TRƯỚC khi ghi: chưa share thì Google trả 403/404 ngay ở đây.
    let ten: string;
    try {
      const m = await goiSheets(id, '?fields=properties.title');
      ten = (m.properties as { title: string }).title;
    } catch (e) {
      console.log(`✗ ${brand}: mở không được — ${(e as Error).message.slice(0, 120)}`);
      console.log(`     nhớ chia sẻ quyền Editor cho ${process.env.GOOGLE_SA_EMAIL ?? 'tài khoản dịch vụ'}`);
      continue;
    }

    if (!AP) { console.log(`· ${brand}: mở được "${ten}" — sẽ gắn id ${id}`); continue; }
    await db.update(schema.shipHoPartners).set({ doiSoatSheetId: id })
      .where(eq(schema.shipHoPartners.brandSlug, brand));
    console.log(`✓ ${brand}: gắn "${ten}"`);

    const ke = await db.select({ id: schema.shipHoStatements.id, ky: schema.shipHoStatements.periodStart })
      .from(schema.shipHoStatements).where(eq(schema.shipHoStatements.partnerBrandSlug, brand));
    for (const k of ke) {
      const r = await dayBangKeLenSheet(k.id);
      console.log(`     kỳ ${String(k.ky).slice(0, 10)}: ${r.detail}`);
    }
  }
  if (!AP) console.log('\nCHỈ KIỂM — thêm --ap-dung để ghi và đẩy dữ liệu.');
  process.exit(0);
}
main();
