/* eslint-disable no-console */
/**
 * Verify + đảm bảo subscription webhook order còn sống trên MỌI store active.
 * Query webhookSubscriptions hiện có, báo topic nào đúng/thiếu/lạc (callback sai),
 * rồi re-register (idempotent) các topic cho đúng URL production.
 *
 *   npx dotenv -- tsx scripts/verify-webhooks.ts          # report + re-register
 *   npx dotenv -- tsx scripts/verify-webhooks.ts --report # chỉ report
 *
 * LƯU Ý: ép dùng URL production (không lấy SHOPIFY_APP_URL=localhost trong .env).
 */
const PROD_URL = 'https://shopify-management-system-production.up.railway.app';
process.env.SHOPIFY_APP_URL = PROD_URL; // để registerOrderWebhooks dựng callback đúng

import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { getStoreToken, graphqlCall } from '../lib/shopify/client';
import { SUPPORTED_TOPICS, slugFromTopic } from '../features/shopify-orders/webhook/dispatch';
import { registerOrderWebhooks } from '../features/shopify-orders/webhook/register-subscriptions';

const LIST_QUERY = `
  query { webhookSubscriptions(first: 100) {
    nodes { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } }
  } }`;

const TOPIC_FROM_GQL: Record<string, string> = {
  ORDERS_CREATE: 'orders/create', ORDERS_UPDATED: 'orders/updated',
  ORDERS_CANCELLED: 'orders/cancelled', REFUNDS_CREATE: 'refunds/create',
};

async function main() {
  const reportOnly = process.argv.includes('--report');
  const stores = await db.select().from(schema.stores).where(eq(schema.stores.status, 'active'));

  for (const s of stores) {
    const token = await getStoreToken(s.id);
    const res = await graphqlCall({ shopDomain: s.shopDomain, apiVersion: s.apiVersion, token, query: LIST_QUERY });
    const body = res as { data?: { webhookSubscriptions?: { nodes: Array<{ id: string; topic: string; endpoint: { callbackUrl?: string } }> } } };
    const subs = body.data?.webhookSubscriptions?.nodes ?? [];

    console.log(`\n=== ${s.name} (${s.shopDomain}) ===`);
    const byTopic = new Map<string, string[]>();
    for (const sub of subs) {
      const t = TOPIC_FROM_GQL[sub.topic] ?? sub.topic;
      const url = sub.endpoint?.callbackUrl ?? '(non-http)';
      (byTopic.get(t) ?? byTopic.set(t, []).get(t)!).push(url);
    }
    for (const topic of SUPPORTED_TOPICS) {
      const want = `${PROD_URL}/api/webhooks/shopify/${slugFromTopic(topic)}`;
      const urls = byTopic.get(topic) ?? [];
      const ok = urls.includes(want);
      const stray = urls.filter((u) => u !== want);
      console.log(`  ${ok ? '✓' : '✗ THIẾU'} ${topic}${stray.length ? `  ⚠ lạc: ${stray.join(', ')}` : ''}`);
    }
    // các topic order lạ ngoài 4 topic ta quản — chỉ liệt kê
    for (const [t, urls] of byTopic) {
      if (!SUPPORTED_TOPICS.includes(t as never)) console.log(`  · (khác) ${t}: ${urls.join(', ')}`);
    }

    if (!reportOnly) {
      await registerOrderWebhooks({ shopDomain: s.shopDomain, accessToken: token, apiVersion: s.apiVersion });
      console.log('  → đã re-register (idempotent) 4 topic về URL production.');
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
