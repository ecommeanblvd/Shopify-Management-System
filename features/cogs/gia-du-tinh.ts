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

/** Một dòng lịch sử giá thực: SKU, brand (vendor + slug bảng kê), giá vốn thực 1 chiếc (VND), giá nội địa 1 chiếc quy VND
 *  (Σ giá niêm yết × sl của dòng bảng kê, cùng hệ số quy đổi với giá thực — null khi bảng kê không ghi), kỳ bảng kê. */
export interface LichSuGia { sku: string; vendor: string | null; brandSlug: string | null; unitVnd: number; giaNoiDiaVnd: number | null; period: string }
/** giaNoiDia/ck: giá niêm yết (VND) và CK hiệu dụng của DÒNG NGUỒN (1 − giá thực/niêm yết, 4 chữ số) — đầu vào cho dongGiaTheoKy. */
export interface GiaUocLichSu { sku: string; giaVon: number; nguon: 'lich_su_sku' | 'lich_su_ma_sp'; theoSku: string; period: string; brandSlug: string | null; giaNoiDia: number; ck: number }

const noiDiaVaCk = (h: LichSuGia): { giaNoiDia: number; ck: number } => {
  const nd = h.giaNoiDiaVnd != null && h.giaNoiDiaVnd > 0 ? h.giaNoiDiaVnd : h.unitVnd;
  return { giaNoiDia: Math.round(nd), ck: Math.max(0, Math.round((1 - h.unitVnd / nd) * 10_000) / 10_000) };
};

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
    if (h) { uoc.push({ sku: s.sku, giaVon: Math.round(h.unitVnd), nguon: 'lich_su_sku', theoSku: h.sku, period: h.period, brandSlug: h.brandSlug, ...noiDiaVaCk(h) }); continue; }
    const m = theoMa.get(chuanBrand(s.vendor) + '|' + maSanPham(s.sku));
    if (m) { uoc.push({ sku: s.sku, giaVon: Math.round(m.unitVnd), nguon: 'lich_su_ma_sp', theoSku: m.sku, period: m.period, brandSlug: m.brandSlug, ...noiDiaVaCk(m) }); continue; }
    conLai.push(s);
  }
  return { uoc, conLai };
}

/* ───────── CK theo TIER THÁNG ─────────
 * CEO 09/09/2026: tier CK của brand tính theo doanh số THÁNG đó, nên giá thực kỳ T8 (CK 40 %) không dùng thẳng cho đơn T6
 * (CK 35 %). Giá dự tính = giá nội địa × (1 − CK của brand ĐÚNG THÁNG đơn); tháng chưa kê dùng CK kỳ gần nhất trước đó
 * (tạm — đến khi bảng kê tháng đó về thì giá thực đè lên). Ghi vào sku_costs một dòng mỗi lần CK đổi (effective_from = đầu
 * tháng) — các trang đọc sku_costs vốn đã chọn dòng effective_from ≤ ngày đơn nên không cần đổi chỗ đọc. */

/** Mức CK phổ biến nhất của mỗi brand theo TỪNG KỲ bảng kê (ck ∈ (0,1)); hoà → mức lớn hơn. Kỳ sắp tăng dần. */
export function ckTheoBrandKy(rows: Array<{ brandSlug: string; period: string; ck: number | null }>): Map<string, Map<string, number>> {
  const dem = new Map<string, Map<string, Map<number, number>>>();
  for (const r of rows) {
    if (r.ck == null || !(r.ck > 0 && r.ck < 1)) continue;
    const b = dem.get(r.brandSlug) ?? new Map<string, Map<number, number>>(); const k = b.get(r.period) ?? new Map<number, number>();
    k.set(r.ck, (k.get(r.ck) ?? 0) + 1); b.set(r.period, k); dem.set(r.brandSlug, b);
  }
  const out = new Map<string, Map<string, number>>();
  for (const [b, theoKy] of dem) {
    const m = new Map<string, number>();
    for (const ky of [...theoKy.keys()].sort()) { const best = [...theoKy.get(ky)!.entries()].sort((x, y) => y[1] - x[1] || y[0] - x[0])[0]; m.set(ky, best[0]); }
    out.set(b, m);
  }
  return out;
}

/** Hai mức CK coi là cùng mức khi lệch < 0,5 điểm % (giá thực/niêm yết làm tròn đồng → 0,4 có thể ra 0,3999). */
export const cungMucCk = (a: number, b: number | undefined): boolean => b != null && Math.abs(a - b) < 0.005;

