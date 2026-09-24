'use server';

import { and, eq, gte, isNull, lte } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getSignedDownloadUrl, isStorageConfigured } from '@/lib/storage/s3';
import { requirePerm } from '@/features/receiving/perm';
import { NHAN_LY_DO, type LyDoLoi } from './loi-qc';

export interface ChiecLoi {
  itemId: string; unitCode: string; sku: string | null;
  tenSanPham: string | null; tenBienThe: string | null; maDon: string | null;
  loi: { lyDo: string; ghiChu: string | null; anhUrl: string | null }[];
}

/**
 * Chiếc QC không đạt, chờ trả brand, CHƯA nằm trong biên bản nào.
 *
 * `vendor_return_doc_key` (cột đã có sẵn) là cờ "đã lập biên bản" — lọc `IS NULL`
 * để không lập trùng một chiếc ở hai biên bản.
 */
export async function chiecChoTraBrand(brand: string, tuNgay: Date, denNgay: Date): Promise<ChiecLoi[]> {
  await requirePerm('view_receiving');
  const rows = await db.select({
    itemId: schema.goodsReceiptItems.id,
    unitCode: schema.goodsReceiptItems.unitCode,
    sku: schema.goodsReceiptItems.sku,
    tenSanPham: schema.goodsReceiptItems.productTitle,
    tenBienThe: schema.goodsReceiptItems.variantTitle,
    maDon: schema.shopifyOrders.shopifyOrderNumber,
  })
    .from(schema.goodsReceiptItems)
    .innerJoin(schema.goodsReceipts, eq(schema.goodsReceipts.id, schema.goodsReceiptItems.receiptId))
    .leftJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.goodsReceiptItems.orderId))
    .where(and(
      eq(schema.goodsReceiptItems.qcResult, 'fail'),
      eq(schema.goodsReceiptItems.disposition, 'return_to_brand'),
      isNull(schema.goodsReceiptItems.vendorReturnDocKey),
      eq(schema.goodsReceipts.vendor, brand),
      gte(schema.goodsReceiptItems.qcCheckedAt, tuNgay),
      lte(schema.goodsReceiptItems.qcCheckedAt, denNgay),
    ));

  const coKho = isStorageConfigured();
  return Promise.all(rows.map(async (r) => {
    const loi = await db.select().from(schema.whLoiQc)
      .where(eq(schema.whLoiQc.receiptItemId, r.itemId));
    return {
      ...r,
      loi: await Promise.all(loi.map(async (l) => ({
        lyDo: NHAN_LY_DO[l.lyDo as LyDoLoi] ?? l.lyDo,
        ghiChu: l.ghiChu,
        // Link ký 1 giờ — đủ để xem và in, hết hạn thì không rò ảnh ra ngoài.
        anhUrl: l.anhKey && coKho ? await getSignedDownloadUrl(l.anhKey, 3600) : null,
      }))),
    };
  }));
}

/** Brand đang có chiếc chờ trả — để màn biên bản không phải gõ tay tên brand. */
export async function brandCoHangTra(): Promise<string[]> {
  await requirePerm('view_receiving');
  const rows = await db.selectDistinct({ vendor: schema.goodsReceipts.vendor })
    .from(schema.goodsReceiptItems)
    .innerJoin(schema.goodsReceipts, eq(schema.goodsReceipts.id, schema.goodsReceiptItems.receiptId))
    .where(and(
      eq(schema.goodsReceiptItems.qcResult, 'fail'),
      eq(schema.goodsReceiptItems.disposition, 'return_to_brand'),
      isNull(schema.goodsReceiptItems.vendorReturnDocKey),
    ));
  return rows.map((r) => r.vendor).filter((v): v is string => Boolean(v)).sort();
}

/**
 * Đánh dấu đã lập biên bản để lần sau không lấy lại những chiếc này.
 * Điều kiện `IS NULL` trong WHERE: hai người cùng in một lúc thì người sau không
 * ghi đè mã biên bản của người trước.
 */
export async function danhDauDaLapBienBan(itemIds: string[], maBienBan: string): Promise<{ ok: boolean; soDanhDau: number }> {
  await requirePerm('manage_qc');
  if (itemIds.length === 0) return { ok: true, soDanhDau: 0 };
  let n = 0;
  for (const id of itemIds) {
    const r = await db.update(schema.goodsReceiptItems)
      .set({ vendorReturnDocKey: maBienBan, updatedAt: new Date() })
      .where(and(eq(schema.goodsReceiptItems.id, id),
                 isNull(schema.goodsReceiptItems.vendorReturnDocKey)))
      .returning({ id: schema.goodsReceiptItems.id });
    n += r.length;
  }
  return { ok: true, soDanhDau: n };
}
