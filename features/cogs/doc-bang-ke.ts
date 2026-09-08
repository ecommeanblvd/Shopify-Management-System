/**
 * THUẦN: mảng ô của mọi sheet trong workbook bảng kê brand → BangKe[] (spec §5).
 * Tìm cột theo TÊN tiêu đề, không theo vị trí — các tháng có cột thừa/thiếu.
 * Hai khuôn sheet đã gặp (08/09/2026):
 *   - Denio: tiền VND, cột "Tổng thành tiền TT", mục "A. Đơn thực nhận" / "B. Đơn return".
 *   - Happy Clothing: tiền USD ("$935.00"), cột "Thành tiền", mục "A. Đơn MEAN thực nhận" /
 *     "B. Đơn Happy Clothing Global thực nhận" (đơn #HC… trên store riêng của brand, KHÔNG phải
 *     return), dòng "TỔNG:" / "TỔNG THANH TOÁN:" quy VND → tỉ giá kỳ = VND ÷ Σ USD các dòng;
 *     mọi dòng được đổi sang VND ngay khi đọc (ttGoc giữ USD để kiểm công thức).
 */
import { docTien, docPhanTram } from './tien';

export type O = string | number | null | undefined;
export interface DongBangKe {
  ngay: string; maDon: string; tenSp: string; sku: string; sl: number;
  giaNoiDia: number | null; ck: number | null; phiCustomize: number | null; tt: number;
  code: string | null; hangSheet: number;
  /** Số tiền GỐC trên sheet khi sheet tính bằng ngoại tệ (USD); `tt` đã đổi sang VND. */
  ttGoc?: number;
}
export interface BangKe {
  brand: string; period: string; tuNgay: string; denNgay: string; sheet: string;
  lines: DongBangKe[]; returns: DongBangKe[]; canhBao: string[];
  /** Đơn vị của `tt` sau khi đọc: 'VND' (mặc định) — hoặc 'USD' nếu sheet USD mà không tìm được dòng TỔNG ₫ để đổi. */
  currency?: 'VND' | 'USD';
  /** Tỉ giá VND/USD suy từ chính sheet (dòng TỔNG ₫ ÷ Σ USD) khi sheet tính USD. */
  tiGia?: number;
}

const RE_TIEU_DE = /BẢNG KÊ CÔNG NỢ\s+Từ ngày\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+đến\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+Brand:\s*([^\n|]+)/i;
const chuoi = (v: O): string => (v == null ? '' : String(v)).trim();

function timTieuDe(rows: O[][]): { tu: string; den: string; brand: string } | null {
  for (const r of rows.slice(0, 15)) for (const c of r) {
    const m = RE_TIEU_DE.exec(chuoi(c));
    if (m) return { tu: m[1], den: m[2], brand: m[3].trim() };
  }
  return null;
}
function coO(rows: O[][], re: RegExp): boolean { return rows.some((r) => r.some((c) => re.test(chuoi(c)))); }
function laHangTieuDe(r: O[]): boolean { const s = r.map((c) => chuoi(c).toLowerCase()); return s.includes('mã đơn') && s.includes('sku'); }
function chiSoCot(r: O[]) {
  const s = r.map((c) => chuoi(c).toLowerCase());
  const tim = (...ten: string[]) => s.findIndex((x) => ten.some((t) => x === t));
  const timPrefix = (...ten: string[]) => s.findIndex((x) => ten.some((t) => x.startsWith(t)));
  const ngayIdx = tim('ngày nhận', 'ngày return', 'ngày trả', 'ngày báo đơn', 'ngày');
  return {
    ngay: ngayIdx >= 0 ? ngayIdx : 0,
    maDon: tim('mã đơn'), tenSp: tim('tên sản phẩm'), sku: tim('sku'), sl: tim('số lượng'),
    gia: tim('giá nội địa'), ck: timPrefix('% ck'), custom: tim('phí customize'),
    // Denio: "Tổng thành tiền TT"; Happy Clothing: "Thành tiền".
    tt: timPrefix('tổng thành tiền') >= 0 ? timPrefix('tổng thành tiền') : tim('thành tiền'), code: tim('code'),
  };
}
/** dd/mm/yyyy → 'yyyy-mm'. */
export function periodTuNgay(ddmmyyyy: string): string { const [, m, y] = ddmmyyyy.split('/'); return `${y}-${m.padStart(2, '0')}`; }

