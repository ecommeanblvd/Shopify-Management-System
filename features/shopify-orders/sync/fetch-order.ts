import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import type { ShopifyOrderPayload } from '../shopify-types';
import { orderNodeFields } from './order-fields';

function buildOrderQuery(includeCustomer: boolean): string {
  return `
  query order($id: ID!) {
    order(id: $id) {
      ${orderNodeFields({ includeCustomer })}
    }
  }
`.trim();
}

/**
 * Fetch 1 đơn qua GraphQL theo gid — dùng đúng field set + mapper của cron/backfill.
 * Webhook chỉ báo "đơn X thay đổi" → ta fetch bản đầy đủ thay vì map payload REST
 * (payload REST khác shape, làm vỡ mapper). Trả null nếu đơn không còn (đã xoá).
 *
 * `customer { id }` chỉ được thêm vào query khi store có scope read_customers —
 * thiếu scope mà query field này sẽ ACCESS_DENIED vỡ cả query (xem order-fields.ts).
 */
export async function fetchOrderByGid(storeId: string, gid: string): Promise<ShopifyOrderPayload | null> {
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
  if (!store) throw new Error(`store ${storeId} not found`);
  const token = await getStoreToken(storeId);
  const includeCustomer = (store.scopes ?? []).includes('read_customers');

  const res = await graphqlCall({
    shopDomain: store.shopDomain,
    apiVersion: store.apiVersion,
    token,
    query: buildOrderQuery(includeCustomer),
    variables: { id: gid },
  });
  const body = res as { data?: { order?: ShopifyOrderPayload | null }; errors?: unknown };
  if (body.errors) throw new Error(`GraphQL error: ${JSON.stringify(body.errors)}`);
  return body.data?.order ?? null;
}