/** CK của SKU có phải một mức tier của brand (mức chung của brand ở kỳ nào đó)? Không → SKU có CK riêng (phụ kiện 0 %, dòng hàng riêng). */
export const laMucTierBrand = (ck: number, kyBrand: Map<string, number> | undefined): boolean => !!kyBrand && [...kyBrand.values()].some((c) => cungMucCk(ck, c));

/** giaVonPhang: giá thực 1 chiếc của dòng nguồn — dùng nguyên cho SKU không theo tier (tránh lệch vài đồng do CK làm tròn 4 chữ số). */
export interface SkuGiaNoiDia { sku: string; brandSlug: string | null; giaNoiDia: number; ck: number; theoTier: boolean; giaVonPhang?: number }
export interface MucGiaTheoKy { sku: string; effectiveFrom: string; giaVon: number; ck: number; kyCk: string | null }

/**
 * Dựng các mức giá dự tính theo tháng cho từng SKU:
 *  - `theoTier` và brand có CK theo kỳ: dòng đầu hiệu lực `tuKy`-01 với CK của kỳ gần nhất ≤ tuKy (không có → kỳ đầu tiên sau đó),
 *    rồi mỗi kỳ > tuKy mà CK đổi so với dòng trước → thêm dòng hiệu lực đầu tháng kỳ đó. Tháng không có kỳ kê kế thừa dòng trước.
 *  - SKU có CK riêng (phụ kiện 0 %, dòng hàng riêng) hay brand chưa có CK theo kỳ: một dòng phẳng với CK của chính nó, kyCk null.
 */
export function dongGiaTheoKy(items: SkuGiaNoiDia[], ckKy: Map<string, Map<string, number>>, tuKy = '2026-01'): MucGiaTheoKy[] {
  const out: MucGiaTheoKy[] = [];
  const dauThang = (ky: string) => `${ky}-01`;
  for (const it of items) {
    const kyBrand = it.theoTier && it.brandSlug ? ckKy.get(it.brandSlug) : undefined;
    if (!kyBrand || kyBrand.size === 0) { out.push({ sku: it.sku, effectiveFrom: dauThang(tuKy), giaVon: it.giaVonPhang ?? uocGiaVon(it.giaNoiDia, it.ck), ck: it.ck, kyCk: null }); continue; }
    const kys = [...kyBrand.keys()].sort();
    const truoc = kys.filter((k) => k <= tuKy); const dau = truoc.length ? truoc[truoc.length - 1] : kys[0];
    let ckHienTai = kyBrand.get(dau)!;
    out.push({ sku: it.sku, effectiveFrom: dauThang(tuKy), giaVon: uocGiaVon(it.giaNoiDia, ckHienTai), ck: ckHienTai, kyCk: dau });
    for (const k of kys) {
      if (k <= tuKy || k <= dau) continue;
      const c = kyBrand.get(k)!; if (cungMucCk(c, ckHienTai)) continue;
      ckHienTai = c; out.push({ sku: it.sku, effectiveFrom: dauThang(k), giaVon: uocGiaVon(it.giaNoiDia, c), ck: c, kyCk: k });
    }
  }
  return out;
}

/** Nguồn sku_costs kèm kỳ CK áp dụng: "uoc:lich_su_bang_ke@ck=2026-06"; giá phẳng (không theo tier) giữ nguyên nguồn gốc. */
export const nguonTheoKy = (nguon: string, kyCk: string | null): string => (kyCk ? `${nguon}@ck=${kyCk}` : nguon);
/** Đọc lại kỳ CK từ nguồn sku_costs — null khi không phải dòng ước theo tier. */
export const kyCkTuNguon = (source: string | null | undefined): string | null => source?.match(/@ck=(\d{4}-\d{2})$/)?.[1] ?? null;
/** Ghi chú cho giá dự tính trên đơn: đơn rơi vào tháng SAU kỳ CK đang áp → đang dùng tier kỳ trước (tạm, chờ bảng kê tháng đó). */
export function ghiChuGiaDuTinh(source: string | null | undefined, thangDon: string): string | null {
  const ky = kyCkTuNguon(source);
  if (!ky) return null;
  return ky < thangDon ? `CK tier kỳ ${ky} — tạm, chưa có bảng kê tháng ${thangDon}` : `CK tier kỳ ${ky}`;
}
