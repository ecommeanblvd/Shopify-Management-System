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
import { and, eq, inArray, notInArray } from 'drizzle-orm';
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

  for (const [loai, ds, tong] of [['freight', cuoc, bk.tongCuoc], ['duty', thue, bk.tongThue]] as const) {
    if (ds.length === 0) continue;
    const cot = loai === 'freight' ? schema.shipHoOrders.statementId : schema.shipHoOrders.dutyStatementId;
    const ids = ds.map((d) => theoMa.get(d.maHt)!);

    const [daCo] = await db.select({
      id: schema.shipHoStatements.id, status: schema.shipHoStatements.status,
      orderCount: schema.shipHoStatements.orderCount,
      total: schema.shipHoStatements.totalChargedVnd,
    }).from(schema.shipHoStatements)
      .where(and(
        eq(schema.shipHoStatements.partnerBrandSlug, brandRow.slug),
        eq(schema.shipHoStatements.periodStart, dau),
        eq(schema.shipHoStatements.type, loai),
      )).limit(1);

    /* ĐÃ THU rồi thì KHÔNG đụng. Tiền đã về, sửa bảng kê lúc này là sửa chứng từ của một
     * giao dịch đã xong — muốn đổi thì đi đường điều chỉnh, không đi đường nhập lại. */
    if (daCo?.status === 'paid') {
      console.log(`    ⚠ ${loai}: bảng kê ${daCo.id.slice(0, 8)} đã THU — BỎ QUA, không nhập lên bản đã thu`);
      continue;
    }

    /* Đơn đang gắn vào bản này mà file MMP KHÔNG có.
     *
     * Vì sao phải gỡ: bản nháp bên SMS do `goBangKeNhap` tự gom theo luật của SMS, còn bản bên
     * MMP là bản ĐÃ CHỐT — hai tập đơn có thể khác nhau. Nhập mà không gỡ thì bảng kê mang
     * tổng của MMP nhưng lại chứa thêm đơn của SMS: tổng và danh sách dòng nói hai chuyện khác
     * nhau, và đơn thừa đó bị kẹt vĩnh viễn trong một kỳ đã đóng (đo 01/10: `26-INSLG-SV-0032`
     * đúng là ca này — nó thuộc kỳ 09 bên MMP nhưng nằm trong nháp kỳ 08 bên SMS).
     *
     * Gỡ ra là đủ: lượt `gom-bang-ke-nhap` kế tiếp xếp nó vào KỲ ĐANG MỞ SỚM NHẤT theo đúng
     * luật mốc, không cần ai dời tay. */
    const la = daCo
      ? await db.select({ id: schema.shipHoOrders.id, code: schema.shipHoOrders.code, status: schema.shipHoOrders.status })
          .from(schema.shipHoOrders)
          .where(and(eq(cot, daCo.id), notInArray(schema.shipHoOrders.id, ids)))
      : [];

    // ── Báo cáo TRƯỚC khi ghi, và báo cả ở chế độ chạy thử: con số quyết định phải thấy được
    //    trước khi bấm, không phải sau.
    if (!daCo) {
      console.log(`    ${loai}: TẠO bảng kê mới · ${ids.length} đơn · ${f(tong)}đ · issued (issued_at NULL)`);
    } else {
      const doiTrangThai = daCo.status !== 'issued' ? ` · ${daCo.status} → issued` : '';
      const soCu = `${daCo.orderCount} đơn / ${f(Number(daCo.total))}đ`;
      const soMoi = `${ids.length} đơn / ${f(tong)}đ`;
      const doiSo = soCu !== soMoi ? ` · số: ${soCu} → ${soMoi}` : ' · số không đổi';
      console.log(`    ${loai}: DÙNG LẠI bảng kê ${daCo.id.slice(0, 8)}${doiTrangThai}${doiSo}`);
    }
    for (const x of la) console.log(`      GỠ ${x.code} — file MMP không có đơn này (lượt gom sau sẽ xếp lại kỳ)`);

    if (!ghi) continue;

    const id = daCo?.id ?? (await db.insert(schema.shipHoStatements).values({
      partnerBrandSlug: brandRow.slug, periodStart: dau, periodEnd: cuoi,
      orderCount: ids.length, totalChargedVnd: String(tong),
      status: 'issued', type: loai,
    }).returning({ id: schema.shipHoStatements.id }))[0]!.id;

    // Gỡ TRƯỚC khi gắn: nếu gắn trước thì `notInArray` đã tính ở trên không còn đúng tập nữa.
    if (la.length > 0) {
      const idLa = la.map((x) => x.id);
      await db.update(schema.shipHoOrders).set(loai === 'freight' ? { statementId: null } : { dutyStatementId: null })
        .where(inArray(schema.shipHoOrders.id, idLa));
      if (loai === 'freight') {
        // 'billed' do `goBangKeNhap` đặt lúc gắn vào kê — lùi về 'shipped' để lượt gom sau
        // nhặt lại được; status khác thì giữ nguyên.
        const idBilled = la.filter((x) => x.status === 'billed').map((x) => x.id);
        if (idBilled.length > 0) {
          await db.update(schema.shipHoOrders).set({ status: 'shipped' }).where(inArray(schema.shipHoOrders.id, idBilled));
        }
      }
    }

    await db.update(schema.shipHoOrders)
      .set(loai === 'freight' ? { statementId: id } : { dutyStatementId: id })
      .where(inArray(schema.shipHoOrders.id, ids));

    /* Bản DÙNG LẠI phải được đổi sang `issued` và mang SỐ CỦA MMP.
     * Nhánh tạo mới vốn đã set; nhánh dùng lại thì bản cũ KHÔNG đổi gì — bản kê vẫn là `draft`
     * với số SMS tự tính, nên `chonKyGom` tiếp tục coi kỳ đó là MỞ và lại nhồi đơn vào. Đó là
     * lý do bốn kỳ-brand của MMP vẫn là nháp bên SMS sau lượt nhập 28/09.
     * `issued_at` vẫn để NGUYÊN (NULL): bảng kê chốt bên MMP, SMS không biết chốt lúc nào (D-124). */
    await db.update(schema.shipHoStatements)
      .set({ status: 'issued', orderCount: ids.length, totalChargedVnd: String(tong) })
      .where(eq(schema.shipHoStatements.id, id));

    console.log(`    ✓ ${loai}: bảng kê ${id.slice(0, 8)} · gắn ${ids.length} đơn · ${f(tong)}đ${la.length ? ` · gỡ ${la.length} đơn` : ''}`);
  }

  if (!ghi) console.log('    (chạy thử — thêm --ghi để nhập)');
}

async function main(): Promise<void> {
  const ghi = process.argv.includes('--ghi');
  const files = process.argv.slice(2).filter((a) => a.endsWith('.xlsx'));
  if (files.length === 0) { process.stderr.write('Thiếu file .xlsx\n'); process.exitCode = 1; return; }
  for (const d of files) await nhapMot(d, ghi);
  process.exit(0);
}
main();
