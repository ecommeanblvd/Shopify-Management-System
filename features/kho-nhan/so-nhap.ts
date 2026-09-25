'use server';

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { requirePerm } from '@/features/receiving/perm';
import { sqlGioKinhDoanh } from '@/lib/timezone';
import { NHAN_LY_DO, type LyDoLoi } from './loi-qc';
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

  const dsThoRaw = await db.select({
    id: schema.goodsReceiptItems.id,
    unitCode: schema.goodsReceiptItems.unitCode,
    sku: schema.goodsReceiptItems.sku,
    tenSanPham: schema.goodsReceiptItems.productTitle,
    tenBienThe: schema.goodsReceiptItems.variantTitle,
    maDon: schema.shopifyOrders.shopifyOrderNumber,
    kho: schema.goodsReceipts.warehouseCode,
    vendor: schema.goodsReceipts.vendor,
    receiptId: schema.goodsReceiptItems.receiptId,
    larkUniqueCode: schema.goodsReceiptItems.larkUniqueCode,
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

  // Lỗi QC gộp theo chiếc trong MỘT lượt truy vấn, không N+1 theo từng dòng.
  const ids = dsThoRaw.map((x) => x.id);
  const loi = ids.length === 0 ? [] : await db.select({
    receiptItemId: schema.whLoiQc.receiptItemId,
    lyDo: schema.whLoiQc.lyDo,
    anhKey: schema.whLoiQc.anhKey,
  }).from(schema.whLoiQc).where(inArray(schema.whLoiQc.receiptItemId, ids));

  const theoChiec = new Map<string, { lyDo: string[]; soAnhLoi: number }>();
  for (const l of loi) {
    const g = theoChiec.get(l.receiptItemId) ?? { lyDo: [], soAnhLoi: 0 };
    g.lyDo.push(NHAN_LY_DO[l.lyDo as LyDoLoi] ?? l.lyDo);
    if (l.anhKey) g.soAnhLoi += 1;
    theoChiec.set(l.receiptItemId, g);
  }

  return dsThoRaw.map((x) => ({
    ...x,
    lyDo: undefined,
    lyDoLoi: theoChiec.get(x.id)?.lyDo ?? [],
    soAnhLoi: theoChiec.get(x.id)?.soAnhLoi ?? 0,
  })) as DongSoNhap[];
}

/** Các ngày CÓ hàng nhận, mới nhất trước — để dựng ô chọn ngày không đoán mò. */
export async function ngayCoHang(): Promise<string[]> {
  await requirePerm('view_receiving');
  const r = await db.execute(sql`
    select distinct ${sql.raw(sqlGioKinhDoanh('created_at'))}::date::text as ngay
    from goods_receipt_items order by 1 desc limit 60`);
  return ((r.rows ?? r) as { ngay: string }[]).map((x) => x.ngay);
}
