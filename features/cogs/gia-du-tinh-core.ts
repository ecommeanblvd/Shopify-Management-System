/**
 * Ghi giá vốn DỰ TÍNH vào `sku_costs` cho các SKU đã bán trên store mà CHƯA có bảng giá nào (ops upload / Shopify sync):
 *   1) `uoc:lich_su_bang_ke` — giá thực gần nhất của đúng SKU, hoặc của cùng mã sản phẩm cùng brand (bỏ size/màu);
 *   2) `uoc:mmp_vnd_x_ck`   — sản phẩm MMP niêm yết VND (portal brand) × (1 − CK brand suy từ bảng kê). Sản phẩm MMP giá USD là
 *      giá bán global của MEAN, KHÔNG phải giá nội địa brand → không dùng.
 * CK theo TIER THÁNG (CEO 09/09/2026, "tier tính theo doanh số tháng đó"): không ghi thẳng giá thực kỳ gần nhất mà tách ra
 * giá nội địa × (1 − CK brand đúng tháng); mỗi lần CK brand đổi ghi một dòng sku_costs hiệu lực đầu tháng (xem dongGiaTheoKy).
 * Nguồn ghi kèm kỳ CK: "uoc:lich_su_bang_ke@ck=2026-06" — đơn tháng sau kỳ đó là đang dùng tier kỳ trước (tạm).
 * Dòng đầu hiệu lực 2026-01-01 để áp cho mọi đơn 2026. Idempotent: chạy lại xoá + ghi lại các dòng "uoc:%", không đụng nguồn khác.
 * CEO 09/09/2026: "luôn có phần dự tính và phần thực tế nối vào order".
 */
import { and, eq, like } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { ckTheoBrand, ckTheoBrandKy, dongGiaTheoKy, laMucTierBrand, nguonTheoKy, uocGiaVonDuTinh, uocGiaVonTuLichSu, type GiaUoc, type GiaUocLichSu, type KhongUoc, type MucGiaTheoKy, type SkuGiaNoiDia } from './gia-du-tinh';

/** Nguồn ghi vào sku_costs.source — mọi nguồn ước đều có tiền tố "uoc:" để phân biệt với bảng giá ops upload / đồng bộ Shopify. */
export const NGUON_UOC_LICH_SU = 'uoc:lich_su_bang_ke';
export const NGUON_UOC_MMP = 'uoc:mmp_vnd_x_ck';
const LA_NGUON_UOC = "source LIKE 'uoc:%'";
const HIEU_LUC_TU = '2026-01-01';


export interface KetQuaUocGiaVon {
  storeId: string; dryRun: boolean;
  skuXet: number; daCoGia: number; uocLichSu: GiaUocLichSu[]; uoc: GiaUoc[]; khong: KhongUoc[];
  ckTheoBrand: Array<{ brandSlug: string; ck: number }>;
  /** Brand có CK đổi giữa các kỳ (tier tháng) và các mức giá theo tháng sẽ ghi. */
  brandDoiCk: Array<{ brandSlug: string; ckTheoKy: Array<[string, number]> }>;
  mucGia: MucGiaTheoKy[];
  skuTheoTier: number;
  fxUsdVnd: number | null;
  daGhi: number;
}

