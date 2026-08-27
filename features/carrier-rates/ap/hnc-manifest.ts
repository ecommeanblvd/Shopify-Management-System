/**
 * Parser BẢNG KÊ CƯỚC PHÍ của Hợp Nhất (HNC) — đối tác Aramex tại Việt Nam.
 *
 * Đây là nguồn CHI TIẾT NHẤT trong ba file HNC gửi cùng một kỳ:
 *   - bảng kê Excel (file này): ngày gửi, nước đến, cân nặng, cước gốc, phụ phí
 *     xăng dầu, phí phát sinh, tỉ giá — đủ để đối soát từng khoản
 *   - hoá đơn XML: số hoá đơn, thuế, chữ ký số — nhưng mỗi vận đơn chỉ còn MỘT
 *     con số tổng
 *   - hoá đơn PDF: bản in của XML, không thêm thông tin nào
 *
 * Đối chiếu kỳ 25/07–22/08/2026: 36 vận đơn của bảng kê khớp từng đồng với hoá
 * đơn XML (39.046.934₫), nên hai file mô tả cùng một kỳ và ghép được với nhau
 * qua số vận đơn quốc tế.
 *
 * Bảng kê KHÔNG có số hoá đơn — muốn bill mang đúng số hoá đơn thì phải kèm XML.
 */

export interface HncManifestLine {
  /** Ngày gửi hàng (YYYY-MM-DD) — dùng điền ngày đi hàng cho shipment. */
  shipDate: string | null;
  /** Mã vận đơn nội bộ của HNC. */
  hncBill: string | null;
  /** Vận đơn quốc tế — khoá để ghép với hoá đơn và với đơn trong hệ thống. */
  trackingNumber: string;
  destination: string | null;
  /** Loại kiện theo HNC ('P'…). */
  kind: string | null;
  weightKg: number | null;
  baseUsd: number | null;
  fuelUsd: number | null;
  /** Phí phát sinh (HNC gộp chung một cột, không tách tên khoản). */
  extraUsd: number | null;
  totalUsd: number | null;
  totalVnd: number | null;
}

export interface HncManifest {
  periodStart: string | null;
  periodEnd: string | null;
  customerCode: string | null;
  buyerName: string | null;
  buyerTaxCode: string | null;
  /** Tỉ giá USD→VND mà HNC dùng cho chính kỳ này. */
  fxRate: number | null;
  amountExVat: number | null;
  vatPercent: number | null;
  vatAmount: number | null;
  amountInclVat: number | null;
  lines: HncManifestLine[];
  warnings: string[];
}

const chuoi = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
/**
 * Đọc số từ ô bảng kê. Bảng kê trộn hai kiểu viết trong cùng một file: cột USD
 * dùng dấu chấm THẬP PHÂN (17.4) còn cột VNĐ dùng dấu chấm NGĂN NGHÌN
 * (605.656). Bỏ chấm vô điều kiện sẽ biến 17,4 USD thành 174 USD — đúng loại
 * lỗi âm thầm làm sai cả bảng đối soát.
 */
const so = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/\s/g, '');
  if (!s) return null;
  // Chỉ bỏ dấu chấm khi nó đứng đúng vị trí ngăn nghìn (1.234 / 1.234.567).
  const nganNghin = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s);
  const chuan = nganNghin ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = Number(chuan);
  return Number.isFinite(n) ? n : null;
};

/** Chỉ để test canh cách đọc số — không dùng ở nơi khác. */
export const docSo = so;

/** Excel đếm ngày từ 30/12/1899. Cũng nhận sẵn chuỗi dd/mm/yyyy phòng khi máy
 *  xuất ra dạng chữ thay vì số. */
export function ngayTuSerialExcel(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
}

/** Tìm dòng đầu tiên có ô khớp `re`, trả chỉ số dòng + chỉ số cột. */
function timO(rows: readonly unknown[][], re: RegExp): { r: number; c: number } | null {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      if (re.test(chuoi(row[c]))) return { r, c };
    }
  }
  return null;
}

/** Giá trị đầu tiên khác rỗng nằm bên phải một nhãn (nhãn và giá trị cách nhau
 *  vài ô vì bảng kê dùng ô gộp). */
function giaTriSauNhan(rows: readonly unknown[][], re: RegExp): string | null {
  const o = timO(rows, re);
  if (!o) return null;
  const row = rows[o.r] ?? [];
  for (let c = o.c + 1; c < row.length; c++) {
    const v = chuoi(row[c]);
    if (v) return v;
  }
  return null;
}

