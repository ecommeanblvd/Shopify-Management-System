/**
 * THUẦN: giá vốn THỰC của từng dòng đơn từ `order_line_cogs` (bảng kê brand đã chốt / PO / MMP) — đối lập với giá vốn
 * DỰ TÍNH (`sku_costs` + override tay). CEO 09/09/2026: "giá COGS theo brand lúc đầu là giả định, bản đối soát là giá thực
 * đơn bị charge — luôn có phần dự tính và phần thực tế nối vào order" (như ship: giá báo vs giá bill).
 */
import { uuTienNguon } from '@/features/cogs/uu-tien-nguon';

export interface DongCogs { shopifyLineId: string; kind: string; amount: number; currency: string; source: string; period: string; statementRef: string | null }
export interface GiaVonThucDong {
  /** Giá vốn thực của cả dòng (đã × số lượng), VND, đã trừ return (âm) nếu có. */
  vnd: number;
  nguon: string;
  ky: string;
  ref: string | null;
  coReturn: boolean;
}

/**
 * Mỗi dòng đơn: lấy dòng kind='cogs' có NGUỒN ưu tiên cao nhất (mmp > brand_statement = po > shopify_unit_cost), cùng nguồn thì kỳ mới nhất;
 * cộng mọi dòng kind='return' (số âm). Chỉ nhận VND — dòng còn USD (sheet chưa có mốc ₫) coi như chưa có giá thực.
 */
export function giaVonThucTheoDong(rows: DongCogs[]): Map<string, GiaVonThucDong> {
  const out = new Map<string, GiaVonThucDong>();
  const theoDong = new Map<string, DongCogs[]>();
  for (const r of rows) { if (r.currency !== 'VND') continue; const a = theoDong.get(r.shopifyLineId) ?? []; a.push(r); theoDong.set(r.shopifyLineId, a); }
  for (const [lineId, ds] of theoDong) {
    const cogs = ds.filter((d) => d.kind === 'cogs').sort((a, b) => uuTienNguon(b.source) - uuTienNguon(a.source) || b.period.localeCompare(a.period));
    if (!cogs.length) continue;
    const chon = cogs[0];
    const returns = ds.filter((d) => d.kind === 'return');
    out.set(lineId, { vnd: Math.round(chon.amount + returns.reduce((s, d) => s + d.amount, 0)), nguon: chon.source, ky: chon.period, ref: chon.statementRef, coReturn: returns.length > 0 });
  }
  return out;
}
