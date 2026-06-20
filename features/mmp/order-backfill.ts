'use server';

import { headers } from 'next/headers';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { pushOrderToMmp } from '@/features/mmp/order-outbound';
import { pickBackfillOrderIds } from '@/features/mmp/backfill-select';

const BRAND_STATUSES = [
  'out_of_stock',
  'brand_requested',
  'brand_confirmed',
  'brand_rejected',
] as const;

/** Đẩy lại các đơn ĐÃ có dòng brand sang MMP (tồn đọng). pushOrderToMmp tự bỏ qua
 *  đơn đã sent-không-đổi (dedup phía mình) → chạy lại không flood; MMP dedupe là backstop.
 *  `limit` → chỉ đẩy N đơn đầu (để test trước khi chạy full); để trống = tất cả.
 *  `total` = tổng đơn eligible (trước khi giới hạn) để biết còn bao nhiêu. */
export async function backfillMmpOrders(opts?: { limit?: number }): Promise<{
  pushed: number;
  skipped: number;
  failed: number;
  total: number;
}> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthenticated');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_fulfillment')) throw new Error('Forbidden');

  // Select orderId from fulfillments that have ≥1 brand line.
  const rows = await db
    .select({ orderId: schema.orderFulfillment.orderId })
    .from(schema.orderFulfillmentLines)
    .innerJoin(
      schema.orderFulfillment,
      eq(schema.orderFulfillmentLines.fulfillmentId, schema.orderFulfillment.id),
    )
    .where(
      inArray(schema.orderFulfillmentLines.status, [...BRAND_STATUSES]),
    );

  // Dedupe (nhiều dòng brand cùng đơn → 1 orderId); total = toàn bộ eligible.
  const total = new Set(rows.map((r) => r.orderId)).size;
  const orderIds = pickBackfillOrderIds(rows.map((r) => r.orderId), opts?.limit);

  let pushed = 0,
    skipped = 0,
    failed = 0;
  for (const oid of orderIds) {
    const r = await pushOrderToMmp(oid);
    if (r.ok && !r.skipped) pushed++;
    else if (r.skipped || r.error === 'no brand lines' || r.error === 'not configured') skipped++;
    else failed++;
  }
  return { pushed, skipped, failed, total };
}
