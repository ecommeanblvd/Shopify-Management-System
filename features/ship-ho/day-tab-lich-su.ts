/**
 * Ghi một tab đối soát KỲ CŨ lên sheet của brand — dùng cho dữ liệu đẩy TAY, không qua bảng kê.
 *
 * Khác `day-sheet.ts`: ở đó tab dựng từ bảng kê trong SMS. Các kỳ trước khi brand lên hệ thống
 * không có bảng kê nào, nên dữ liệu tới từ nguồn đã soát (Lark) và tên tab cố ý KHÔNG khớp khuôn
 * `<tháng>.<năm>` mà `tenTabKy` sinh ra, để lệnh phát hành về sau không xoá đè.
 *
 * Ba cái bẫy đã mắc hôm 19/10/2026, nay nằm một chỗ:
 *
 *   1. THỨ TỰ GHI. Ô của tab tổng hợp là `=SUM('Bán lẻ …'!T2:T3)`, và Google chốt tham chiếu
 *      chéo NGAY LÚC GHI — ghi tab tổng hợp trước khi tab chi tiết tồn tại thì mọi ô thành
 *      `#REF!` VĨNH VIỄN, không tự lành khi tab kia xuất hiện sau. Nên `dayLoatTab` ghi theo
 *      đúng thứ tự được truyền vào rồi mới xếp chỗ, và người gọi phải đặt tab tổng hợp SAU.
 *
 *   2. CỘT CHỮ phải ép `numberFormat: TEXT` TRƯỚC khi ghi. Sổ đặt locale `vi_VN`, và
 *      `USER_ENTERED` đọc "Tháng 7/2025" thành NGÀY rồi lưu serial 45839. Mặt hiện vẫn đúng nên
 *      lỗi này sống sót qua một lượt soát bằng mắt.
 *
 *   3. KIỂU GHI theo từng tab. Bảng chi tiết ghi RAW vì mã tracking là chuỗi 12 chữ số — để
 *      Sheets đoán kiểu thì nó thành SỐ và hiện ra 8,76409E+11. Bảng tổng hợp ngược lại, phải
 *      `USER_ENTERED` vì mọi ô số của nó là công thức.
 */
import { goiSheets } from '@/lib/google/sheets';
import { chuCot } from './hang-sheet';

export interface TabLichSu {
  ten: string;
  dau: readonly string[];
  hang: (string | number)[][];
  /** Chỉ số cột TIỀN (0-based) — đặt định dạng tiền và dựng dòng TỔNG. */
  cotTien: readonly number[];
  /** Cột NGÀY (0-based), null nếu tab không có cột ngày. */
  cotNgay?: number | null;
  /** Cột buộc phải là CHỮ — xem bẫy 2. */
  cotChu?: readonly number[];
  /** Có dòng TỔNG `=SUM(...)` ở cuối hay không. */
  tong: boolean;
  kieu: 'RAW' | 'USER_ENTERED';
  /** Khối ghi chú dưới bảng, mỗi phần tử một dòng ở cột A. */
  ghiChu?: readonly string[];
}

/**
 * Dòng TỔNG cuối bảng: ô tiền là CÔNG THỨC `=SUM(...)`, không phải số tính sẵn.
 *
 * Vì sao công thức: brand lọc hoặc sửa một dòng thì tổng phải đổi theo. Số tính sẵn sẽ đứng yên
 * và nói dối ngay lần đầu ai đó đụng vào bảng.
 */
export function dongTongLichSu(
  soCot: number, cotTien: readonly number[], soDong: number,
): (string | number)[] {
  const ra: (string | number)[] = Array.from({ length: soCot }, () => '');
  // Chữ "Tổng" ở cột B (Mã đơn), cột A để trống — theo nếp sheet Kalisa, xem `dongTong`.
  ra[1] = 'Tổng';
  if (soDong <= 0) return ra;
  for (const c of cotTien) {
    const ch = chuCot(c);
    ra[c] = `=SUM(${ch}2:${ch}${soDong + 1})`;
  }
  return ra;
}

