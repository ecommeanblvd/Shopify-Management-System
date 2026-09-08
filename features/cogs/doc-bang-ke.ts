/**
 * THUẦN: mảy ô của mọi sheet trong workbook bảng kê brand → BangKe[] (spec §5).
 * Tìm cột theo TÊN tiêu đề, không theo vị trí — các tháng có cột thừa/thiếu.
 */
import { docTien, docPhanTram } from './tien';

export type O = string | number | null | undefined;
export interface DongBangKe {
  ngay: string; maDon: string; tenSp: string; sku: string; sl: number;
  giaNoiDia: number | null; ck: number | null; phiCustomize: number | null; tt: number;
  code: string | null; hangSheet: number;
}
export interface BangKe {
  brand: string; period: string; tuNgay: string; denNgay: string; sheet: string;
  lines: DongBangKe[]; returns: DongBangKe[]; canhBao: string[];
}

const RE_TIEU_DE = /BẢNG KÊ CÔNG NỢ\s+Từ ngày\s+(\d\d\/\d\d\/\d{4})\s+đến\s+(\d\d\/\d\d\/\d{4})\s+Brand:\s*([^\s|]+)/i;
const chuoi = (v: O): string => (v == null ? '' : String(v)).trim();

function timTieuDe(rows: O[][]): { tu: string; den: string; brand: string } | null {
  for (const r of rows.slice(0, 15)) for (const c of r) {
    const m = RE_TIEU_DE.exec(chuoi(c));
    if (m) return { tu: m[1], den: m[2], brand: m[3] };
  }
  return null;
}
function coO(rows: O[][], re: RegExp): boolean { return rows.some((r) => r.some((c) => re.test(chuoi(c)))); }
function laHangTieuDe(r: O[]): boolean { const s = r.map(chuoi); return s.includes('Mã đơn') && s.includes('SKU'); }
function chiSoCot(r: O[]) {
  const s = r.map((c) => chuoi(c).toLowerCase());
  const tim = (...ten: string[]) => s.findIndex((x) => ten.some((t) => x === t || x.startsWith(t)));
  return {
    ngay: 0, maDon: tim('mã đơn'), tenSp: tim('tên sản phẩm'), sku: tim('sku'), sl: tim('số lượng'),
    gia: tim('giá nội địa'), ck: tim('% ck'), custom: tim('phí customize'), tt: tim('tổng thành tiền'), code: tim('code'),
  };
}
/** dd/mm/yyyy → 'yyyy-mm'. */
export function periodTuNgay(ddmmyyyy: string): string { const [, m, y] = ddmmyyyy.split('/'); return `${y}-${m}`; }

export function docWorkbook(sheets: Array<{ name: string; rows: O[][] }>): { bangKe: BangKe[]; boQua: string[] } {
  const bangKe: BangKe[] = []; const boQua: string[] = [];
  for (const sh of sheets) {
    const td = timTieuDe(sh.rows);
    if (!td) { boQua.push(`${sh.name}: không có tiêu đề BẢNG KÊ CÔNG NỢ`); continue; }
    if (!coO(sh.rows, /A\.\s*Đơn thực nhận/i)) { boQua.push(`${sh.name}: ${coO(sh.rows, /A\.\s*Đơn thực bán/i) ? 'tab thực bán (chỉ tham khảo)' : 'không có mục A. Đơn thực nhận'}`); continue; }
    const bk: BangKe = { brand: td.brand, period: periodTuNgay(td.tu), tuNgay: td.tu, denNgay: td.den, sheet: sh.name, lines: [], returns: [], canhBao: [] };
    let muc: 'A' | 'B' | null = null; let cot: ReturnType<typeof chiSoCot> | null = null;
    sh.rows.forEach((r, i) => {
      const dau = r.map(chuoi).find((x) => x) ?? '';
      if (/^A\.\s*Đơn thực nhận/i.test(dau)) { muc = 'A'; cot = null; return; }
      if (/^B\.\s*Đơn re/i.test(dau)) { muc = 'B'; cot = null; return; }
      if (laHangTieuDe(r)) { cot = chiSoCot(r); return; }
      if (!muc || !cot) return;
      const maDon = chuoi(r[cot.maDon]);
      if (!maDon.startsWith('#')) return;
      const tt = docTien(r[cot.tt]);
      if (tt == null) { bk.canhBao.push(`${sh.name} hàng ${i + 1}: ${maDon} không đọc được Tổng thành tiền TT`); return; }
      const d: DongBangKe = {
        ngay: chuoi(r[cot.ngay]), maDon, tenSp: chuoi(r[cot.tenSp]), sku: chuoi(r[cot.sku]),
        sl: docTien(r[cot.sl]) ?? 1, giaNoiDia: docTien(r[cot.gia]), ck: docPhanTram(r[cot.ck]),
        phiCustomize: cot.custom >= 0 ? docTien(r[cot.custom]) : null, tt,
        code: cot.code >= 0 ? chuoi(r[cot.code]) || null : null, hangSheet: i + 1,
      };
      (muc === 'A' ? bk.lines : bk.returns).push(d);
    });
    bangKe.push(bk);
  }
  return { bangKe, boQua };
}

/** TT = giá × SL × (1 − CK) + customize, sai số ≤ 1 ₫. Thiếu giá/CK → true (không kiểm được). */
export function kiemCongThuc(d: DongBangKe): boolean {
  if (d.giaNoiDia == null || d.ck == null) return true;
  return Math.abs(d.tt - (d.giaNoiDia * d.sl * (1 - d.ck) + (d.phiCustomize ?? 0))) <= 1;
}
