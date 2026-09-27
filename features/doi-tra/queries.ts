'use server';

import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { requirePerm } from '@/features/receiving/perm';
import type { DongDonTra } from './types';

/**
 * Tìm dòng đơn để CX tạo yêu cầu trả.
 *
 * Tìm theo mã đơn / SKU / tên sản phẩm / email khách. Chỉ đơn ĐÃ GIAO hoặc đã
 * xuất — chưa gửi thì đó là huỷ đơn, không phải trả hàng.
 */
export async function timDongDeTra(tuKhoa: string): Promise<DongDonTra[]> {
  await requirePerm('view_receiving');
  const q = tuKhoa.trim();
  if (q.length < 2) return [];
  const nhu = `%${q}%`;
  const r = await db.execute(sql`
    SELECT l.id AS line_id, o.id AS order_id, o.store_id,
           o.shopify_order_number AS ma_don, s.name AS store,
           l.sku, l.product_title, l.variant_title, l.quantity, l.unit_price,
           o.customer_email, o.customer_name,
           (SELECT COALESCE(sum(r.quantity), 0)::int FROM customer_order_requests r
             WHERE r.order_line_id = l.id AND r.status <> 'cancelled') AS da_tra
    FROM shopify_order_lines l
    JOIN shopify_orders o ON o.id = l.order_id
    JOIN stores s ON s.id = o.store_id
    WHERE o.cancelled_at_shopify IS NULL
      AND (regexp_replace(o.shopify_order_number, '^#', '') ILIKE ${nhu}
           OR l.sku ILIKE ${nhu}
           OR l.product_title ILIKE ${nhu}
           OR o.customer_email ILIKE ${nhu})
    ORDER BY o.processed_at_shopify DESC NULLS LAST
    LIMIT 40`);
  return ((r.rows ?? r) as Record<string, unknown>[]).map((x) => ({
    lineId: String(x.line_id),
    orderId: String(x.order_id),
    storeId: String(x.store_id),
    maDon: String(x.ma_don),
    store: (x.store as string) ?? null,
    sku: (x.sku as string) ?? null,
    tenSanPham: (x.product_title as string) ?? null,
    bienThe: (x.variant_title as string) ?? null,
    soLuong: Number(x.quantity),
    donGia: String(x.unit_price),
    khachEmail: (x.customer_email as string) ?? null,
    khachTen: (x.customer_name as string) ?? null,
    daTra: Number(x.da_tra),
  }));
}
