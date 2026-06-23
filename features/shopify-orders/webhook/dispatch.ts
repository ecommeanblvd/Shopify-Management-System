import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { upsertOrder } from '../sync/upsert-order';
import { verifyAndStoreOrderAddress } from '../address-verify';
import { fetchOrderByGid } from '../sync/fetch-order';
import { webhookOrderGid, webhookRefundOrderGid } from './webhook-ids';

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

/**
 * Webhook gửi payload REST (snake_case, id số) — KHÁC shape GraphQL của mapper.
 * Nên với mọi topic đụng dữ liệu đơn, ta chuẩn hoá id về gid rồi FETCH bản đầy đủ
 * qua GraphQL và upsert bằng đúng mapper đã chạy tốt của cron/backfill.
 */
export async function dispatchWebhook(
  storeId: string,
  topic: ShopifyWebhookTopic,
  payload: unknown,
): Promise<void> {
  if (topic === 'orders/create' || topic === 'orders/updated') {
    const gid = webhookOrderGid(payload as Record<string, unknown>);
    if (!gid) return;
    const order = await fetchOrderByGid(storeId, gid);
    if (!order) return; // đơn đã bị xoá khỏi Shopify
    const orderId = await upsertOrder(storeId, order, 'webhook');
    // Verify địa chỉ NGAY khi đơn mới về (fire-and-forget, không chặn 2xx webhook).
    // Cron hằng giờ vẫn là backstop cho đơn lỡ. Chỉ bắn ở orders/create.
    if (orderId && topic === 'orders/create') {
      void verifyAndStoreOrderAddress(orderId).catch((e) =>
        console.error(`[webhook] verify address failed for ${orderId}:`, e),
      );
    }
    return;
  }
  if (topic === 'orders/cancelled') {
    const p = payload as { cancelled_at?: string | null };
    const gid = webhookOrderGid(payload as Record<string, unknown>);
    if (!gid) return;
    // isNull guard giữ phát hiện chuyển null→cancelled là atomic: chỉ lần gửi ĐẦU
    // tiên mới flip (và nhận lại qua RETURNING) → webhook gửi lại không double-release.
    const flipped = await db
      .update(schema.shopifyOrders)
      .set({ cancelledAtShopify: new Date(p.cancelled_at ?? new Date().toISOString()) })
      .where(and(eq(schema.shopifyOrders.shopifyOrderId, gid),
                 isNull(schema.shopifyOrders.cancelledAtShopify)))
      .returning({ id: schema.shopifyOrders.id });
    if (flipped.length > 0) {
      // Best-effort: release không bao giờ làm fail webhook 2xx.
      try {
        const { releaseOrderAllocations } = await import('@/features/warehouse/release');
        await releaseOrderAllocations(flipped[0].id);
      } catch (err) {
        console.error(`releaseOrderAllocations failed for order ${flipped[0].id}:`, err);
      }
    }
    return;
  }
  if (topic === 'refunds/create') {
    // Refund webhook (REST) khác shape GraphQL hẳn → fetch lại ĐƠN CHA (đã gồm
    // mảng refunds) và upsert: mapper ghi refund qua đường đã kiểm chứng.
    const gid = webhookRefundOrderGid(payload as { order_id?: number | string });
    if (!gid) return;
    const order = await fetchOrderByGid(storeId, gid);
    if (!order) return;
    await upsertOrder(storeId, order, 'webhook');
  }
}
