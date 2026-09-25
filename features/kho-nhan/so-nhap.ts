'use server';

import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { requirePerm } from '@/features/receiving/perm';
import { sqlGioKinhDoanh } from '@/lib/timezone';
import type { DongSoNhap } from './types';

const TRAN = 400;

/**
 * SỔ NHẬP KHO — mọi chiếc đã ghi nhận, dựng theo đúng hình bảng Lark.
 *
 * CEO 25/09: chiếc đã nhận & kiểm trong ngày đẩy hết sang đây, để màn Nhận &
 * Kiểm mỗi phiên làm chỉ còn việc của phiên đó.
 *
 * Khác màn Nhận & Kiểm ở chỗ nó KHÔNG lọc theo `qc_result`: đây là sổ, phải
 * thấy cả chiếc đạt, chiếc không đạt lẫn chiếc còn đang kiểm.
 */
export async function soNhap(loc: { ngay?: string; kho?: string }): Promise<DongSoNhap[]> {
  await requirePerm('view_receiving');
  const dk = [
    loc.ngay ? sql`${sql.raw(sqlGioKinhDoanh('goods_receipt_items.created_at'))}::date = ${loc.ngay}::date` : undefined,
    loc.kho ? eq(schema.goodsReceipts.warehouseCode, loc.kho) : undefined,
  ].filter(Boolean);

  return db.select({
    id: schema.goodsReceiptItems.id,
    unitCode: schema.goodsReceiptItems.unitCode,
    sku: schema.goodsReceiptItems.sku,
    tenSanPham: schema.goodsReceiptItems.productTitle,
    tenBienThe: schema.goodsReceiptItems.variantTitle,
    maDon: schema.shopifyOrders.shopifyOrderNumber,
    kho: schema.goodsReceipts.warehouseCode,
    ketQuaQc: schema.goodsReceiptItems.qcResult,
    trangThaiTon: schema.goodsReceiptItems.stockStatus,
    larkRecordId: schema.goodsReceiptItems.larkRecordId,
    nhanLuc: schema.goodsReceiptItems.createdAt,
    qcLuc: schema.goodsReceiptItems.qcCheckedAt,
  })
    .from(schema.goodsReceiptItems)
    .innerJoin(schema.goodsReceipts, eq(schema.goodsReceipts.id, schema.goodsReceiptItems.receiptId))
    .leftJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.goodsReceiptItems.orderId))
    .where(dk.length > 0 ? and(...dk) : undefined)
    .orderBy(desc(schema.goodsReceiptItems.createdAt))
    .limit(TRAN);
}

/** Các ngày CÓ hàng nhận, mới nhất trước — để dựng ô chọn ngày không đoán mò. */
export async function ngayCoHang(): Promise<string[]> {
  await requirePerm('view_receiving');
  const r = await db.execute(sql`
    select distinct ${sql.raw(sqlGioKinhDoanh('created_at'))}::date::text as ngay
    from goods_receipt_items order by 1 desc limit 60`);
  return ((r.rows ?? r) as { ngay: string }[]).map((x) => x.ngay);
}
