/**
 * Nhập bảng kê ship-hộ ĐÃ CHỐT bên MMP vào SMS (CEO 28/09/2026).
 *
 * `railway run npx tsx scripts/nhap-bang-ke-mmp.ts <file.xlsx> [...] [--ghi]`
 *
 * Vì sao cần: SMS không lưu bảng kê nào cho Kalisa (134/134 đơn `statement_id`
 * rỗng) nên nhìn vào hệ thống không biết đơn nào đã xuất chứng từ thu tiền, đơn
 * nào chưa. Hai kỳ 07 và 08 đã chốt bên MMP — nhập vào để phần CÒN LẠI tự lộ ra.
 *
 * Chỉ ghi khi có `--ghi`; chạy thử mặc định. Idempotent theo (brand, kỳ, loại).
 *
 * KHÔNG bịa `issued_at`: bảng kê chốt bên MMP, SMS không biết chốt lúc nào, nên
 * để NULL thay vì điền một ngày trông hợp lý (D-124).
 */
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';

interface Dong { maShop: string; maHt: string; loai: 'Cước' | 'Thuế/phí'; tien: number }
interface BangKe { brand: string; ky: string; dong: Dong[]; tongCuoc: number; tongThue: number; tong: number }

/** THUẦN: đọc một file bảng kê MMP → dòng + tổng do CHÍNH file khai. */
export function docBangKe(buf: Buffer): BangKe {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]!]!;
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
  const tieuDe = String(aoa[0]?.[0] ?? '');
  const brand = tieuDe.split('—').pop()?.trim() ?? '';
  const ky = String(aoa.find((r) => r[0] === 'Kỳ')?.[1] ?? '');
  const iHead = aoa.findIndex((r) => r[0] === 'Mã đơn shop');
  if (!brand || !ky || iHead < 0) throw new Error('File không đúng dạng bảng kê MMP');

  const dong: Dong[] = [];
  let tongCuoc = 0, tongThue = 0, tong = 0;
  for (let i = iHead + 1; i < aoa.length; i++) {
    const r = aoa[i]!;
    if (r[0] === 'TỔNG' && r[1] == null) { tong = Number(r[5]); continue; }
    if (r[0] === 'Cước' && r[1] == null) { tongCuoc = Number(r[5]); continue; }
    if (r[0] === 'Thuế/phí' && r[1] == null) { tongThue = Number(r[5]); continue; }
    if (!r[1]) continue;
    dong.push({
      maShop: String(r[0] ?? ''), maHt: String(r[1]).trim(),
      loai: r[2] === 'Cước' ? 'Cước' : 'Thuế/phí', tien: Number(r[5]),
    });
  }
  return { brand, ky, dong, tongCuoc, tongThue, tong };
}

/** THUẦN: "2026-08" → mốc đầu/cuối tháng dạng YYYY-MM-DD. */
export function moDauCuoiKy(ky: string): { dau: string; cuoi: string } {
  const [y, m] = ky.split('-').map(Number) as [number, number];
  const cuoi = new Date(Date.UTC(y, m, 0));
  return { dau: `${ky}-01`, cuoi: cuoi.toISOString().slice(0, 10) };
}

const f = (n: number) => Math.round(n).toLocaleString('vi-VN');

async function nhapMot(duong: string, ghi: boolean): Promise<void> {
  const bk = docBangKe(readFileSync(duong));
  const { dau, cuoi } = moDauCuoiKy(bk.ky);
  const cuoc = bk.dong.filter((d) => d.loai === 'Cước');
  const thue = bk.dong.filter((d) => d.loai !== 'Cước');
  console.log(`\n=== ${bk.brand} · kỳ ${bk.ky} (${dau} → ${cuoi})`);
  console.log(`    ${cuoc.length} dòng cước ${f(bk.tongCuoc)}đ · ${thue.length} dòng thuế/phí ${f(bk.tongThue)}đ · TỔNG ${f(bk.tong)}đ`);

  // Tổng file tự khai phải bằng tổng các dòng — file sai thì DỪNG, không nhập một nửa.
  const congCuoc = cuoc.reduce((s, d) => s + d.tien, 0);
  const congThue = thue.reduce((s, d) => s + d.tien, 0);
  if (Math.abs(congCuoc - bk.tongCuoc) > 1 || Math.abs(congThue - bk.tongThue) > 1) {
    throw new Error(`Tổng file không khớp tổng dòng: cước ${f(congCuoc)}/${f(bk.tongCuoc)}, thuế ${f(congThue)}/${f(bk.tongThue)}`);
  }

  const [brandRow] = await db.select({ slug: schema.mmpBrands.slug })
    .from(schema.mmpBrands).where(eq(schema.mmpBrands.displayName, bk.brand)).limit(1);
  if (!brandRow) throw new Error(`Không thấy brand "${bk.brand}" trong mmp_brands`);

  const maHt = [...new Set(bk.dong.map((d) => d.maHt))];
  const don = await db.select({ id: schema.shipHoOrders.id, code: schema.shipHoOrders.code })
    .from(schema.shipHoOrders).where(inArray(schema.shipHoOrders.code, maHt));
  const theoMa = new Map(don.map((o) => [o.code, o.id]));
  const thieu = maHt.filter((m) => !theoMa.has(m));
  if (thieu.length) throw new Error(`${thieu.length} mã trên bảng kê không có trong SMS: ${thieu.join(', ')}`);
  console.log(`    ${maHt.length} đơn phân biệt, khớp ${theoMa.size} trong SMS`);

  if (!ghi) { console.log('    (chạy thử — thêm --ghi để nhập)'); return; }

  for (const [loai, ds, tong] of [['freight', cuoc, bk.tongCuoc], ['duty', thue, bk.tongThue]] as const) {
    if (ds.length === 0) continue;
    const [daCo] = await db.select({ id: schema.shipHoStatements.id })
      .from(schema.shipHoStatements)
      .where(and(
        eq(schema.shipHoStatements.partnerBrandSlug, brandRow.slug),
        eq(schema.shipHoStatements.periodStart, dau),
        eq(schema.shipHoStatements.type, loai),
      )).limit(1);
    const id = daCo?.id ?? (await db.insert(schema.shipHoStatements).values({
      partnerBrandSlug: brandRow.slug, periodStart: dau, periodEnd: cuoi,
      orderCount: ds.length, totalChargedVnd: String(tong),
      status: 'issued', type: loai,
    }).returning({ id: schema.shipHoStatements.id }))[0]!.id;

    const ids = ds.map((d) => theoMa.get(d.maHt)!);
    await db.update(schema.shipHoOrders)
      .set(loai === 'freight' ? { statementId: id } : { dutyStatementId: id })
      .where(inArray(schema.shipHoOrders.id, ids));
    console.log(`    ✓ ${loai}: bảng kê ${id.slice(0, 8)} · gắn ${ids.length} đơn · ${f(tong)}đ`);
  }
}

async function main(): Promise<void> {
  const ghi = process.argv.includes('--ghi');
  const files = process.argv.slice(2).filter((a) => a.endsWith('.xlsx'));
  if (files.length === 0) { process.stderr.write('Thiếu file .xlsx\n'); process.exitCode = 1; return; }
  for (const d of files) await nhapMot(d, ghi);
  process.exit(0);
}
main();
