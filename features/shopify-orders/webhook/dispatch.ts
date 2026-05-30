import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { upsertOrder } from '../sync/upsert-order';
import type { ShopifyOrderPayload, ShopifyRefund } from '../shopify-types';

export type ShopifyWebhookTopic =
  | 'orders/create'
  | 'orders/updated'
  | 'orders/cancelled'
  | 'refunds/create';

export const SUPPORTED_TOPICS: ShopifyWebhookTopic[] = [
  'orders/create', 'orders/updated', 'orders/cancelled', 'refunds/create',
];

/** URL path segment to topic mapping. We use kebab-case URLs so the path stays
 *  Shopify-friendly: /api/webhooks/shopify/orders-create. */
export function topicFromSlug(slug: string): ShopifyWebhookTopic | null {
  const map: Record<string, ShopifyWebhookTopic> = {
    'orders-create': 'orders/create',
    'orders-updated': 'orders/updated',
    'orders-cancelled': 'orders/cancelled',
    'refunds-create': 'refunds/create',
  };
  return map[slug] ?? null;
}

/** Inverse for subscription registration. */
export function slugFromTopic(topic: ShopifyWebhookTopic): string {
  return topic.replace('/', '-');
}

export async function dispatchWebhook(
  storeId: string,
  topic: ShopifyWebhookTopic,
  payload: unknown,
): Promise<void> {
  if (topic === 'orders/create' || topic === 'orders/updated') {
    await upsertOrder(storeId, payload as ShopifyOrderPayload, 'webhook');
    return;
  }
  if (topic === 'orders/cancelled') {
    const p = payload as ShopifyOrderPayload;
    await db
      .update(schema.shopifyOrders)
      .set({ cancelledAtShopify: new Date(p.cancelledAt ?? new Date().toISOString()) })
      .where(eq(schema.shopifyOrders.shopifyOrderId, p.id));
    return;
  }
  if (topic === 'refunds/create') {
    const r = payload as ShopifyRefund & { order_id: string };
    const [parent] = await db
      .select({ id: schema.shopifyOrders.id })
      .from(schema.shopifyOrders)
      .where(eq(schema.shopifyOrders.shopifyOrderId, r.order_id));
    if (!parent) return;
    await db
      .insert(schema.shopifyOrderRefunds)
      .values({
        orderId: parent.id,
        shopifyRefundId: r.id,
        refundedAt: new Date(r.createdAt),
        amount: r.totalRefundedSet.shopMoney.amount,
        reason: r.note,
      })
      .onConflictDoNothing({ target: schema.shopifyOrderRefunds.shopifyRefundId });
  }
}
