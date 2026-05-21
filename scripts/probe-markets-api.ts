/* eslint-disable no-console */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { graphqlCall, getStoreToken } from '@/lib/shopify/client';
import { MARKETS_QUERY } from '@/features/markets/domain/markets';

async function main() {
  const targetDomain = process.argv[2];
  if (!targetDomain) {
    console.error('Usage: npm run probe:markets -- <shop-domain>');
    console.error('Example: npm run probe:markets -- cici-mean.myshopify.com');
    process.exit(1);
  }
  const [store] = await db.select().from(schema.stores)
    .where(eq(schema.stores.shopDomain, targetDomain)).limit(1);
  if (!store) {
    console.error(`Store ${targetDomain} not connected. Connect it via /api/auth/shopify/install first.`);
    process.exit(1);
  }
  console.log(`Probing markets API for ${store.shopDomain} (api version ${store.apiVersion})...`);
  console.log(`Scopes: ${store.scopes.join(', ')}`);
  const token = await getStoreToken(store.id);
  const result = await graphqlCall({
    shopDomain: store.shopDomain,
    apiVersion: store.apiVersion,
    token,
    query: MARKETS_QUERY,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error('Probe failed:', e);
  process.exit(1);
});