export function parseHncManifestRows(rows: readonly unknown[][]): HncManifest | null {
  if (!rows.length) return null;
  // Dò theo TÊN cột: bảng kê tháng sau xê dịch vài dòng là chuyện thường.
  const tieuDe = timO(rows, /^Bill quốc tế$/i);
  if (!tieuDe) return null;
  const hangTieuDe = rows[tieuDe.r] ?? [];

  const cot = (re: RegExp): number => hangTieuDe.findIndex((v) => re.test(chuoi(v)));
  const cAwb = tieuDe.c;
  const cNgay = cot(/^Ngày$/i);
  const cHnc = cot(/^Bill HNC$/i);
  const cNoiDen = cot(/^Nơi đến$/i);
  const cLoai = cot(/^Loại$/i);
  const cKg = cot(/Trọng lượng/i);
  const cGia = cot(/^Giá\s*\(USD\)/i);
  const cFuel = cot(/xăng dầu/i);
  const cPhatSinh = cot(/phát sinh/i);
  const cTongUsd = cot(/Tổng cước phí\s*\(USD\)/i);
  const cTongVnd = cot(/Tổng cước phí\s*\(VN/i);

  const lay = (row: readonly unknown[], c: number): unknown => (c >= 0 ? row[c] : null);

  const lines: HncManifestLine[] = [];
  let amountExVat: number | null = null;
  for (let r = tieuDe.r + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    // Dòng "Cộng" đóng bảng — sau nó là phần chân trang, không phải vận đơn.
    if (/^Cộng$/i.test(chuoi(row[0]))) {
      amountExVat = so(lay(row, cTongVnd));
      break;
    }
    const awb = chuoi(lay(row, cAwb));
    if (!awb) continue;
    lines.push({
      shipDate: ngayTuSerialExcel(lay(row, cNgay)),
      hncBill: chuoi(lay(row, cHnc)) || null,
      trackingNumber: awb,
      destination: chuoi(lay(row, cNoiDen)) || null,
      kind: chuoi(lay(row, cLoai)) || null,
      weightKg: so(lay(row, cKg)),
      baseUsd: so(lay(row, cGia)),
      fuelUsd: so(lay(row, cFuel)),
      extraUsd: so(lay(row, cPhatSinh)),
      totalUsd: so(lay(row, cTongUsd)),
      totalVnd: so(lay(row, cTongVnd)),
    });
  }

  const ky = timO(rows, /Từ ngày/i);
  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  if (ky) {
    const text = chuoi((rows[ky.r] ?? [])[ky.c]);
    const m = text.match(/Từ ngày:?\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*đến\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (m) { periodStart = ngayTuSerialExcel(m[1]); periodEnd = ngayTuSerialExcel(m[2]); }
  }

  const thueSuat = timO(rows, /Thuế suất thuế GTGT/i);
  const vatPercent = thueSuat
    ? Number(chuoi((rows[thueSuat.r] ?? [])[thueSuat.c]).match(/([\d.]+)\s*%/)?.[1] ?? '') || null
    : null;

  const warnings: string[] = [];
  const tongDong = lines.reduce((s, l) => s + (l.totalVnd ?? 0), 0);
  if (amountExVat !== null && Math.abs(tongDong - amountExVat) > 1) {
    warnings.push(`Cộng các dòng (${tongDong.toLocaleString('vi-VN')}₫) lệch so với dòng Cộng của bảng kê (${amountExVat.toLocaleString('vi-VN')}₫) — kiểm tra lại file.`);
  }
  const thieuVnd = lines.filter((l) => l.totalVnd === null).length;
  if (thieuVnd > 0) warnings.push(`${thieuVnd} dòng thiếu tổng cước VNĐ.`);

  return {
    periodStart,
    periodEnd,
    customerCode: giaTriSauNhan(rows, /^Mã khách hàng/i),
    buyerName: giaTriSauNhan(rows, /^Tên khách hàng/i),
    buyerTaxCode: giaTriSauNhan(rows, /^Mã số thuế/i),
    fxRate: so(giaTriSauNhan(rows, /^Tỷ giá/i)),
    amountExVat,
    vatPercent,
    vatAmount: so(giaTriSauNhan(rows, /^Tiền thuế GTGT/i)),
    amountInclVat: so(giaTriSauNhan(rows, /^Tổng cộng tiền thanh toán/i)),
    lines,
    warnings,
  };
}