/**
 * Khối hàng liền nhau của từng tháng, trong một danh sách ĐÃ SẮP THEO NGÀY.
 *
 * Vì sao cần: tổng theo tháng ở tab tổng hợp phải là CÔNG THỨC, nhưng `SUMIFS` có nhiều tham số
 * và dấu phân tách tham số đổi theo locale của sổ (sổ đặt `vi_VN`) — viết dấu phẩy có thể ra
 * `#ERROR!`. Mỗi tháng là một khối liền nhau nên `=SUM(T2:T3)` một tham số là đủ, không phụ
 * thuộc locale.
 *
 * Hàng 1 là tiêu đề nên dòng dữ liệu thứ `i` nằm ở hàng `i + 2`.
 */
export function khoiThang(
  ds: ReadonlyArray<{ ngay: string }>,
): Map<string, { tu: number; den: number }> {
  const ra = new Map<string, { tu: number; den: number }>();
  ds.forEach((d, i) => {
    const k = d.ngay.slice(0, 7);
    const hang = i + 2;
    const co = ra.get(k);
    if (!co) ra.set(k, { tu: hang, den: hang });
    else { if (hang < co.tu) co.tu = hang; if (hang > co.den) co.den = hang; }
  });
  return ra;
}

/** Tên tab trong công thức: bọc nháy đơn, nháy đơn trong tên thì nhân đôi. */
export const nhayTab = (ten: string) => `'${ten.replace(/'/g, "''")}'`;

