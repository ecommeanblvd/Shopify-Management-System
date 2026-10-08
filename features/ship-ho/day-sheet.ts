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
import { ghiLenSheet } from './dong-sheet-loc';
import {
  COT_SHEET, hangSheet, COT_SHEET_DUTY, hangSheetDuty,
  COT_TIEN, COT_TIEN_DUTY, dongTong,
  type DonSheet, type DonSheetDuty,
} from './hang-sheet';

const n = (v: unknown) => Number(v ?? 0);

/**
 * Tên tab theo nếp sheet Kalisa: "7.26", "8.26", và "8.26 Duty" cho bảng kê thuế.
 *
 * Hậu tố loại là BẮT BUỘC: một brand có thể có cả bảng kê cước lẫn bảng kê thuế TRONG CÙNG MỘT
 * KỲ (lekieu và tom-fried đều vậy ở kỳ 09). Đặt tên chỉ theo tháng thì bảng này xoá tab của
 * bảng kia — bản đầu mắc đúng lỗi đó, phát hiện lúc gắn sheet 03/10/2026.
 */
export function tenTabKy(periodStart: string, type: string): string {
  const [nam, thang] = periodStart.slice(0, 10).split('-');
  return `${Number(thang)}.${nam.slice(2)}${type === 'duty' ? ' Duty' : ''}`;
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
    /* Đơn MIỄN THU không lên bảng brand đọc — xem `ghiLenSheet`. Bảng kê trong hệ thống vẫn
     * giữ nguyên dòng 0đ để còn dấu vết và để bản điều chỉnh gửi MMP dựa vào. */
    if (!ghiLenSheet({ tongThu: n(o.giaThuVnd) })) continue;
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

/**
 * Dòng cho bảng kê THUẾ.
 *
 * Đơn thuộc bảng kê thuế qua cột `duty_statement_id`, KHÔNG phải `statement_id` — một đơn vừa
 * nằm trong bảng cước của kỳ này vừa nằm trong bảng thuế của kỳ khác, vì hoá đơn thuế FedEx về
 * sau hoá đơn cước 3–6 tuần. Bản đầu dùng nhầm cột nên tab duty ghi ra 0 dòng.
 */
async function dungDonSheetDuty(statementId: string): Promise<DonSheetDuty[]> {
  const r = await db.execute<Record<string, unknown>>(sql`
    SELECT o.code, o.brand_reference, o.tracking_number, o.country, o.shipped_at::date gui,
           o.picked_up_at, o.actual_duty_vnd, o.duty_bill_numbers
    FROM ship_ho_orders o WHERE o.duty_statement_id = ${statementId}
    ORDER BY o.shipped_at;`);
  return r.rows.map((x, i) => ({
    stt: i + 1,
    maBrand: String(x.brand_reference ?? x.code), tracking: String(x.tracking_number ?? ''),
    ngayDi: ngayDiHang({
      pickedUpAt: x.picked_up_at as Date | null,
      shippedAt: x.gui == null ? null : String(x.gui),
    }).ngay,
    nuoc: String(x.country ?? ''),
    soHoaDon: Array.isArray(x.duty_bill_numbers) ? (x.duty_bill_numbers as string[]).join(' + ')
      : String(x.duty_bill_numbers ?? ''),
    duty: n(x.actual_duty_vnd), maSms: String(x.code),
  }));
}

export async function dayBangKeLenSheet(statementId: string): Promise<{ ok: boolean; detail: string }> {
  const [ke] = await db.select({
    brand: schema.shipHoStatements.partnerBrandSlug,
    ky: schema.shipHoStatements.periodStart,
    type: schema.shipHoStatements.type,
  }).from(schema.shipHoStatements).where(eq(schema.shipHoStatements.id, statementId)).limit(1);
  if (!ke) return { ok: false, detail: 'không thấy bảng kê' };

  const [dt] = await db.select({ sheetId: schema.shipHoPartners.doiSoatSheetId })
    .from(schema.shipHoPartners).where(eq(schema.shipHoPartners.brandSlug, ke.brand)).limit(1);
  if (!dt?.sheetId) {
    return { ok: true, detail: `brand ${ke.brand} chưa có sheet đối soát — tạo rồi chia sẻ quyền writer cho ${process.env.GOOGLE_SA_EMAIL ?? 'tài khoản dịch vụ'} và dán id vào trang đối tác` };
  }

  const laDuty = ke.type === 'duty';
  const dau: readonly string[] = laDuty ? COT_SHEET_DUTY : COT_SHEET;
  const hang = laDuty ? hangSheetDuty(await dungDonSheetDuty(statementId)) : hangSheet(await dungDonSheet(statementId));
  const tenTab = tenTabKy(String(ke.ky), String(ke.type));

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
      // Cột "Ngày gửi" đứng ở E trên bảng cước, D trên bảng thuế.
      range: { sheetId: idTab, startRowIndex: 1, startColumnIndex: laDuty ? 3 : 4, endColumnIndex: laDuty ? 4 : 5 },
      cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } } },
      fields: 'userEnteredFormat.numberFormat' } },
  ] }) });

  /* Dữ liệu ghi RAW, KHÔNG phải USER_ENTERED: mã tracking là chuỗi 12 chữ số, để Sheets tự
   * đoán kiểu thì nó thành SỐ và hiện ra 8,76409E+11 — mất luôn khả năng tra cứu. */
  await goiSheets(dt.sheetId, `/values/${encodeURIComponent(tenTab)}!A1?valueInputOption=RAW`, {
    method: 'PUT', body: JSON.stringify({ values: [[...dau], ...hang] }),
  });

  /* Dòng TỔNG ghi RIÊNG bằng USER_ENTERED để `=SUM(...)` thành công thức thật. Ghi chung với
   * dữ liệu thì phải chọn một kiểu cho cả bảng: RAW biến công thức thành chữ, USER_ENTERED
   * phá mã tracking. Hai lượt ghi là cách duy nhất giữ được cả hai. */
  const cotTien: readonly number[] = laDuty ? COT_TIEN_DUTY : COT_TIEN;
  const hangTong = hang.length + 2;
  await goiSheets(dt.sheetId, `/values/${encodeURIComponent(tenTab)}!A${hangTong}?valueInputOption=USER_ENTERED`, {
    method: 'PUT', body: JSON.stringify({ values: [dongTong(dau.length, cotTien, hang.length)] }),
  });

  await goiSheets(dt.sheetId, ':batchUpdate', { method: 'POST', body: JSON.stringify({ requests: [
    // Cố định hàng tiêu đề và hai cột đầu (STT + Mã đơn) — cuộn ngang vẫn biết đang xem đơn nào.
    { updateSheetProperties: {
      properties: { sheetId: idTab, gridProperties: { frozenRowCount: 1, frozenColumnCount: 2 } },
      fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount' } },
    // Tiêu đề: nền đậm, chữ trắng, canh giữa, xuống dòng — tên cột dài không bị cắt.
    { repeatCell: {
      range: { sheetId: idTab, startRowIndex: 0, endRowIndex: 1 },
      cell: { userEnteredFormat: {
        backgroundColor: { red: 0.12, green: 0.22, blue: 0.39 },
        horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP',
        textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
      } },
      fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)' } },
    // Tiền: định dạng ở CẤP CỘT (phủ cả dòng TỔNG và dòng brand thêm sau này).
    ...cotTien.map((c) => ({ repeatCell: {
      range: { sheetId: idTab, startRowIndex: 1, startColumnIndex: c, endColumnIndex: c + 1 },
      cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '#,##0" đ"' } } },
      fields: 'userEnteredFormat.numberFormat' } })),
    // Dòng TỔNG: in đậm, có đường kẻ trên để tách khỏi phần dữ liệu.
    { repeatCell: {
      range: { sheetId: idTab, startRowIndex: hangTong - 1, endRowIndex: hangTong },
      cell: { userEnteredFormat: {
        textFormat: { bold: true },
        borders: { top: { style: 'SOLID', width: 2 } },
      } },
      fields: 'userEnteredFormat(textFormat,borders)' } },
    { autoResizeDimensions: {
      dimensions: { sheetId: idTab, dimension: 'COLUMNS', startIndex: 0, endIndex: dau.length } } },
  ] }) });

  return { ok: true, detail: `ghi ${hang.length} dòng + dòng tổng vào tab ${tenTab}` };
}
