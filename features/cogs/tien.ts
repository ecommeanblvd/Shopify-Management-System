/** THUẦN: tiền tệ cho giá vốn — đọc số kiểu VN trên bảng kê, đổi tiền theo tháng. */

/** '1.861.500 ₫' → 1861500. Chữ, phần trăm, rỗng → null. */
export function docTien(s: string | number | null | undefined): number | null {
  if (s == null) return null;
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  const t = s.trim();
  if (!t || t.includes('%')) return null;
  const clean = t.replace(/[₫đ\s]/gi, '').replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(clean)) return null;
  return Number(clean);
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
  const cap = rates.filter((r) => r.from === from && r.to === to && r.period <= period).sort((a, b) => (a.period < b.period ? 1 : -1));
  const r = cap[0];
  if (!r) return null;
  return { amount: amount * r.rate, rate: r.rate, periodDung: r.period, tam: r.period !== period };
}
