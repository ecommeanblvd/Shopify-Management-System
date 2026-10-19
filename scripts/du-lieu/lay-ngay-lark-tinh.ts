/**
 * Lấy NGÀY CHUẨN của các đơn TINH kỳ cũ từ bảng Lark, ghi ra JSON cho bước trích Excel.
 *
 * Vì sao cần (19/10/2026): ô ngày của Lark là epoch, và mọi dòng TINH kỳ cũ có epoch đúng
 * 17:00:00Z — tức NỬA ĐÊM giờ Việt Nam. Ô đó là ngày-trần theo giờ VN. Bản trích Excel đầu
 * tiên quy về UTC nên LÙI MỘT NGÀY ở mọi dòng (0018 ra 16/07 trong khi người nhập chọn 17/07).
 * `ngayISO` trong `lark-don.ts` đã làm đúng từ đầu — nên lấy ngày từ đó làm chuẩn.
 *
 *   railway run --service Shopify-Management-System npx tsx scripts/du-lieu/lay-ngay-lark-tinh.ts
 */
import { writeFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { listShipHoDonRecords } from '@/features/lark/client';
import { docDongLark, ghepBrand } from '@/features/ship-ho/lark-don';

const RA = 'scripts/du-lieu/ngay-lark-tinh.json';

async function main(): Promise<void> {
  const brands = await db.select({ slug: schema.mmpBrands.slug, ten: schema.mmpBrands.displayName })
    .from(schema.mmpBrands).where(eq(schema.mmpBrands.status, 'active'));
  const ra: Record<string, string> = {};
  for (const r of await listShipHoDonRecords()) {
    const d = docDongLark(r.record_id, r.fields);
    if (ghepBrand(d.brandText, brands) !== 'tinh') continue;
    if (!d.maLark || !d.ngayGui) continue;
    if (d.ngayGui < '2025-07-01' || d.ngayGui > '2026-04-30') continue;
    ra[d.maLark] = d.ngayGui;
  }
  const sapXep = Object.fromEntries(Object.entries(ra).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(RA, `${JSON.stringify(sapXep, null, 1)}\n`);
  console.log(`${RA}: ${Object.keys(sapXep).length} mã`);
  for (const [k, v] of Object.entries(sapXep)) console.log(`  ${k}  ${v}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
