'use server';

import { headers } from 'next/headers';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { sendOrderToMmp } from '@/features/mmp/order-outbound';

const BRAND_STATUSES = [
  'out_of_stock',
  'brand_requested',
  'brand_confirmed',
  'brand_rejected',
] as const;

/** Đẩy lại các đơn ĐÃ có dòng brand sang MMP (tồn đọng). Idempotent (MMP dedupe). */
export async function backfillMmpOrders(): Promise<{
  pushed: number;
  skipped: number;
  failed: number;
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

  // Dedupe: multiple brand lines in one fulfillment → same orderId.
  const orderIds = [...new Set(rows.map((r) => r.orderId))];

  let pushed = 0,
    skipped = 0,
    failed = 0;
  for (const oid of orderIds) {
    const r = await sendOrderToMmp(oid);
    if (r.ok) pushed++;
    else if (r.error === 'no brand lines' || r.error === 'not configured') skipped++;
    else failed++;
  }
  return { pushed, skipped, failed };
}
