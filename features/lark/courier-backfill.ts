'use server';

import { and, gte, isNotNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { listAllRecords, updateLogRecordFields } from './client';
import { dongBoCourierLark, type KetQuaDongBoCourier } from './push-courier';

/** Chỉ soi đơn trong 60 ngày — đơn cũ hơn thì đã đóng gói xong từ lâu. */
const SO_NGAY = 60;

/**
 * Điền bù cột "Couriers" trên Lark cho mọi đơn đã chọn hãng trên hệ thống.
 * Chạy kèm cron sync-lark (đang có lịch và còn sống) thay vì dựng service cron
 * mới — mấy service cron mới đều đang chờ người tạo tay trên Railway.
 */
export async function backfillCourierLark(): Promise<KetQuaDongBoCourier> {
  const moc = new Date(Date.now() - SO_NGAY * 86400000);
  const rows = await db
    .select({
      soDon: schema.shopifyOrders.shopifyOrderNumber,
      carrierKey: schema.shopifyOrders.selectedCarrierKey,
    })
    .from(schema.shopifyOrders)
    .where(and(
      isNotNull(schema.shopifyOrders.selectedCarrierKey),
      gte(schema.shopifyOrders.processedAtShopify, moc),
    ));

  return dongBoCourierLark(
    rows.map((r) => ({ soDon: r.soDon, carrierKey: r.carrierKey! })),
    listAllRecords,
    updateLogRecordFields,
  );
}