/** Giá trị ₫ trên dòng có nhãn khớp `re` (ưu tiên theo thứ tự truyền vào). */
function tongVndTheoNhan(rows: O[][], ...res: RegExp[]): number | null {
  for (const re of res) for (const r of rows) {
    if (!r.some((c) => re.test(chuoi(c)))) continue;
    const o = r.find((c) => /₫|đ$/i.test(chuoi(c)));
    const v = docTien(o); if (v != null && v > 0) return v;
  }
  return null;
}
/**
 * Tỉ giá VND/USD của một tab sheet USD, suy từ chính sheet:
 *   1) "TỔNG (A):" ₫ ÷ Σ USD mục A (Calista, Happy Clothing kỳ có dòng này) — chắc nhất vì không dính return/B;
 *   2) "TỔNG:" hoặc "TỔNG THANH TOÁN…" ₫ ÷ (Σ USD lines − Σ USD returns) — HC (B Global cộng), Denio-kiểu (A − B return).
 */
export function tiGiaTuSheet(rows: O[][], sumA: number, sumLines: number, sumReturns: number): number | null {
  const tongA = tongVndTheoNhan(rows, /^TỔNG \(A\):?$/i);
  if (tongA != null && sumA > 0) return tongA / sumA;
  const tong = tongVndTheoNhan(rows, /^TỔNG:?$/i, /^TỔNG THANH TOÁN/i);
  const mauSo = sumLines - sumReturns;
  if (tong != null && mauSo > 0) return tong / mauSo;
  return null;
}

