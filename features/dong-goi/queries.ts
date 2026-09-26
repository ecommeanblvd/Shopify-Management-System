'use server';

import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { requirePerm } from '@/features/receiving/perm';
import { KHO_SANG_LARK } from '@/features/kho-nhan/wh-lark-payload';
import type { VatTuDongGoi } from './logic';

export interface DonChoDong {
  orderId: string;
  maDon: string;
  store: string | null;
  nuoc: string | null;
  kho: string | null;
  soChiec: number;
  datLuc: string | null;
}

/**
 * Đơn có hàng sẵn sàng đóng: ít nhất một dòng `in_stock` chưa vào kiện nào.
 *
 * `in_stock` chứ không phải `picked` vì chuỗi pick→pack chưa từng chạy thật
 * (đo 26/09: 0 dòng ở picked/packed). Kho nhặt hàng và đóng gói là một động
 * tác, nên màn này gộp luôn.
 */
export async function donChoDong(loc: { kho?: string }): Promise<DonChoDong[]> {
  await requirePerm('view_receiving');
  const r = await db.execute(sql`
    SELECT o.id AS order_id,
           o.shopify_order_number AS ma_don,
           s.name AS store,
           o.ship_country AS nuoc,
           max(gi.current_warehouse_code) AS kho,
           count(*)::int AS so_chiec,
           max(o.processed_at_shopify)::text AS dat_luc
    FROM order_fulfillment_lines l
    JOIN order_fulfillment f ON f.id = l.fulfillment_id
    JOIN shopify_orders o ON o.id = f.order_id
    JOIN stores s ON s.id = o.store_id
    LEFT JOIN goods_receipt_items gi ON gi.fulfillment_line_id = l.id
    WHERE l.status = 'in_stock' AND l.shipment_id IS NULL
      AND o.cancelled_at_shopify IS NULL
      AND (${loc.kho ?? null}::text IS NULL OR gi.current_warehouse_code = ${loc.kho ?? null})
    GROUP BY o.id, o.shopify_order_number, s.name, o.ship_country
    ORDER BY max(o.processed_at_shopify) DESC NULLS LAST
    LIMIT 200`);
  return ((r.rows ?? r) as Record<string, unknown>[]).map((x) => ({
    orderId: String(x.order_id),
    maDon: String(x.ma_don),
    store: (x.store as string) ?? null,
    nuoc: (x.nuoc as string) ?? null,
    kho: (x.kho as string) ?? null,
    soChiec: Number(x.so_chiec),
    datLuc: (x.dat_luc as string) ?? null,
  }));
}

export interface ChiecTrongDon {
  lineId: string;
  sku: string | null;
  tenSanPham: string | null;
  bienThe: string | null;
  unitCode: string | null;
  kho: string | null;
}

/** Chiếc sẵn sàng đóng của MỘT đơn. */
export async function chiecCuaDon(orderId: string): Promise<ChiecTrongDon[]> {
  await requirePerm('view_receiving');
  const r = await db.execute(sql`
    SELECT l.id AS line_id, l.sku, l.product_title, l.variant_title,
           gi.unit_code, gi.current_warehouse_code AS kho
    FROM order_fulfillment_lines l
    JOIN order_fulfillment f ON f.id = l.fulfillment_id
    LEFT JOIN goods_receipt_items gi
           ON gi.fulfillment_line_id = l.id AND gi.stock_status = 'allocated'
    WHERE f.order_id = ${orderId}::uuid
      AND l.status = 'in_stock' AND l.shipment_id IS NULL
    ORDER BY l.sku NULLS LAST`);
  return ((r.rows ?? r) as Record<string, unknown>[]).map((x) => ({
    lineId: String(x.line_id),
    sku: (x.sku as string) ?? null,
    tenSanPham: (x.product_title as string) ?? null,
    bienThe: (x.variant_title as string) ?? null,
    unitCode: (x.unit_code as string) ?? null,
    kho: (x.kho as string) ?? null,
  }));
}

/**
 * Danh mục vật tư đóng gói, đọc từ bản sao bảng Lark.
 *
 * Hộp là HÀNG TỒN: Lark để chúng ngay trong WH-Inventory với
 * `Import - Inventory type` = VTĐG1/VTĐG2, và cột `Select VTĐG1` của bảng kiện
 * trỏ ngược về đó. Nên chọn hộp = chọn một dòng tồn, không phải gõ chuỗi.
 */
export async function vatTuDongGoi(kho?: string): Promise<VatTuDongGoi[]> {
  await requirePerm('view_receiving');
  const khoLark = kho ? KHO_SANG_LARK[kho] ?? kho : null;
  const r = await db.execute(sql`
    SELECT record_id, dinh_danh, inventory_type, warehouse
    FROM lark_wh_inventory
    WHERE inventory_type IN ('VTĐG1', 'VTĐG2')
      AND dinh_danh IS NOT NULL
      AND (${khoLark}::text IS NULL OR warehouse = ${khoLark})
    ORDER BY dinh_danh
    LIMIT 300`);
  return ((r.rows ?? r) as Record<string, unknown>[]).map((x) => ({
    recordId: String(x.record_id),
    dinhDanh: String(x.dinh_danh),
    loai: (x.inventory_type as string) ?? null,
    warehouse: (x.warehouse as string) ?? null,
  }));
}
