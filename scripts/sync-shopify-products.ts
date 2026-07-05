/* eslint-disable no-console */
/**
 * Sync Shopify products → `shopify_products` table (catalog cho recommendation engine).
 *
 * Walks every product via Admin GraphQL `products(first: 50)` paginated. Upsert
 * theo (store_id, shopify_product_id). available_for_sale = có ít nhất 1 variant
 * còn bán (field `availableForSale` KHÔNG có trực tiếp trên `Product` ở Admin API —
 * chỉ verify được ở variant level; xem VERIFY note dưới). Idempotent — Shopify là
 * nguồn sự thật, không giữ lịch sử.
 *
 * VERIFY (2026-07-05, store cici-mean.myshopify.com, Admin API): query dưới đã
 * chạy thật với 1-2 sản phẩm thật và field khớp đúng như viết:
 *   - featuredImage { url } → có, trả URL CDN thật.
 *   - priceRangeV2 { minVariantPrice { amount currencyCode } } → có, amount string.
 *   - tags → array of string, đúng.
 *   - status → enum string "ACTIVE" (cũng có thể ARCHIVED/DRAFT).
 *   - availableForSale → KHÔNG tồn tại ở Product root; chỉ ở variants.nodes[].
 *     Suy ra bằng variants.nodes.some(v => v.availableForSale).
 *
 * Usage:
 *   pnpm tsx scripts/sync-shopify-products.ts --store cici-mean.myshopify.com
 *   pnpm tsx scripts/sync-shopify-products.ts --all
 *   pnpm tsx scripts/sync-shopify-products.ts --store cici-mean.myshopify.com --limit 100
 */
import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { graphqlCall, getStoreToken } from '@/lib/shopify/client';

interface Args { store?: string; all: boolean; limit: number; }

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const out: Args = { all: false, limit: Number.POSITIVE_INFINITY };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--store') out.store = a[++i];
    else if (a[i] === '--all') out.all = true;
    else if (a[i] === '--limit') out.limit = Number(a[++i]);
  }
  if (!out.store && !out.all) throw new Error('Pass --store <domain> or --all');
  return out;
}

// LƯU Ý: query này đã được VERIFY ở Step 1 với sản phẩm thật (store cici-mean).
const PRODUCTS_QUERY = /* GraphQL */ `
  query CatalogProducts($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title handle vendor productType tags status
        featuredImage { url }
        priceRangeV2 { minVariantPrice { amount currencyCode } }
        variants(first: 100) { nodes { availableForSale } }
      }
    }
  }
`;

interface ProductNode {
  id: string; title: string; handle: string;
  vendor: string | null; productType: string | null; tags: string[]; status: string;
  featuredImage: { url: string } | null;
  priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } } | null;
  variants: { nodes: { availableForSale: boolean }[] };
}
interface QueryData {
  products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ProductNode[] };
}

export async function syncStoreProducts(domain: string, limit: number): Promise<{ products: number }> {
  const [storeRow] = await db.select().from(schema.stores).where(eq(schema.stores.shopDomain, domain));
  if (!storeRow) throw new Error(`Store not connected: ${domain}`);
  console.log(`[products-sync] ${domain} → store ${storeRow.id}`);
  const token = await getStoreToken(storeRow.id);

  let cursor: string | null = null;
  let total = 0;
  const BATCH = 200;
  let buffer: typeof schema.shopifyProducts.$inferInsert[] = [];

  async function flush(): Promise<void> {
    if (buffer.length === 0) return;
    await db.insert(schema.shopifyProducts).values(buffer).onConflictDoUpdate({
      target: [schema.shopifyProducts.storeId, schema.shopifyProducts.shopifyProductId],
      set: {
        title: sql`excluded.title`, handle: sql`excluded.handle`,
        vendor: sql`excluded.vendor`, productType: sql`excluded.product_type`,
        tags: sql`excluded.tags`, imageUrl: sql`excluded.image_url`,
        priceMin: sql`excluded.price_min`, currency: sql`excluded.currency`,
        availableForSale: sql`excluded.available_for_sale`, status: sql`excluded.status`,
        syncedAt: sql`now()`,
      },
    });
    buffer = [];
  }

  while (total < limit) {
    const result = await graphqlCall({
      shopDomain: storeRow.shopDomain, apiVersion: storeRow.apiVersion, token,
      query: PRODUCTS_QUERY, variables: { cursor },
    });
    if (result.errors) throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
    const data = result.data as QueryData;

    for (const p of data.products.nodes) {
      const price = p.priceRangeV2?.minVariantPrice;
      buffer.push({
        storeId: storeRow.id,
        shopifyProductId: p.id,
        title: p.title,
        handle: p.handle,
        vendor: p.vendor ?? null,
        productType: p.productType ?? null,
        tags: p.tags ?? [],
        imageUrl: p.featuredImage?.url ?? null,
        priceMin: price ? String(price.amount) : null,
        currency: price?.currencyCode ?? null,
        availableForSale: p.variants.nodes.some((v) => v.availableForSale),
        status: p.status,
      });
      total++;
      if (buffer.length >= BATCH) await flush();
      if (total >= limit) break;
    }

    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
    await new Promise((r) => setTimeout(r, 200)); // pacing GraphQL points
  }
  await flush();
  console.log(`[products-sync] ${domain} done: ${total} products`);
  return { products: total };
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (args.all) {
    const stores = await db.select({ shopDomain: schema.stores.shopDomain })
      .from(schema.stores).where(eq(schema.stores.status, 'active'));
    for (const s of stores) {
      try { await syncStoreProducts(s.shopDomain, args.limit); }
      catch (e) { console.error(`[products-sync] ${s.shopDomain} failed:`, e); }
    }
  } else if (args.store) {
    await syncStoreProducts(args.store, args.limit);
  }
}

if (process.argv[1]?.includes('sync-shopify-products')) {
  main().catch((e) => { console.error(e); process.exit(1); }).finally(() => process.exit());
}
