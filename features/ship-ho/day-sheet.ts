/**
 * Ghi một kỳ bảng kê lên sheet đối soát của brand.
 *
 * Tab do MÁY sở hữu: xoá sạch rồi ghi lại mỗi lượt. Không sửa từng ô — sửa từng ô phải dò theo
 * mã đơn, và chỉ cần ai chèn một cột là ghi lệch chỗ, im lặng.
 *
 * Brand chưa có `doi_soat_sheet_id` thì KHÔNG coi là lỗi: trả một dòng báo việc. Chốt kỳ không
 * được phụ thuộc vào việc CEO đã kịp tạo sheet hay chưa — và tài khoản dịch vụ không tự tạo
 * được sheet (Google trả `storageQuotaExceeded`).
 */
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { goiSheets } from '@/lib/google/sheets';
import { getShipHoStatement } from './statement-queries';
import { shipHoPriceStructure } from './price-structure';
import { ngayDiHang } from './ngay-di-hang';
import { COT_SHEET, hangSheet, type DonSheet } from './hang-sheet';

const n = (v: unknown) => Number(v ?? 0);

/** Tên tab theo nếp sheet Kalisa: "7.26", "8.26" — tháng.năm, không số 0 ở đầu. */
export function tenTabKy(periodStart: string): string {
  const [nam, thang] = periodStart.slice(0, 10).split('-');
  return `${Number(thang)}.${nam.slice(2)}`;
}

/**
 * Dựng dòng sheet từ đúng cấu trúc giá mà màn đối soát đang dùng — không tính lại bằng tay.
 *
 * Hai truy vấn, cố ý: `getShipHoStatement` giữ luật "giá nào được tính" (`giaThuVnd`) nhưng chỉ
 * trả tập cột gọn, không có breakdown. Nống cột của nó là bắt mọi người gọi khác phải tải theo
 * hai cột jsonb nặng mà họ không cần. Nên lấy breakdown bằng một truy vấn riêng rồi ghép theo
 * mã đơn.
 */
async function dungDonSheet(statementId: string): Promise<DonSheet[]> {
  const data = await getShipHoStatement(statementId);
  if (!data) return [];
  const [dt] = await db.select({ markup: schema.shipHoPartners.markupPercent })
    .from(schema.shipHoPartners)
    .where(eq(schema.shipHoPartners.brandSlug, data.statement.partnerBrandSlug)).limit(1);

  const chiTiet = new Map<string, Record<string, unknown>>();
  for (const x of (await db.execute<Record<string, unknown>>(sql`
    SELECT o.code, o.carrier_key, o.actual_weight_kg, o.quote_breakdown, o.actual_bill_breakdown,
           o.carrier_cost_vnd, o.charged_vnd
    FROM ship_ho_orders o WHERE o.statement_id = ${statementId};`)).rows) {
    chiTiet.set(String(x.code), x);
  }

  const ra: DonSheet[] = [];
  let stt = 0;
  for (const o of data.orders as Array<Record<string, unknown>>) {
    const ct = chiTiet.get(String(o.code));
    if (!ct) continue;
    const ab = ct.actual_bill_breakdown as Record<string, unknown> | null;
    const ps = shipHoPriceStructure({
      breakdown: ct.quote_breakdown, carrierCostVnd: n(ct.carrier_cost_vnd),
      chargedVnd: n(ct.charged_vnd), markupPercent: n(dt?.markup),
      actualBill: ab ? { breakdown: ab, totalVnd: n(ab.total), weightKg: null } : null,
      actualDutyVnd: o.actualDutyVnd == null ? null : n(o.actualDutyVnd),
    });
    /* `shipHoPriceStructure` trả null khi breakdown báo giá thiếu — đơn đó BỎ QUA thay vì ghi
     * một hàng toàn số 0 lên bảng brand đọc. Thiếu dòng thì thấy ngay; hàng 0 thì không. */
    if (!ps) continue;
    const lay = (nhan: string) => ps.rows.find((x) => x.label.startsWith(nhan))?.chargeVnd ?? 0;
    const f = ps.rows.find((x) => x.label === 'Phụ phí xăng dầu');
    ra.push({
      stt: ++stt,
      maBrand: String(o.brandReference ?? o.code), tracking: String(o.trackingNumber ?? ''),
      hang: String(ct.carrier_key ?? '').toUpperCase(),
      ngayDi: ngayDiHang(o as { pickedUpAt: Date | null; shippedAt: string | null }).ngay,
      canKg: n(ct.actual_weight_kg), nuoc: String(o.country ?? ''),
      cuoc: lay('Cước cơ bản'), pctFuel: f?.billPercent ?? f?.percent ?? null,
      fuel: lay('Phụ phí xăng dầu'), kyNhan: lay('Ký nhận'), nhuCau: lay('Phụ phí nhu cầu'),
      vungXa: lay('Phụ phí vùng xa'), nhaDan: lay('Giao nhà dân'),
      xuLyNhap: lay('Phí xử lý hàng nhập'), suaDiaChi: lay('Phí sửa địa chỉ'),
      phuPhiKhac: lay('Phụ phí khác'), vat: lay('VAT'), xuLyDon: lay('Phí xử lý đơn hàng'),
      tongThu: n(o.giaThuVnd), maSms: String(o.code),
    });
  }
  return ra;
}

