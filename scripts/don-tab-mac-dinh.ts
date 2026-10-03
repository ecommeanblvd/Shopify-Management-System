/**
 * Xoá tab mặc định Google tạo sẵn ("Sheet1" / "Trang tính1") trong các sheet đối soát của brand.
 *
 * Vì sao cần: sheet mới tạo bao giờ cũng có một tab trống tên mặc định. Hệ thống ghi tab theo
 * kỳ ("9.26", "9.26 Duty") nên tab kia nằm lại, và brand mở ra thấy một tab trống đứng đầu —
 * tưởng là chỗ chưa điền.
 *
 * HAI PHÉP KIỂM trước khi xoá, vì xoá nhầm một tab có dữ liệu là mất hẳn:
 *   1. ĐỌC A1:Z1000 rồi mới kết luận trống — không tin vào mỗi cái tên. Ai đó đổi tên một tab
 *      có dữ liệu thành "Sheet1" là mất sạch nếu chỉ khớp tên.
 *   2. KHÔNG xoá nếu đó là tab cuối cùng — Google từ chối spreadsheet không còn tab nào, và
 *      brand chưa có kỳ nào (montsand, 03/10/2026) rơi đúng vào ca này.
 *
 * Chạy: railway run --service Shopify-Management-System npx tsx scripts/don-tab-mac-dinh.ts [--ap-dung]
 */
import { isNotNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { goiSheets } from '@/lib/google/sheets';

const AP = process.argv.includes('--ap-dung');

/** Tên Google đặt cho tab đầu tiên, tiếng Anh và tiếng Việt, có hoặc không khoảng trắng. */
const TEN_MAC_DINH = /^(Sheet ?1|Trang tính ?1)$/i;

async function main(): Promise<void> {
  const dt = await db.select({
    brand: schema.shipHoPartners.brandSlug, id: schema.shipHoPartners.doiSoatSheetId,
  }).from(schema.shipHoPartners).where(isNotNull(schema.shipHoPartners.doiSoatSheetId));

  let xoa = 0, boQua = 0;
  for (const { brand, id } of dt) {
    const meta = await goiSheets(id!, '?fields=sheets.properties(sheetId,title)');
    const tabs = (meta.sheets as { properties: { sheetId: number; title: string } }[]).map((s) => s.properties);
    const ungVien = tabs.filter((t) => TEN_MAC_DINH.test(t.title));
    if (ungVien.length === 0) { console.log(`· ${brand}: không có tab mặc định`); continue; }
    if (tabs.length <= ungVien.length) {
      boQua++;
      console.log(`· ${brand}: BỎ QUA — xoá hết thì sheet không còn tab nào (brand chưa có kỳ)`);
      continue;
    }
    for (const t of ungVien) {
      const v = await goiSheets(id!, `/values/${encodeURIComponent(t.title)}!A1:Z1000`);
      const oCoChu = ((v.values as unknown[][]) ?? []).flat().filter((x) => String(x ?? '').trim() !== '');
      if (oCoChu.length > 0) {
        boQua++;
        console.log(`· ${brand}: "${t.title}" CÓ ${oCoChu.length} ô có chữ — KHÔNG xoá`);
        continue;
      }
      if (!AP) { console.log(`· ${brand}: sẽ xoá "${t.title}" (trống)`); continue; }
      await goiSheets(id!, ':batchUpdate', { method: 'POST',
        body: JSON.stringify({ requests: [{ deleteSheet: { sheetId: t.sheetId } }] }) });
      xoa++;
      const sau = await goiSheets(id!, '?fields=sheets.properties.title');
      console.log(`✓ ${brand}: xoá "${t.title}" — còn: ${(sau.sheets as { properties: { title: string } }[]).map((s) => s.properties.title).join(' · ')}`);
    }
  }
  console.log(AP ? `\nĐã xoá ${xoa} tab · bỏ qua ${boQua}.` : '\nCHỈ KIỂM — thêm --ap-dung để xoá.');
  process.exit(0);
}
main();
