'use server';

import { and, eq, ilike, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { cacDangIdShopify } from '@/features/receiving/ma-tem';
import { requireXemKol } from './perm';
import { dienGiaiQuetTaoDon, ghepTenBienThe } from './quet';
import type { KetQuaBienThe, KetQuaQuet } from './types';

/** Tối đa số dòng trả về cho một lượt gõ tìm — 120.817 biến thể KHÔNG được tải hết ra trình duyệt. */
const GIOI_HAN_KET_QUA = 20;

/** Gõ dưới 2 ký tự thì không tìm: vừa vô nghĩa (quá nhiều khớp) vừa là lượt quét toàn bảng đắt nhất. */
const DO_DAI_TU_KHOA_TOI_THIEU = 2;

/** Tồn khả dụng CỘNG DỒN qua MỌI kho cho một SKU — tín hiệu tổng quan lúc đang chọn hàng. */
async function tonTongTatCa(sku: string): Promise<number> {
  const [row] = await db.select({
    ton: sql<number>`coalesce(sum(${schema.warehouseInventory.qtyOnHand} - ${schema.warehouseInventory.qtyReserved}), 0)::int`,
  }).from(schema.warehouseInventory).where(eq(schema.warehouseInventory.sku, sku));
  return row?.ton ?? 0;
}

/**
 * Tìm biến thể theo SKU hoặc tên sản phẩm — trên TOÀN BỘ `shopify_variants`
 * (120.817 dòng, kể cả chưa có tồn — quyết định của CEO: cho phép tạo nháp cho
 * hàng chưa về), không chỉ SKU đang có tồn kho. ILIKE khớp giữa chuỗi (không
 * tiền tố cố định) nên cần GIN trigram (migration 0160) — không có index này
 * một lượt gõ quét hết bảng mất ~1,6s; có index, đa số lượt gõ dưới 5ms (đo
 * 23/09/2026, chi tiết trong báo cáo triển khai).
 */
export async function timKiemBienThe(tuKhoa: string): Promise<KetQuaBienThe[]> {
  await requireXemKol();
  const q = tuKhoa.trim();
  if (q.length < DO_DAI_TU_KHOA_TOI_THIEU) return [];
  const like = `%${q}%`;

  const rows = await db
    .select({
      sku: schema.shopifyVariants.sku,
      tenSanPham: schema.shopifyVariants.productTitle,
      tenBienThe: schema.shopifyVariants.variantTitle,
      ton: sql<number>`coalesce(sum(${schema.warehouseInventory.qtyOnHand} - ${schema.warehouseInventory.qtyReserved}), 0)::int`,
    })
    .from(schema.shopifyVariants)
    .leftJoin(schema.warehouseInventory, eq(schema.warehouseInventory.sku, schema.shopifyVariants.sku))
    .where(and(
      isNotNull(schema.shopifyVariants.sku),
      or(ilike(schema.shopifyVariants.sku, like), ilike(schema.shopifyVariants.productTitle, like)),
    ))
    .groupBy(schema.shopifyVariants.sku, schema.shopifyVariants.productTitle, schema.shopifyVariants.variantTitle)
    .orderBy(schema.shopifyVariants.productTitle)
    .limit(GIOI_HAN_KET_QUA);

  return rows.map((r) => ({ sku: r.sku!, tenHang: ghepTenBienThe(r.tenSanPham, r.tenBienThe), ton: r.ton }));
}

/** Tra một biến thể theo `shopify_variant_id` (tem `V:`) — DB lưu GID đầy đủ, tem chỉ mang số trần. */
async function bienTheTheoShopifyVariantId(shopifyVariantId: string): Promise<KetQuaBienThe | null> {
  const [row] = await db.select({
    sku: schema.shopifyVariants.sku,
    tenSanPham: schema.shopifyVariants.productTitle,
    tenBienThe: schema.shopifyVariants.variantTitle,
  }).from(schema.shopifyVariants)
    .where(inArray(schema.shopifyVariants.shopifyVariantId, cacDangIdShopify(shopifyVariantId, 'ProductVariant')))
    .limit(1);
  if (!row?.sku) return null;
  return { sku: row.sku, tenHang: ghepTenBienThe(row.tenSanPham, row.tenBienThe), ton: await tonTongTatCa(row.sku) };
}

/**
 * Tra biến thể của MỘT dòng đơn Shopify (tem `L:`) — `shopify_order_lines` đã
 * ghi phẳng sẵn sku/tên/biến thể ngay trên dòng, không cần nối sang
 * `shopify_variants`.
 */
async function bienTheTheoDongDon(shopifyLineId: string): Promise<KetQuaBienThe | null> {
  const [row] = await db.select({
    sku: schema.shopifyOrderLines.sku,
    tenSanPham: schema.shopifyOrderLines.productTitle,
    tenBienThe: schema.shopifyOrderLines.variantTitle,
  }).from(schema.shopifyOrderLines)
    .where(inArray(schema.shopifyOrderLines.shopifyLineId, cacDangIdShopify(shopifyLineId, 'LineItem')))
    .limit(1);
  if (!row?.sku) return null;
  return { sku: row.sku, tenHang: ghepTenBienThe(row.tenSanPham, row.tenBienThe), ton: await tonTongTatCa(row.sku) };
}

/**
 * Diễn giải MỘT chuỗi vừa quét (máy quét tay hoặc camera) khi đang tạo đơn
 * KOL. Chỉ ĐỌC — gác bằng `requireXemKol` giống `goiYGiaVon`/`traTonKhaDung`.
 */
export async function giaiMaQuetTaoDon(raw: string): Promise<KetQuaQuet> {
  await requireXemKol();
  const giai = dienGiaiQuetTaoDon(raw);

  if (giai.ket === 'khong_nhan_dang') {
    return { ok: false, raw, loi: `Không nhận diện được mã "${raw}" — có thể là mã vạch của brand, hệ thống này không lưu mã đó.` };
  }
  if (giai.ket === 'khong_ap_dung') {
    return {
      ok: false,
      raw,
      loi: giai.loLoai === 'mon'
        ? `"${raw}" là tem MÓN (kho nhận hàng) — không dùng được khi tạo đơn KOL.`
        : `"${raw}" là mã ĐƠN Shopify — không dùng được khi tạo đơn KOL.`,
    };
  }
  if (giai.ket === 'bien_the') {
    const bt = await bienTheTheoShopifyVariantId(giai.shopifyVariantId);
    return bt ? { ok: true, bienThe: bt } : { ok: false, raw, loi: 'Không tìm thấy biến thể này trong hệ thống (có thể chưa đồng bộ từ Shopify).' };
  }
  const bt = await bienTheTheoDongDon(giai.shopifyLineId);
  return bt ? { ok: true, bienThe: bt } : { ok: false, raw, loi: 'Không tìm thấy dòng đơn này trong hệ thống.' };
}
