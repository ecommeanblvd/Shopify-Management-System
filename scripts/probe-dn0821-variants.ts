/* eslint-disable no-console */
/* Quick probe — what do Shopify's variants for product DN0821 (magnolia)
 * actually look like? We matched the parent product fine but variant SKUs
 * didn't line up. */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { graphqlCall, getStoreToken } from '@/lib/shopify/client';

const Q = /* GraphQL */ `
  query ProbeVariants($q: String!) {
    productVariants(first: 50, query: $q) {
      edges {
        node {
          id
          sku
          title
          price
          presentmentPrices(first: 10) {
            edges { node { price { amount currencyCode } } }
          }
          selectedOptions { name value }
          product { id title handle }
        }
      }
    }
  }
`;

async function probe(masterSku: string, store: string): Promise<void> {
  const [s] = await db.select().from(schema.stores).where(eq(schema.stores.shopDomain, store));
  if (!s) throw new Error('Store not connected');
  const token = await getStoreToken(s.id);

  // Try 3 strategies
  const strategies = [
    `sku:${masterSku}-*`,
    `sku:${masterSku}*`,
    `sku:*${masterSku}*`,
  ];
  for (const q of strategies) {
    const r = await graphqlCall({
      shopDomain: s.shopDomain, apiVersion: s.apiVersion, token, query: Q, variables: { q },
    });
    const edges = (r.data as { productVariants: { edges: { node: unknown }[] } } | undefined)
      ?.productVariants?.edges ?? [];
    console.log(`\nQuery: ${q}  → ${edges.length} variants`);
    for (const e of edges) {
      const n = e.node as { id: string; sku: string | null; title: string; price: string; selectedOptions: { name: string; value: string }[]; presentmentPrices: { edges: { node: { price: { amount: string; currencyCode: string } } }[] }; product: { handle: string; title: string } };
      const opts = n.selectedOptions.map((o) => `${o.name}=${o.value}`).join(', ');
      const usd = n.presentmentPrices.edges.find((pe) => pe.node.price.currencyCode === 'USD');
      console.log(`  sku=${JSON.stringify(n.sku)} title="${n.title}" [${opts}] price=${n.price} usd=${usd?.node.price.amount ?? '-'}  product=${n.product.handle}`);
    }
  }
}

async function main(): Promise<void> {
  const sku = process.argv[2] ?? 'DN0821';
  const store = process.argv[3] ?? 'meanblvd.myshopify.com';
  await probe(sku, store);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => process.exit());
