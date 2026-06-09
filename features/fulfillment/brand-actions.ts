'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { sendBrandRequest } from '@/features/mmp/outbound';

async function requireManage(): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_fulfillment')) throw new Error('Forbidden');
}

export async function resendBrandRequest(requestId: string): Promise<void> {
  await requireManage();
  const [r] = await db.select().from(schema.brandOrderRequests)
    .where(eq(schema.brandOrderRequests.id, requestId)).limit(1);
  if (!r) throw new Error('Request not found');
  const [line] = await db.select({ vendor: schema.shopifyOrderLines.vendor, orderNumber: schema.shopifyOrders.shopifyOrderNumber })
    .from(schema.orderFulfillmentLines)
    .innerJoin(schema.shopifyOrderLines, eq(schema.shopifyOrderLines.shopifyLineId, schema.orderFulfillmentLines.shopifyLineId))
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, r.orderId))
    .where(eq(schema.orderFulfillmentLines.id, r.fulfillmentLineId)).limit(1);
  const brandSlug = line?.vendor ?? null;
  const result = await sendBrandRequest({ id: r.id, brandSlug, sku: r.sku, qty: r.qty }, line?.orderNumber ?? '');
  if (result.ok) {
    await db.update(schema.brandOrderRequests)
      .set({ brandSlug, sendStatus: 'sent', sentAt: sql`now()`, externalRef: result.externalRef ?? null,
             sendAttempts: sql`${schema.brandOrderRequests.sendAttempts} + 1`, lastError: null, updatedAt: sql`now()` })
      .where(eq(schema.brandOrderRequests.id, r.id));
    await db.update(schema.orderFulfillmentLines).set({ status: 'brand_requested', updatedAt: sql`now()` })
      .where(eq(schema.orderFulfillmentLines.id, r.fulfillmentLineId));
  } else {
    await db.update(schema.brandOrderRequests)
      .set({ brandSlug, sendStatus: 'failed', lastError: result.error ?? 'failed',
             sendAttempts: sql`${schema.brandOrderRequests.sendAttempts} + 1`, updatedAt: sql`now()` })
      .where(eq(schema.brandOrderRequests.id, r.id));
  }
  revalidatePath('/f/fulfillment/brand-requests');
}
