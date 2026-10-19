/**
 * Trích các dòng bảng ship hộ Lark của MỘT brand ra JSON, kèm tiền tham khảo.
 *
 * Ngày lấy qua `docDongLark` → `ngayISO` (+07): ô ngày của Lark là epoch, và ô ngày-trần được
 * lưu ở nửa đêm GIỜ VIỆT NAM, nên quy về UTC là lùi một ngày (đã mắc 19/10/2026).
 *
 * `giaChuaDu` = cột "Brand | Cước tính" còn TRỐNG. Khi đó "Brand | Tổng Thu (đ)" chỉ là tổng
 * của mấy khoản lẻ, KHÔNG phải giá thu thật — đội báo giá chưa điền. Dòng như vậy không được
 * đem đi đòi tiền brand; phải hỏi lại.
 *
 *   railway run --service Shopify-Management-System npx tsx scripts/du-lieu/trich-ship-ho-lark.ts --brand=mirer
 */
import { writeFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { listShipHoDonRecords } from '@/features/lark/client';
import { docDongLark, ghepBrand, chuoi, so, COT } from '@/features/ship-ho/lark-don';

const BRAND = process.argv.find((x) => x.startsWith('--brand='))?.slice('--brand='.length) ?? 'mirer';
const RA = `scripts/du-lieu/ship-ho-lark-${BRAND}.json`;

async function main(): Promise<void> {
  const brands = await db.select({ slug: schema.mmpBrands.slug, ten: schema.mmpBrands.displayName })
    .from(schema.mmpBrands).where(eq(schema.mmpBrands.status, 'active'));

  /* Đơn đã có trong SMS — để file nói rõ dòng nào hệ thống đã quản, dòng nào còn hở. */
  const trongSms = new Map((await db.select({
    code: schema.shipHoOrders.code,
    lark: schema.shipHoOrders.larkOrderNumber,
    thu: schema.shipHoOrders.chargedVnd,
  }).from(schema.shipHoOrders).where(eq(schema.shipHoOrders.partnerBrandSlug, BRAND)))
    .filter((x) => x.lark).map((x) => [x.lark!, x]));

  const ra = [];
  for (const r of await listShipHoDonRecords()) {
    const d = docDongLark(r.record_id, r.fields);
    if (ghepBrand(d.brandText, brands) !== BRAND) continue;
    const cuocTinh = so(r.fields[COT.cuocTinhBrand]) ?? 0;
    const sms = d.maLark ? trongSms.get(d.maLark) : undefined;
    ra.push({
      ma: d.maLark ?? d.recordId,
      ngay: d.ngayGui,
      brandRef: d.brandReference ?? '',
      hang: (d.carrierKey ?? '').toUpperCase(),
      tracking: d.trackingNumber ?? '',
      nuocRaw: chuoi(r.fields[COT.nuoc]) ?? '',
      nuoc: d.nuoc ?? '',
      nhan: d.nguoiNhan ?? '',
      canKg: d.canKg,
      giao: d.trangThaiGiao ?? '',
      cuocTinh,
      thuVnd: so(r.fields[COT.thuBrand]) ?? 0,
      vonVnd: d.vonThamKhaoVnd,
      ...(cuocTinh ? {} : { giaChuaDu: true as const }),
      ...(sms ? { maSms: sms.code, thuSms: sms.thu == null ? null : Number(sms.thu) } : {}),
    });
  }
  ra.sort((a, b) => String(a.ngay).localeCompare(String(b.ngay)));
  writeFileSync(RA, `${JSON.stringify({ brand: BRAND, chot: new Date().toISOString().slice(0, 10), don: ra }, null, 1)}\n`);

  console.log(`${RA}: ${ra.length} dòng`);
  for (const x of ra) {
    console.log(`  ${x.ma}  ${x.ngay}  ${x.hang.padEnd(5)} ${x.nuoc.padEnd(2)} ${String(x.canKg).padStart(5)}kg  `
      + `thu ${String(Math.round(x.thuVnd)).padStart(9)}  vốn ${String(Math.round(x.vonVnd ?? 0)).padStart(9)}  `
      + `${'giaChuaDu' in x ? '⚠ CƯỚC TÍNH TRỐNG  ' : ''}${'maSms' in x ? `SMS ${x.maSms} thu ${x.thuSms}` : 'CHƯA vào SMS'}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
