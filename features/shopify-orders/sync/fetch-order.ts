import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import type { ShopifyOrderPayload } from '../shopify-types';
import { ORDER_NODE_FIELDS } from './order-fields';

const ORDER_QUERY = `
  query order($id: ID!) {
    order(id: $id) {
      ${ORDER_NODE_FIELDS}
    }
  }
`.trim();

/**
 * Fetch 1 đơn qua GraphQL theo gid — dùng đúng field set + mapper của cron/backfill.
 * Webhook chỉ báo "đơn X thay đổi" → ta fetch bản đầy đủ thay vì map payload REST
 * (payload REST khác shape, làm vỡ mapper). Trả null nếu đơn không còn (đã xoá).
 */
export async function fetchOrderByGid(storeId: string, gid: string): Promise<ShopifyOrderPayload | null> {
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
  if (!store) throw new Error(`store ${storeId} not found`);
  const token = await getStoreToken(storeId);

  const res = await graphqlCall({
    shopDomain: store.shopDomain,
    apiVersion: store.apiVersion,
    token,
    query: ORDER_QUERY,
    variables: { id: gid },
  });
  const body = res as { data?: { order?: ShopifyOrderPayload | null }; errors?: unknown };
  if (body.errors) throw new Error(`GraphQL error: ${JSON.stringify(body.errors)}`);
  return body.data?.order ?? null;
}
