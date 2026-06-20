import { and, inArray, lt } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { pushOrderToMmp } from '@/features/mmp/order-outbound';

const MAX_ATTEMPTS = 5;

/** Đẩy lại các đơn chưa sent còn lượt thử. Gọi từ cron. */
export async function retryFailedMmpPushes(maxAttempts: number = MAX_ATTEMPTS): Promise<{ retried: number; recovered: number; stillFailing: number }> {
  const rows = await db.select({ orderId: schema.mmpOrderPushes.orderId })
    .from(schema.mmpOrderPushes)
    .where(and(inArray(schema.mmpOrderPushes.status, ['pending', 'failed']), lt(schema.mmpOrderPushes.attempts, maxAttempts)));
  let recovered = 0, stillFailing = 0;
  for (const r of rows) {
    const res = await pushOrderToMmp(r.orderId);
    if (res.ok) recovered++;
    else stillFailing++;
  }
  return { retried: rows.length, recovered, stillFailing };
}