export function docWorkbook(sheets: Array<{ name: string; rows: O[][] }>): { bangKe: BangKe[]; boQua: string[] } {
  const bangKe: BangKe[] = []; const boQua: string[] = [];
  for (const sh of sheets) {
    const td = timTieuDe(sh.rows);
    if (!td) { boQua.push(`${sh.name}: không có tiêu đề BẢNG KÊ CÔNG NỢ`); continue; }
    if (/thực bán/i.test(sh.name) || coO(sh.rows, /A\.\s*Đơn (MEAN )?thực bán/i)) { boQua.push(`${sh.name}: tab thực bán (chỉ tham khảo)`); continue; }
    if (!coO(sh.rows, /A\.\s*Đơn (MEAN )?thực nhận/i)) { boQua.push(`${sh.name}: không có mục A. Đơn thực nhận`); continue; }
    const bk: BangKe = { brand: td.brand, period: periodTuNgay(td.tu), tuNgay: td.tu, denNgay: td.den, sheet: sh.name, lines: [], returns: [], canhBao: [] };
    let muc: 'A' | 'B' | null = null; let bLaReturn = false; let cot: ReturnType<typeof chiSoCot> | null = null; let ngayMissing = false; let coUsd = false; let sumA = 0;
    sh.rows.forEach((r, i) => {
      const dau = r.map(chuoi).find((x) => x) ?? '';
      if (/^A\.\s*Đơn (MEAN )?thực nhận/i.test(dau)) { muc = 'A'; cot = null; return; }
      // Mục B: Denio = "B. Đơn return" (trừ tiền); Happy Clothing = "B. Đơn Happy Clothing Global thực nhận"
      // (đơn trên store riêng của brand, mã #HC… — cộng tiền như mục A, ghép thành offline vì không có trên Shopify).
      if (/^B\.\s*Đơn/i.test(dau)) { muc = 'B'; bLaReturn = /\bre(turn)?\b/i.test(dau); cot = null; return; }
      if (laHangTieuDe(r)) { cot = chiSoCot(r); if (cot.ngay === 0 && r.map((c) => chuoi(c).toLowerCase()).findIndex((x) => x === 'ngày nhận' || x === 'ngày return' || x === 'ngày trả' || x === 'ngày báo đơn' || x === 'ngày') < 0) ngayMissing = true; return; }
      if (!muc || !cot) return;
      const maDon = chuoi(r[cot.maDon]);
      if (!maDon.startsWith('#')) return;
      const ttRaw = r[cot.tt];
      const tt = docTien(typeof ttRaw === 'string' ? ttRaw.replace(/\$/g, '') : ttRaw);
      if (tt == null) { bk.canhBao.push(`${sh.name} hàng ${i + 1}: ${maDon} không đọc được Thành tiền`); return; }
      const laUsd = typeof ttRaw === 'string' && ttRaw.includes('$'); if (laUsd) coUsd = true;
      const slVal = docTien(r[cot.sl]);
      if (slVal == null || slVal <= 0) { bk.canhBao.push(`${sh.name} hàng ${i + 1}: ${maDon} không đọc được Số lượng`); return; }
      const d: DongBangKe = {
        ngay: chuoi(r[cot.ngay]), maDon, tenSp: chuoi(r[cot.tenSp]), sku: chuoi(r[cot.sku]),
        sl: slVal, giaNoiDia: docTien(typeof r[cot.gia] === 'string' ? String(r[cot.gia]).replace(/\$/g, '') : r[cot.gia]), ck: docPhanTram(r[cot.ck]),
        phiCustomize: cot.custom >= 0 ? docTien(typeof r[cot.custom] === 'string' ? String(r[cot.custom]).replace(/\$/g, '') : r[cot.custom]) : null, tt,
        code: cot.code >= 0 ? chuoi(r[cot.code]) || null : null, hangSheet: i + 1,
        ...(laUsd ? { ttGoc: tt } : {}),
      };
      (muc === 'A' || !bLaReturn ? bk.lines : bk.returns).push(d);
      if (muc === 'A') sumA += tt;
    });
    if (ngayMissing) bk.canhBao.push(`${sh.name}: không thấy cột Ngày, dùng cột đầu`);
    if (coUsd) {
      // Sheet USD → đổi mọi dòng sang VND theo tỉ giá chính sheet dùng (TỔNG ₫ ÷ Σ USD). Không có dòng TỔNG ₫ → giữ USD + cảnh báo.
      const sumLines = bk.lines.reduce((s, d) => s + (d.ttGoc ?? d.tt), 0); const sumReturns = bk.returns.reduce((s, d) => s + (d.ttGoc ?? d.tt), 0);
      const rate = tiGiaTuSheet(sh.rows, sumA, sumLines, sumReturns);
      if (rate != null) {
        bk.tiGia = Math.round(rate * 100) / 100; bk.currency = 'VND';
        for (const d of [...bk.lines, ...bk.returns]) { d.ttGoc = d.ttGoc ?? d.tt; d.tt = Math.round(d.ttGoc * rate); }
      } else { bk.currency = 'USD'; bk.canhBao.push(`${sh.name}: sheet tính USD nhưng không thấy dòng TỔNG (₫) để đổi — giữ USD`); }
    } else bk.currency = 'VND';
    bangKe.push(bk);
  }
  return { bangKe, boQua };
}

/** TT = giá × SL × (1 − CK) + customize, sai số ≤ 1 ₫. Thiếu giá/CK → true (không kiểm được). */
export function kiemCongThuc(d: DongBangKe): boolean {
  if (d.giaNoiDia == null || d.ck == null) return true;
  // Sheet USD: kiểm trên số gốc (ttGoc); sai số 1 đơn vị tiền gốc (VND: 1đ, USD: 1$ — sheet USD làm tròn 2 chữ số).
  return Math.abs((d.ttGoc ?? d.tt) - (d.giaNoiDia * d.sl * (1 - d.ck) + (d.phiCustomize ?? 0))) <= 1;
}
