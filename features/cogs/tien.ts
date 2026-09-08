/** THUẦN: tiền tệ cho giá vốn — đọc số kiểu VN trên bảng kê, đổi tiền theo tháng. */

/**
 * '1.861.500 ₫' → 1861500 (chấm-nghìn) hoặc '2,152,000 ₫' → 2152000 (phẩy-nghìn, xlsx xuất từ Google Sheet).
 * Cả hai dấu cùng xuất hiện → dấu SAU CÙNG là thập phân, dấu còn lại là nghìn (xoá).
 * Chỉ một loại dấu → xuất hiện >1 lần, HOẶC đúng 1 lần và theo sau là đúng 3 chữ số ở cuối chuỗi → là dấu nghìn (xoá);
 * ngược lại là dấu thập phân (đổi thành '.'). Chữ, phần trăm, rỗng → null.
 */
export function docTien(s: string | number | null | undefined): number | null {
  if (s == null) return null;
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  const t = s.trim();
  if (!t || t.includes('%')) return null;
  let core = t.replace(/[₫đ\s]/gi, '');
  let neg = false;
  if (core.startsWith('-')) { neg = true; core = core.slice(1); }
  const hasComma = core.includes(',');
  const hasDot = core.includes('.');
  let clean = core;
  if (hasComma && hasDot) {
    const decimal = core.lastIndexOf(',') > core.lastIndexOf('.') ? ',' : '.';
    const khac = decimal === ',' ? '.' : ',';
    clean = core.split(khac).join('');
    if (decimal !== '.') clean = clean.split(decimal).join('.');
  } else if (hasComma || hasDot) {
    const dau = hasComma ? ',' : '.';
    const soLan = core.split(dau).length - 1;
    const laNghin = soLan > 1 || new RegExp(`\\${dau}\\d{3}$`).test(core);
    clean = laNghin ? core.split(dau).join('') : core.replace(dau, '.');
  }
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const n = Number(clean);
  return neg ? -n : n;
}

/** '35%' → 0.35. Số thô (0.4) giữ nguyên. Rỗng → null. */
export function docPhanTram(s: string | number | null | undefined): number | null {
  if (s == null) return null;
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  const t = s.trim().replace('%', '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return s.includes('%') || n > 1 ? n / 100 : n;
}

export interface TiGiaThang { from: string; to: string; period: string; rate: number }
export interface KetQuaDoiTien { amount: number; rate: number; periodDung: string; tam: boolean }

/** Đổi tiền theo tỉ giá THÁNG. Thiếu tháng → tháng gần nhất TRƯỚC đó và cờ `tam`. Không có → null. */
export function doiTienTheoThang(amount: number, from: string, to: string, period: string, rates: TiGiaThang[]): KetQuaDoiTien | null {
  if (from === to) return { amount, rate: 1, periodDung: period, tam: false };
  const cap = rates.filter((r) => r.from === from && r.to === to && r.period <= period).sort((a, b) => b.period.localeCompare(a.period)); // Giảm dần theo kỳ; cùng kỳ (không nên xảy ra — unique index) thì giữ thứ tự đầu vào.
  const r = cap[0];
  if (!r) return null;
  return { amount: amount * r.rate, rate: r.rate, periodDung: r.period, tam: r.period !== period };
}
