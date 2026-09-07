import { and, eq, isNull, isNotNull, sql, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { listBrandReceivedRecords, createBrandReceivedRecord, updateBrandReceivedRecordFields } from './client';
import { dongBoNhanHangLark, khoaNhanHang, type DongNhanHang, type KetQuaDongBoNhanHang } from './push-nhan-hang';

/** Bật đẩy khi ops đã tạo cột "Mã món" trên Lark (spec §5.2). Chưa bật → không gọi Lark. */
export function batDayNhanHang(): boolean {
  return process.env.LARK_NHAN_HANG_PUSH === '1';
}

/**
 * Điền bù bảng Lark "WH ngày MEAN nhận hàng" cho dòng kho đã quét trên SMS
 * (source='sms') mà chưa đẩy (lark_pushed_at NULL). Chạy theo nhịp sync-lark.
 * Đẩy được thì đóng dấu lark_pushed_at; lỗi thì để NULL cho lượt sau.
 */
export async function backfillNhanHangLark(): Promise<KetQuaDongBoNhanHang & { skipped?: 'env' }> {
  if (!batDayNhanHang()) return { doiChieu: 0, daTao: 0, daDien: 0, boQua: 0, loi: [], loiKhoa: [], skipped: 'env' };
  const cho = await db.select({
    id: schema.mmpLineReceived.id, orderNumber: schema.mmpLineReceived.orderNumber, sku: schema.mmpLineReceived.sku,
    vendor: schema.mmpLineReceived.vendor, receivedAt: schema.mmpLineReceived.receivedAt,
  }).from(schema.mmpLineReceived)
    .where(and(eq(schema.mmpLineReceived.source, 'sms'), isNull(schema.mmpLineReceived.larkPushedAt)))
    .limit(500);
  if (cho.length === 0) return { doiChieu: 0, daTao: 0, daDien: 0, boQua: 0, loi: [], loiKhoa: [] };

  // Mã món đã xác nhận của từng (order bare, sku) — nối qua orders.shopify_order_number.
  const mon = await db.select({
    orderNumber: sql<string>`ltrim(${schema.shopifyOrders.shopifyOrderNumber}, '#')`,
    sku: schema.goodsReceiptItems.sku, unitCode: schema.goodsReceiptItems.unitCode,
  }).from(schema.goodsReceiptItems)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.goodsReceiptItems.orderId))
    .where(and(
      isNotNull(schema.goodsReceiptItems.confirmedAt),
      inArray(sql`ltrim(${schema.shopifyOrders.shopifyOrderNumber}, '#')`, [...new Set(cho.map((c) => c.orderNumber))]),
    ))
    .orderBy(schema.goodsReceiptItems.unitCode);
  const maTheoKhoa = new Map<string, string[]>();
  for (const m of mon) {
    if (!m.sku) continue;
    const k = `${m.orderNumber} ${m.sku}`;
    maTheoKhoa.set(k, [...(maTheoKhoa.get(k) ?? []), m.unitCode]);
  }
  const dongs: DongNhanHang[] = cho.map((c) => ({
    orderNumber: c.orderNumber, sku: c.sku, vendor: c.vendor,
    receivedAt: c.receivedAt instanceof Date ? c.receivedAt : new Date(c.receivedAt as unknown as string),
    maMon: maTheoKhoa.get(`${c.orderNumber} ${c.sku}`) ?? [],
  }));
  const kq = await dongBoNhanHangLark(dongs, listBrandReceivedRecords, createBrandReceivedRecord, updateBrandReceivedRecordFields);
  // Đóng dấu những dòng KHÔNG nằm trong danh sách lỗi.
  const loiKhoa = new Set(kq.loiKhoa);
  const xong = cho.filter((c) => !loiKhoa.has(khoaNhanHang(c.orderNumber, c.sku) ?? '')).map((c) => c.id);
  if (xong.length) {
    await db.update(schema.mmpLineReceived).set({ larkPushedAt: sql`now()` }).where(inArray(schema.mmpLineReceived.id, xong));
  }
  return kq;
}
