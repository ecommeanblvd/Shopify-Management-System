'use server';

import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { boDauTiengViet } from '@/features/kol/bo-dau';
import { requirePerm } from '@/features/receiving/perm';
import { chuanHoaMaDon } from './ma-don';
import { conNhanDuoc, kieuTuKhoa } from './tim-don-logic';

const GIOI_HAN = 20;

export interface KetQuaTim {
  lineId: string; orderId: string; storeId: string; shopifyOrderId: string;
  maDon: string; sku: string | null;
  tenSanPham: string | null; tenBienThe: string | null;
  vendor: string | null; datSl: number; daNhan: number;
}

/**
 * Món của đơn đang UNFULFILLED / PARTIALLY_FULFILLED mà CHƯA nhận đủ.
 *
 * Không có danh sách dựng sẵn (CEO 24/09) — ô tìm là cửa duy nhất. Khớp theo mã
 * đơn (chuẩn hoá bỏ `#` cả hai phía), SKU, tên sản phẩm KHÔNG DẤU, hoặc ID sản
 * phẩm/biến thể dạng số (thứ tem `V:` in ra).
 *
 * `daNhan` đếm theo (đơn, SKU) chứ không theo dòng đơn: `goods_receipt_items`
 * không có khoá ngoại sang `shopify_order_lines`. Một đơn có HAI dòng cùng SKU
 * thì hai dòng dùng chung số đã nhận — hiếm, và sai về phía AN TOÀN (hiện thừa
 * còn hơn ẩn mất hàng chưa nhận).
 */
export async function timMonChuaNhan(tuKhoa: string): Promise<KetQuaTim[]> {
  await requirePerm('view_receiving');
  const kieu = kieuTuKhoa(tuKhoa);
  if (kieu === 'qua_ngan') return [];
  const q = tuKhoa.trim();
  const maDon = chuanHoaMaDon(q);
  const khongDau = `%${boDauTiengViet(q)}%`;

  const dieuKien = kieu === 'id'
    ? or(
        sql`regexp_replace(coalesce(${schema.shopifyOrderLines.shopifyVariantId}, ''), '[^0-9]', '', 'g') = ${q}`,
        sql`regexp_replace(coalesce(${schema.shopifyOrderLines.shopifyProductId}, ''), '[^0-9]', '', 'g') = ${q}`,
        sql`EXISTS (SELECT 1 FROM shopify_variants v WHERE v.sku = ${schema.shopifyOrderLines.sku}
              AND regexp_replace(v.shopify_variant_id, '[^0-9]', '', 'g') = ${q})`,
      )
    : or(
        sql`regexp_replace(${schema.shopifyOrders.shopifyOrderNumber}, '^#', '') ILIKE ${`%${maDon}%`}`,
        sql`${schema.shopifyOrderLines.sku} ILIKE ${`%${q}%`}`,
        sql`EXISTS (SELECT 1 FROM shopify_variants v WHERE v.sku = ${schema.shopifyOrderLines.sku}
              AND v.tim_kiem LIKE ${khongDau})`,
      );

  const rows = await db.select({
    lineId: schema.shopifyOrderLines.id,
    orderId: schema.shopifyOrders.id,
    storeId: schema.shopifyOrders.storeId,
    shopifyOrderId: schema.shopifyOrders.shopifyOrderId,
    maDon: schema.shopifyOrders.shopifyOrderNumber,
    sku: schema.shopifyOrderLines.sku,
    tenSanPham: schema.shopifyOrderLines.productTitle,
    tenBienThe: schema.shopifyOrderLines.variantTitle,
    vendor: schema.shopifyOrderLines.vendor,
    datSl: schema.shopifyOrderLines.quantity,
    daNhan: sql<number>`(SELECT count(*)::int FROM goods_receipt_items gi
      WHERE gi.order_id = ${schema.shopifyOrders.id}
        AND gi.sku IS NOT DISTINCT FROM ${schema.shopifyOrderLines.sku})`,
  })
    .from(schema.shopifyOrderLines)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shopifyOrderLines.orderId))
    .where(and(
      inArray(schema.shopifyOrders.fulfillmentStatus, ['UNFULFILLED', 'PARTIALLY_FULFILLED']),
      isNotNull(schema.shopifyOrderLines.sku),
      dieuKien,
    ))
    .limit(GIOI_HAN * 3);

  return rows.filter((r) => conNhanDuoc({ datSl: r.datSl, daNhan: r.daNhan })).slice(0, GIOI_HAN);
}
