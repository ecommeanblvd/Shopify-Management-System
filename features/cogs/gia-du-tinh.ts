/**
 * THUẦN: giá vốn DỰ TÍNH của một SKU = giá niêm yết brand trên MMP × (1 − CK brand).
 * CEO 09/09/2026: "giá COGS theo brand lúc đầu là giá giả định" — cần có cho mọi sản phẩm để (1) thấy ngay sản phẩm nào
 * chưa có giá, (2) Revenue dự tính cho đơn chưa đối soát. Giá thực (bảng kê) khi có sẽ đè lên (xem gia-von-thuc.ts).
 * CK brand không có bảng riêng → suy từ chính bảng kê đã nhập: mức CK phổ biến nhất (mode) của brand.
 */

/** Chuẩn hoá tên brand/vendor: thường, chỉ chữ số ("I.H.F Atelier" → "ihfatelier", "i-h-f" → "ihf"). */
export const chuanBrand = (s: string | null | undefined): string => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Vendor Shopify ↔ brand_slug MMP: bằng nhau, hoặc một bên là tiền tố ≥ 3 ký tự của bên kia ("ihf" ↔ "ihfatelier"). */
export function cungBrand(vendor: string | null | undefined, brandSlug: string): boolean {
  const a = chuanBrand(vendor), b = chuanBrand(brandSlug);
  if (!a || !b) return false;
  if (a === b) return true;
  return (a.length >= 3 && b.startsWith(a)) || (b.length >= 3 && a.startsWith(b));
}

/**
 * Khoá so SKU: SKU Shopify "Denio-DN0713-S-BLA" ↔ SKU MMP "DN0713-S-BLA" (không tiền tố) hoặc "decos-fw20-d001-xs-pin" (có tiền tố).
 * Trả về các dạng: nguyên (thường) và bỏ đoạn đầu trước dấu '-' → hai bên khớp khi có chung một dạng.
 */
export function cacKhoaSku(sku: string): string[] {
  const t = sku.trim().toLowerCase();
  const i = t.indexOf('-');
  return i > 0 && i < t.length - 1 ? [t, t.slice(i + 1)] : [t];
}

/** Mức CK phổ biến nhất của mỗi brand từ các dòng bảng kê (ck ∈ (0,1)); hoà → mức lớn hơn (thận trọng: giá vốn thấp hơn). */
export function ckTheoBrand(rows: Array<{ brandSlug: string; ck: number | null }>): Map<string, number> {
  const dem = new Map<string, Map<number, number>>();
  for (const r of rows) {
    if (r.ck == null || !(r.ck > 0 && r.ck < 1)) continue;
    const m = dem.get(r.brandSlug) ?? new Map<number, number>(); m.set(r.ck, (m.get(r.ck) ?? 0) + 1); dem.set(r.brandSlug, m);
  }
  const out = new Map<string, number>();
  for (const [b, m] of dem) { const best = [...m.entries()].sort((x, y) => y[1] - x[1] || y[0] - x[0])[0]; out.set(b, best[0]); }
  return out;
}

export interface VariantMMP { brandSlug: string; sku: string; price: number }
export interface SkuBan { sku: string; vendor: string | null }
export interface GiaUoc { sku: string; brandSlug: string; giaNiemYet: number; ck: number; giaVon: number; nguon: 'mmp_vnd_x_ck' }
export interface KhongUoc { sku: string; vendor: string | null; lyDo: 'chua_co_gia' | 'brand_chua_co_ck' }

/** Giá vốn dự tính = niêm yết × (1 − CK), làm tròn ₫. */
export const uocGiaVon = (giaNiemYet: number, ck: number): number => Math.round(giaNiemYet * (1 - ck));

/**
 * Ghép từng SKU đã bán với biến thể MMP CÙNG BRAND theo khoá SKU; giá lấy biến thể khớp đầu tiên (cùng SKU thì giá như nhau).
 * Không có brand nào trên MMP khớp vendor / không khớp SKU → "khong_co_tren_mmp"; brand chưa có CK từ bảng kê → "brand_chua_co_ck".
 */
