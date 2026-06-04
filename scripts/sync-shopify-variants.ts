/* eslint-disable no-console */
/**
 * Sync Shopify product variants → `shopify_variants` table.
 *
 * Walks every product → every variant for a given store via the
 * Admin GraphQL `products(first: 250)` paginated query. Normalises
 * weight to grams at write time so all downstream consumers can sum
 * freely without re-checking the unit field.
 *
 * Idempotent: upserts by (store_id, shopify_variant_id). Existing
 * rows are overwritten with the latest snapshot — there's no history
 * because Shopify itself is the source of truth.
 *
 * Usage:
 *   pnpm tsx scripts/sync-shopify-variants.ts --store meanblvd.myshopify.com
 *   pnpm tsx scripts/sync-shopify-variants.ts --store cici-mean.myshopify.com --limit 100
 *
 *   # All stores
 *   pnpm tsx scripts/sync-shopify-variants.ts --all
 */
import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { graphqlCall, getStoreToken } from '@/lib/shopify/client';

interface Args {
  store?: string;
  all: boolean;
  limit: number;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const out: Args = { all: false, limit: Number.POSITIVE_INFINITY };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--store') out.store = a[++i];
    else if (a[i] === '--all') out.all = true;
    else if (a[i] === '--limit') out.limit = Number(a[++i]);
  }
  if (!out.store && !out.all) {
    throw new Error('Pass --store <domain> or --all');
  }
  return out;
}

/** Convert Shopify's reported weight to grams. Shopify's
 *  `InventoryItem.measurement.weight` returns { value, unit } where
 *  unit ∈ {KILOGRAMS, GRAMS, POUNDS, OUNCES}. */
function toGrams(value: number | null, unit: string | null): number | null {
  if (value === null || unit === null) return null;
  switch (unit) {
    case 'GRAMS':     return value;
    case 'KILOGRAMS': return value * 1000;
    case 'POUNDS':    return value * 453.59237;
    case 'OUNCES':    return value * 28.349523125;
    default:          return null; // unknown unit → skip
  }
}

const PRODUCTS_QUERY = /* GraphQL */ `
  query Variants($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        variants(first: 100) {
          nodes {
            id
            sku
            title
            taxable
            inventoryItem {
              measurement {
                weight { value unit }
              }
            }
          }
        }
      }
    }
  }
`;

interface ShopifyVariantNode {
  id: string;
  sku: string | null;
  title: string;
  taxable: boolean;
  inventoryItem: {
    measurement: {
      weight: { value: number | null; unit: string | null } | null;
    } | null;
  } | null;
}

interface ProductNode {
  id: string;
  title: string;
  variants: { nodes: ShopifyVariantNode[] };
}

interface QueryData {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: ProductNode[];
  };
}

async function syncOneStore(domain: string, limitVariants: number): Promise<void> {
  const [storeRow] = await db
    .select()
    .from(schema.stores)
    .where(eq(schema.stores.shopDomain, domain));
  if (!storeRow) throw new Error(`Store not connected: ${domain}`);
  console.log(`[variants-sync] ${domain} → store ${storeRow.id}`);
  const token = await getStoreToken(storeRow.id);

  let cursor: string | null = null;
  let totalVariants = 0;
  let totalProducts = 0;
  let withWeight = 0;
  let withoutWeight = 0;

  const BATCH_INSERT = 200; // keep statement size sane
  let buffer: typeof schema.shopifyVariants.$inferInsert[] = [];

  async function flush(): Promise<void> {
    if (buffer.length === 0) return;
    await db
      .insert(schema.shopifyVariants)
      .values(buffer)
      .onConflictDoUpdate({
        target: [schema.shopifyVariants.storeId, schema.shopifyVariants.shopifyVariantId],
        set: {
          shopifyProductId: sql`excluded.shopify_product_id`,
          sku: sql`excluded.sku`,
          variantTitle: sql`excluded.variant_title`,
          productTitle: sql`excluded.product_title`,
          weightGrams: sql`excluded.weight_grams`,
          weightUnit: sql`excluded.weight_unit`,
          taxable: sql`excluded.taxable`,
          syncedAt: sql`now()`,
        },
      });
    buffer = [];
  }

  while (totalVariants < limitVariants) {
    const result = await graphqlCall({
      shopDomain: storeRow.shopDomain,
      apiVersion: storeRow.apiVersion,
      token,
      query: PRODUCTS_QUERY,
      variables: { cursor },
    });
    if (result.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
    }
    const data = result.data as QueryData;

    for (const p of data.products.nodes) {
      totalProducts++;
      for (const v of p.variants.nodes) {
        const w = v.inventoryItem?.measurement?.weight;
        const grams = toGrams(w?.value ?? null, w?.unit ?? null);
        if (grams !== null) withWeight++;
        else withoutWeight++;
        buffer.push({
          storeId: storeRow.id,
          shopifyVariantId: v.id,
          shopifyProductId: p.id,
          sku: v.sku ?? null,
          variantTitle: v.title === 'Default Title' ? null : v.title,
          productTitle: p.title,
          weightGrams: grams !== null ? String(grams) : null,
          weightUnit: w?.unit ?? null,
          taxable: v.taxable,
        });
        totalVariants++;
        if (buffer.length >= BATCH_INSERT) await flush();
        if (totalVariants >= limitVariants) break;
      }
      if (totalVariants >= limitVariants) break;
    }

    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
    if (totalProducts % 200 === 0) {
      console.log(`[variants-sync]   ${totalProducts} products / ${totalVariants} variants so far…`);
    }
    // Gentle pacing — Shopify GraphQL points refill quickly but each
    // products(first:50) is ~50 cost points.
    await new Promise((r) => setTimeout(r, 200));
  }
  await flush();

  console.log(`[variants-sync] ${domain} done: ${totalProducts} products, ${totalVariants} variants, ${withWeight} with weight, ${withoutWeight} missing weight`);
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (args.all) {
    const stores = await db.select({ shopDomain: schema.stores.shopDomain })
      .from(schema.stores)
      .where(eq(schema.stores.status, 'active'));
    for (const s of stores) {
      try { await syncOneStore(s.shopDomain, args.limit); }
      catch (e) { console.error(`[variants-sync] ${s.shopDomain} failed:`, e); }
    }
  } else if (args.store) {
    await syncOneStore(args.store, args.limit);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => process.exit());