export async function dayBangKeLenSheet(statementId: string): Promise<{ ok: boolean; detail: string }> {
  const [ke] = await db.select({
    brand: schema.shipHoStatements.partnerBrandSlug,
    ky: schema.shipHoStatements.periodStart,
  }).from(schema.shipHoStatements).where(eq(schema.shipHoStatements.id, statementId)).limit(1);
  if (!ke) return { ok: false, detail: 'không thấy bảng kê' };

  const [dt] = await db.select({ sheetId: schema.shipHoPartners.doiSoatSheetId })
    .from(schema.shipHoPartners).where(eq(schema.shipHoPartners.brandSlug, ke.brand)).limit(1);
  if (!dt?.sheetId) {
    return { ok: true, detail: `brand ${ke.brand} chưa có sheet đối soát — tạo rồi chia sẻ quyền writer cho ${process.env.GOOGLE_SA_EMAIL ?? 'tài khoản dịch vụ'} và dán id vào trang đối tác` };
  }

  const don = await dungDonSheet(statementId);
  const tenTab = tenTabKy(String(ke.ky));

  const meta = await goiSheets(dt.sheetId, '?fields=sheets.properties(sheetId,title)');
  const cu = (meta.sheets as { properties: { sheetId: number; title: string } }[])
    .find((s) => s.properties.title === tenTab)?.properties.sheetId;
  if (cu != null) {
    await goiSheets(dt.sheetId, ':batchUpdate', { method: 'POST',
      body: JSON.stringify({ requests: [{ deleteSheet: { sheetId: cu } }] }) });
  }
  const them = await goiSheets(dt.sheetId, ':batchUpdate', { method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tenTab } } }] }) });
  const idTab = ((them.replies as { addSheet: { properties: { sheetId: number } } }[])[0]).addSheet.properties.sheetId;

  /* Locale `vi_VN` và định dạng cột ngày phải đặt TRƯỚC khi ghi: sheet mặc định `en_US` đọc
     "03/07" thành 7 tháng 3, và cột không có định dạng ngày thì serial hiện ra như số 46209. */
  await goiSheets(dt.sheetId, ':batchUpdate', { method: 'POST', body: JSON.stringify({ requests: [
    { updateSpreadsheetProperties: { properties: { locale: 'vi_VN' }, fields: 'locale' } },
    { repeatCell: {
      range: { sheetId: idTab, startRowIndex: 1, startColumnIndex: 4, endColumnIndex: 5 },
      cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } } },
      fields: 'userEnteredFormat.numberFormat' } },
  ] }) });

  await goiSheets(dt.sheetId, `/values/${encodeURIComponent(tenTab)}!A1?valueInputOption=RAW`, {
    method: 'PUT', body: JSON.stringify({ values: [[...COT_SHEET], ...hangSheet(don)] }),
  });
  return { ok: true, detail: `ghi ${don.length} dòng vào tab ${tenTab}` };
}