async function ghiMotTab(sheetId: string, t: TabLichSu): Promise<string> {
  const meta = await goiSheets(sheetId, '?fields=sheets.properties(sheetId,title)');
  const cu = (meta.sheets as { properties: { sheetId: number; title: string } }[])
    .find((s) => s.properties.title === t.ten)?.properties.sheetId;
  if (cu != null) {
    await goiSheets(sheetId, ':batchUpdate', { method: 'POST',
      body: JSON.stringify({ requests: [{ deleteSheet: { sheetId: cu } }] }) });
  }
  const them = await goiSheets(sheetId, ':batchUpdate', { method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: t.ten } } }] }) });
  const idTab = ((them.replies as { addSheet: { properties: { sheetId: number } } }[])[0]).addSheet.properties.sheetId;

  /* Locale + định dạng cột đặt TRƯỚC khi ghi: sổ mặc định `en_US` đọc "03/07" thành 7 tháng 3,
   * cột không có định dạng ngày thì serial hiện ra như 46209, và xem bẫy 2 về cột chữ. */
  const truoc: unknown[] = [
    { updateSpreadsheetProperties: { properties: { locale: 'vi_VN' }, fields: 'locale' } },
  ];
  if (t.cotNgay != null) {
    truoc.push({ repeatCell: {
      range: { sheetId: idTab, startRowIndex: 1, startColumnIndex: t.cotNgay, endColumnIndex: t.cotNgay + 1 },
      cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } } },
      fields: 'userEnteredFormat.numberFormat' } });
  }
  for (const c of t.cotChu ?? []) {
    truoc.push({ repeatCell: {
      range: { sheetId: idTab, startColumnIndex: c, endColumnIndex: c + 1 },
      cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } },
      fields: 'userEnteredFormat.numberFormat' } });
  }
  await goiSheets(sheetId, ':batchUpdate', { method: 'POST', body: JSON.stringify({ requests: truoc }) });

  await goiSheets(sheetId, `/values/${encodeURIComponent(t.ten)}!A1?valueInputOption=${t.kieu}`, {
    method: 'PUT', body: JSON.stringify({ values: [[...t.dau], ...t.hang] }),
  });

  let hangCuoi = t.hang.length + 1;
  if (t.tong) {
    hangCuoi = t.hang.length + 2;
    /* Dòng TỔNG ghi RIÊNG bằng USER_ENTERED để `=SUM(...)` thành công thức thật. Ghi chung với
     * dữ liệu thì phải chọn một kiểu cho cả bảng — xem bẫy 3. */
    await goiSheets(sheetId, `/values/${encodeURIComponent(t.ten)}!A${hangCuoi}?valueInputOption=USER_ENTERED`, {
      method: 'PUT', body: JSON.stringify({ values: [dongTongLichSu(t.dau.length, t.cotTien, t.hang.length)] }),
    });
  }
  if ((t.ghiChu ?? []).length > 0) {
    await goiSheets(sheetId, `/values/${encodeURIComponent(t.ten)}!A${hangCuoi + 2}?valueInputOption=RAW`, {
      method: 'PUT', body: JSON.stringify({ values: (t.ghiChu ?? []).map((x) => [x]) }),
    });
  }

  await goiSheets(sheetId, ':batchUpdate', { method: 'POST', body: JSON.stringify({ requests: [
    // Cố định hàng tiêu đề và hai cột đầu — cuộn ngang vẫn biết đang xem đơn nào.
    { updateSheetProperties: {
      properties: { sheetId: idTab, gridProperties: { frozenRowCount: 1, frozenColumnCount: 2 } },
      fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount' } },
    { repeatCell: {
      range: { sheetId: idTab, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: t.dau.length },
      cell: { userEnteredFormat: {
        backgroundColor: { red: 0.12, green: 0.22, blue: 0.39 },
        horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP',
        textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
      } },
      fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)' } },
    ...t.cotTien.map((c) => ({ repeatCell: {
      range: { sheetId: idTab, startRowIndex: 1, endRowIndex: hangCuoi, startColumnIndex: c, endColumnIndex: c + 1 },
      cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '#,##0" đ"' } } },
      fields: 'userEnteredFormat.numberFormat' } })),
    /* Dòng TỔNG: nền vàng #FFF2CC + in đậm + kẻ trên — màu đọc từ tab 7.26/8.26 của sheet
     * Kalisa, theo nếp brand đã quen mắt. */
    { repeatCell: {
      range: { sheetId: idTab, startRowIndex: hangCuoi - 1, endRowIndex: hangCuoi, startColumnIndex: 0, endColumnIndex: t.dau.length },
      cell: { userEnteredFormat: {
        backgroundColor: { red: 1, green: 0.9490196, blue: 0.8 },
        textFormat: { bold: true },
        borders: { top: { style: 'SOLID', width: 2 } },
      } },
      fields: 'userEnteredFormat(backgroundColor,textFormat,borders)' } },
    { autoResizeDimensions: {
      dimensions: { sheetId: idTab, dimension: 'COLUMNS', startIndex: 0, endIndex: t.dau.length } } },
  ] }) });
  return `${t.hang.length} dòng${t.tong ? ' + dòng tổng' : ''}`;
}

/**
 * Ghi loạt tab rồi xếp về đúng thứ tự `thuTu`.
 *
 * `tabs` phải xếp sao cho tab được THAM CHIẾU đứng TRƯỚC tab tham chiếu nó — xem bẫy 1. Việc xếp
 * chỗ làm sau cùng, từng tab một, vì `addSheet` luôn đẩy tab mới xuống cuối sổ.
 */
export async function dayLoatTab(
  sheetId: string, tabs: readonly TabLichSu[], thuTu: readonly string[],
  log: (s: string) => void = () => {},
): Promise<void> {
  for (const t of tabs) log(`✓ ${t.ten}: ${await ghiMotTab(sheetId, t)}`);
  for (let i = 0; i < thuTu.length; i++) {
    const meta = await goiSheets(sheetId, '?fields=sheets.properties(sheetId,title)');
    const id = (meta.sheets as { properties: { sheetId: number; title: string } }[])
      .find((x) => x.properties.title === thuTu[i])?.properties.sheetId;
    if (id == null) continue;
    await goiSheets(sheetId, ':batchUpdate', { method: 'POST', body: JSON.stringify({ requests: [
      { updateSheetProperties: { properties: { sheetId: id, index: i }, fields: 'index' } },
    ] }) });
  }
}