export function uocGiaVonDuTinh(skus: SkuBan[], variants: VariantMMP[], ck: Map<string, number>): { uoc: GiaUoc[]; khong: KhongUoc[] } {
  // index: brand chuẩn → khoá sku → variant
  const idx = new Map<string, Map<string, VariantMMP>>();
  for (const v of variants) {
    // Giá niêm yết hợp lý 100.000–100.000.000 ₫ (MMP có dòng rác 1,08 tỉ — Montsand cv102).
    if (!(v.price >= 100_000 && v.price <= 100_000_000)) continue;
    const b = chuanBrand(v.brandSlug); const m = idx.get(b) ?? new Map<string, VariantMMP>();
    for (const k of cacKhoaSku(v.sku)) if (!m.has(k)) m.set(k, v);
    idx.set(b, m);
  }
  const brands = [...idx.keys()];
  const uoc: GiaUoc[] = []; const khong: KhongUoc[] = [];
  for (const s of skus) {
    const ung = brands.filter((b) => cungBrand(s.vendor, b));
    let v: VariantMMP | undefined;
    for (const b of ung) { const m = idx.get(b)!; for (const k of cacKhoaSku(s.sku)) { v = m.get(k); if (v) break; } if (v) break; }
    if (!v) { khong.push({ sku: s.sku, vendor: s.vendor, lyDo: 'chua_co_gia' }); continue; }
    // CK: đúng slug brand MMP; không có thì brand "họ hàng" (I.H.F Atelier/Studio ↔ i-h-f, Jenny K Tran ↔ jenny-k-tran-divine).
    const c = ck.get(v.brandSlug) ?? [...ck.entries()].find(([b]) => cungBrand(v.brandSlug, b))?.[1];
    if (c == null) { khong.push({ sku: s.sku, vendor: s.vendor, lyDo: 'brand_chua_co_ck' }); continue; }
    uoc.push({ sku: s.sku, brandSlug: v.brandSlug, giaNiemYet: v.price, ck: c, giaVon: uocGiaVon(v.price, c), nguon: 'mmp_vnd_x_ck' });
  }
  return { uoc, khong };
}

/** Một dòng lịch sử giá thực: SKU, brand (vendor), giá vốn thực 1 chiếc (VND), kỳ bảng kê. */
export interface LichSuGia { sku: string; vendor: string | null; unitVnd: number; period: string }
export interface GiaUocLichSu { sku: string; giaVon: number; nguon: 'lich_su_sku' | 'lich_su_ma_sp'; theoSku: string; period: string }

/** Mã sản phẩm = phần SKU trước token size (XS/S/M/L/XL/XXL/XXXL/Onesize/Customize/Free) — cùng mã thường cùng giá, khác size/màu. */
export function maSanPham(sku: string): string {
  const parts = sku.trim().toLowerCase().split('-');
  // Không coi số (18, 07…) là size — nhiều brand đánh số mẫu (LaVierge-RS25-18) → cắt nhầm sẽ gộp khác mẫu.
  const iSize = parts.findIndex((p, i) => i > 0 && /^(xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|4xl|onesize|one|free|freesize|customize|custom)$/.test(p));
  return iSize > 0 ? parts.slice(0, iSize).join('-') : parts.join('-');
}

/**
 * Giá vốn dự tính từ LỊCH SỬ bảng kê (giá thực gần nhất): ưu tiên đúng SKU (kỳ mới nhất), rồi cùng mã sản phẩm & cùng brand
 * (kỳ mới nhất). Đây là giá "brand đã charge cho món này/mã này" — sát thực tế hơn mọi bảng giá.
 */
export function uocGiaVonTuLichSu(skus: SkuBan[], lichSu: LichSuGia[]): { uoc: GiaUocLichSu[]; conLai: SkuBan[] } {
  const theoSku = new Map<string, LichSuGia>(); const theoMa = new Map<string, LichSuGia>();
  for (const h of lichSu) {
    if (!(h.unitVnd > 0)) continue;
    const k = h.sku.trim().toLowerCase(); const cu = theoSku.get(k); if (!cu || h.period > cu.period) theoSku.set(k, h);
    const km = chuanBrand(h.vendor) + '|' + maSanPham(h.sku); const cm = theoMa.get(km); if (!cm || h.period > cm.period) theoMa.set(km, h);
  }
  const uoc: GiaUocLichSu[] = []; const conLai: SkuBan[] = [];
  for (const s of skus) {
    const h = theoSku.get(s.sku.trim().toLowerCase());
    if (h) { uoc.push({ sku: s.sku, giaVon: Math.round(h.unitVnd), nguon: 'lich_su_sku', theoSku: h.sku, period: h.period }); continue; }
    const m = theoMa.get(chuanBrand(s.vendor) + '|' + maSanPham(s.sku));
    if (m) { uoc.push({ sku: s.sku, giaVon: Math.round(m.unitVnd), nguon: 'lich_su_ma_sp', theoSku: m.sku, period: m.period }); continue; }
    conLai.push(s);
  }
  return { uoc, conLai };
}