export async function uocGiaVonDuTinhCore(storeId: string, opts?: { dryRun?: boolean; userId?: string | null }): Promise<KetQuaUocGiaVon> {
  const dryRun = opts?.dryRun ?? true;
  // 1) SKU đã bán trên store từ 2026 (đơn chưa huỷ) + vendor.
  const { rows: skuRows } = await db.$client.query<{ sku: string; vendor: string | null }>(
    `SELECT l.sku, min(l.vendor) AS vendor FROM shopify_order_lines l JOIN shopify_orders o ON o.id = l.order_id
      WHERE o.store_id = $1 AND o.cancelled_at_shopify IS NULL AND o.processed_at_shopify >= '2025-12-31 17:00' AND l.sku IS NOT NULL GROUP BY l.sku`, [storeId]);
  // 2) SKU đã có giá trong sku_costs (bất kỳ nguồn nào KHÁC nguồn ước) → không đụng.
  const { rows: coGia } = await db.$client.query<{ sku: string }>(`SELECT DISTINCT sku FROM sku_costs WHERE store_id = $1 AND NOT (${LA_NGUON_UOC})`, [storeId]);
  const daCo = new Set(coGia.map((r) => r.sku));
  const canUoc0 = skuRows.filter((r) => !daCo.has(r.sku));
  // 2b) Lịch sử giá thực (bảng kê / PO / MMP, VND) theo SKU: giá 1 chiếc = amount / số lượng, kỳ bảng kê.
  // Giá nội địa 1 chiếc quy VND = giá thực × Σ[tt/(1 − ck)] / Σ tt của các dòng bảng kê trong detail.dong (tt đã là VND trước thuế,
  // ck của từng dòng; KHÔNG dùng cột giaNoiDia vì sheet USD ghi nó bằng USD). Nguồn không có detail.dong (PO/MMP/Shopify) → null
  // (coi CK 0, giá phẳng). Dòng kèm quà 0 % (đầm + belt) ra CK hiệu dụng lệch mức chung → giá phẳng.
  const { rows: lichSuRows } = await db.$client.query<{ sku: string; vendor: string | null; brand_slug: string | null; unit: string; noi_dia: string | null; period: string }>(
    `SELECT l.sku, l.vendor, c.brand_slug, (c.amount / l.quantity)::text AS unit,
            CASE WHEN nd.tong_tt > 0 THEN ((c.amount / l.quantity) * nd.tong_nd / nd.tong_tt)::text END AS noi_dia, c.period
       FROM order_line_cogs c JOIN shopify_order_lines l ON l.order_id = c.order_id AND l.shopify_line_id = c.shopify_line_id
       LEFT JOIN LATERAL (SELECT sum((x->>'tt')::numeric) AS tong_tt,
                                 sum((x->>'tt')::numeric / (1 - coalesce(least(greatest((x->>'ck')::numeric, 0), 0.99), 0))) AS tong_nd
                            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.detail->'dong') = 'array' THEN c.detail->'dong' ELSE '[]'::jsonb END) x
                           WHERE x->>'tt' IS NOT NULL) nd ON true
      WHERE c.kind = 'cogs' AND c.currency = 'VND' AND l.quantity > 0 AND l.sku IS NOT NULL AND c.amount > 0`);
  const { uoc: uocLichSu, conLai: canUoc } = uocGiaVonTuLichSu(canUoc0, lichSuRows.map((r) => ({
    sku: r.sku, vendor: r.vendor, brandSlug: r.brand_slug, unitVnd: Number(r.unit), giaNoiDiaVnd: r.noi_dia == null ? null : Number(r.noi_dia), period: r.period })));
  // 3) Biến thể MMP có giá + CK theo brand từ bảng kê đã nhập (detail.dong[].ck).
  // Chỉ sản phẩm MMP niêm yết VND (portal brand — giá nội địa). Giá USD là giá bán global của MEAN → bỏ.
  const { rows: fxRows } = await db.$client.query<{ fx: string | null; cost_currency: string | null }>(`SELECT fx_cost_per_order_currency::text AS fx, cost_currency FROM stores WHERE id = $1`, [storeId]);
  const fxUsdVnd = fxRows[0]?.fx != null ? Number(fxRows[0].fx) : null;
  const { rows: variantRows } = await db.$client.query<{ brand_slug: string; sku: string; price: string; currency: string | null }>(
    `SELECT p.brand_slug, v.sku, v.price::text, p.currency FROM mmp_product_variants v JOIN mmp_products p ON p.id = v.product_id WHERE v.price IS NOT NULL AND v.sku IS NOT NULL`);
  const variants = variantRows.flatMap((v) => {
    const cur = (v.currency ?? 'VND').toUpperCase(); const p = Number(v.price);
    if (cur === 'VND') return [{ brand_slug: v.brand_slug, sku: v.sku, price: p }];
    return [];
  });
  const { rows: ckRows } = await db.$client.query<{ brand_slug: string; period: string; ck: string | null }>(
    `SELECT c.brand_slug, c.period, d->>'ck' AS ck FROM order_line_cogs c, jsonb_array_elements(c.detail->'dong') d WHERE c.source = 'brand_statement' AND c.brand_slug IS NOT NULL AND d->>'ck' IS NOT NULL`);
  const ckList = ckRows.map((r) => ({ brandSlug: r.brand_slug, period: r.period, ck: r.ck == null ? null : Number(r.ck) }));
  const ck = ckTheoBrand(ckList);
  const ckKy = ckTheoBrandKy(ckList);
  const { uoc, khong } = uocGiaVonDuTinh(canUoc, variants.map((v) => ({ brandSlug: v.brand_slug, sku: v.sku, price: v.price })), ck);
  // 4) Tách giá nội địa + CK, dựng mức giá theo THÁNG (tier). SKU lịch sử theo tier khi CK của dòng nguồn là MỘT mức tier của brand
  // (mức chung của brand ở kỳ nào đó); khác (phụ kiện 0 %, dòng hàng CK riêng) → giữ CK riêng, giá phẳng. SKU từ MMP luôn theo tier.
  const items: SkuGiaNoiDia[] = [
    ...uocLichSu.map((u) => ({ sku: u.sku, brandSlug: u.brandSlug, giaNoiDia: u.giaNoiDia, ck: u.ck, theoTier: laMucTierBrand(u.ck, u.brandSlug ? ckKy.get(u.brandSlug) : undefined), giaVonPhang: u.giaVon })),
    ...uoc.map((u) => ({ sku: u.sku, brandSlug: u.brandSlug, giaNoiDia: u.giaNiemYet, ck: u.ck, theoTier: true })),
  ];
  const mucGia = dongGiaTheoKy(items, ckKy, HIEU_LUC_TU.slice(0, 7));
  const nguonCuaSku = new Map<string, string>([...uocLichSu.map((u) => [u.sku, NGUON_UOC_LICH_SU] as const), ...uoc.map((u) => [u.sku, NGUON_UOC_MMP] as const)]);
  const brandDoiCk = [...ckKy.entries()].filter(([, m]) => new Set([...m.values()].map((c) => Math.round(c * 200))).size > 1)
    .map(([brandSlug, m]) => ({ brandSlug, ckTheoKy: [...m.entries()] })).sort((a, b) => a.brandSlug.localeCompare(b.brandSlug));
  let daGhi = 0;
  if (!dryRun && mucGia.length) {
    await db.transaction(async (tx) => {
      // Xoá mọi dòng ước cũ của store (lịch sử/giá MMP/CK có thể đổi) rồi ghi lại — dòng nguồn khác (ops upload, Shopify sync) giữ nguyên.
      await tx.delete(schema.skuCosts).where(and(eq(schema.skuCosts.storeId, storeId), like(schema.skuCosts.source, 'uoc:%')));
      const rows = mucGia.map((m) => ({
        storeId, sku: m.sku, costPerUnit: String(m.giaVon), currency: 'VND', effectiveFrom: m.effectiveFrom,
        source: nguonTheoKy(nguonCuaSku.get(m.sku) ?? NGUON_UOC_LICH_SU, m.kyCk), uploadedBy: opts?.userId ?? null,
      }));
      for (let i = 0; i < rows.length; i += 500) await tx.insert(schema.skuCosts).values(rows.slice(i, i + 500));
      daGhi = rows.length;
    });
  }
  return {
    storeId, dryRun, skuXet: skuRows.length, daCoGia: daCo.size, uocLichSu, uoc, khong,
    ckTheoBrand: [...ck.entries()].map(([brandSlug, c]) => ({ brandSlug, ck: c })).sort((a, b) => a.brandSlug.localeCompare(b.brandSlug)),
    brandDoiCk, mucGia, skuTheoTier: items.filter((i) => i.theoTier && i.brandSlug && ckKy.has(i.brandSlug)).length, fxUsdVnd, daGhi,
  };
}
