/* eslint-disable no-console */
/**
 * Backfill MMP → Shopify identifiers for products that already
 * existed on Shopify before the MMP integration went live.
 *
 * For each MMP product in the target brand:
 *   1. Read its variants (DN0821-XS-CRE, DN0821-S-CRE, ...).
 *   2. Query Shopify Admin GraphQL for those variants by SKU.
 *   3. Backfill:
 *        mmp_products.shopify_product_id
 *        mmp_products.price_usd  (if currently NULL, from variant USD presentment)
 *        mmp_product_variants.shopify_variant_id  (per-SKU)
 *
 * Strategy: one GraphQL call per MMP product, scoped to the master
 * SKU prefix (e.g. `sku:DN0821-*`). Returns ALL variants on Shopify
 * that share the prefix, which we then map back by exact SKU match.
 * This keeps the script readable and well within Shopify's rate
 * budget for ~138 products on a single store.
 *
 * Defaults to DRY-RUN. Pass --apply to actually write to the DB.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-mmp-shopify-ids.ts \
 *     --brand denio \
 *     --store meanblvd.myshopify.com
 *
 *   pnpm tsx scripts/backfill-mmp-shopify-ids.ts \
 *     --brand denio \
 *     --store meanblvd.myshopify.com \
 *     --apply
 */
import 'dotenv/config';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { graphqlCall, getStoreToken } from '@/lib/shopify/client';

interface Args {
  brand: string;
  store: string;
  apply: boolean;
  limit: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let brand = 'denio';
  let store = 'meanblvd.myshopify.com';
  let apply = false;
  let limit = Number.POSITIVE_INFINITY;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--brand') brand = args[++i];
    else if (a === '--store') store = args[++i];
    else if (a === '--apply') apply = true;
    else if (a === '--limit') limit = Number(args[++i]);
  }
  return { brand, store, apply, limit };
}

const VARIANTS_BY_SKU_QUERY = /* GraphQL */ `
  query VariantsBySkuPrefix($q: String!) {
    productVariants(first: 100, query: $q) {
      edges {
        node {
          id
          sku
          price
          selectedOptions { name value }
          product {
            id
            title
            handle
            status
          }
        }
      }
    }
  }
`;

interface ShopifyVariantNode {
  id: string;
  sku: string | null;
  price: string; // Already in store's primary currency. meanblvd → USD.
  selectedOptions: { name: string; value: string }[];
  product: {
    id: string;
    title: string;
    handle: string;
    status: string;
  };
}

/** Build a lookup key for a (color, size) pair, normalised so MMP
 *  values like "  Cream " match Shopify's "Cream". */
function optionKey(color: string | null, size: string | null): string {
  return `${(color ?? '').trim().toLowerCase()}|${(size ?? '').trim().toLowerCase()}`;
}

function variantOptionKey(v: ShopifyVariantNode): string {
  let color = '';
  let size = '';
  for (const o of v.selectedOptions) {
    if (o.name.toLowerCase() === 'color') color = o.value;
    else if (o.name.toLowerCase() === 'size') size = o.value;
  }
  return optionKey(color, size);
}

interface QueryResult {
  productVariants: { edges: { node: ShopifyVariantNode }[] };
}

interface MmpProductRow {
  id: string;
  portalProductId: string;
  sku: string;
  name: string;
  priceUsd: string | null;
  shopifyProductId: string | null;
}

interface MmpVariantRow {
  id: string;
  sku: string;
  color: string | null;
  size: string | null;
  shopifyVariantId: string | null;
}

interface ProductReport {
  mmpId: string;
  masterSku: string;
  name: string;
  matchedShopifyProductId: string | null;
  shopifyTitle: string | null;
  shopifyHandle: string | null;
  totalMmpVariants: number;
  matchedVariants: number;
  unmatchedOptionPairs: string[];
  conflictingProductIds: string[];
  usdPriceFromShopify: string | null;
  willUpdateProductId: boolean;
  willUpdatePriceUsd: boolean;
  /** Per-variant update plan. `oldSku` reflects MMP's current SKU,
   *  `newSku` the canonical Shopify SKU we want to copy across. */
  variantUpdates: {
    mmpVariantId: string;
    oldSku: string;
    newSku: string;
    shopifyVariantId: string;
  }[];
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`[backfill] brand=${args.brand} store=${args.store} apply=${args.apply}`);

  // 1. Lookup target store row.
  const [storeRow] = await db
    .select()
    .from(schema.stores)
    .where(eq(schema.stores.shopDomain, args.store))
    .limit(1);
  if (!storeRow) throw new Error(`Store ${args.store} is not connected`);
  console.log(`[backfill] store id=${storeRow.id} apiVersion=${storeRow.apiVersion}`);
  const token = await getStoreToken(storeRow.id);

  // 2. Load MMP products needing backfill — limit to those without
  //    a shopify_product_id so re-runs are idempotent.
  const products: MmpProductRow[] = await db
    .select({
      id: schema.mmpProducts.id,
      portalProductId: schema.mmpProducts.portalProductId,
      sku: schema.mmpProducts.sku,
      name: schema.mmpProducts.name,
      priceUsd: schema.mmpProducts.priceUsd,
      shopifyProductId: schema.mmpProducts.shopifyProductId,
    })
    .from(schema.mmpProducts)
    .where(and(
      eq(schema.mmpProducts.brandSlug, args.brand),
      isNull(schema.mmpProducts.shopifyProductId),
    ));
  console.log(`[backfill] ${products.length} products in scope (limit=${args.limit})`);

  const reports: ProductReport[] = [];
  let processed = 0;

  // 3. Walk each product → query Shopify → build a report.
  for (const p of products) {
    if (processed >= args.limit) break;
    processed++;

    const variants: MmpVariantRow[] = await db
      .select({
        id: schema.mmpProductVariants.id,
        sku: schema.mmpProductVariants.sku,
        color: schema.mmpProductVariants.color,
        size: schema.mmpProductVariants.size,
        shopifyVariantId: schema.mmpProductVariants.shopifyVariantId,
      })
      .from(schema.mmpProductVariants)
      .where(eq(schema.mmpProductVariants.productId, p.id));

    const report: ProductReport = {
      mmpId: p.id,
      masterSku: p.sku,
      name: p.name,
      matchedShopifyProductId: null,
      shopifyTitle: null,
      shopifyHandle: null,
      totalMmpVariants: variants.length,
      matchedVariants: 0,
      unmatchedOptionPairs: [],
      conflictingProductIds: [],
      usdPriceFromShopify: null,
      willUpdateProductId: false,
      willUpdatePriceUsd: false,
      variantUpdates: [],
    };

    // Build a Shopify SKU-prefix query. For master SKU "DN0821",
    // search "sku:DN0821-*" which returns every variant on the store
    // that starts with that prefix.
    const shopifyQuery = `sku:${p.sku}-*`;
    let shopifyVariants: ShopifyVariantNode[];
    try {
      const result = await graphqlCall({
        shopDomain: storeRow.shopDomain,
        apiVersion: storeRow.apiVersion,
        token,
        query: VARIANTS_BY_SKU_QUERY,
        variables: { q: shopifyQuery },
      });
      if (result.errors) {
        console.error(`[backfill] [${p.sku}] GraphQL errors:`, JSON.stringify(result.errors));
        reports.push(report);
        continue;
      }
      shopifyVariants = (result.data as QueryResult).productVariants.edges.map((e) => e.node);
    } catch (err) {
      console.error(`[backfill] [${p.sku}] graphql call failed:`, err);
      reports.push(report);
      continue;
    }

    if (shopifyVariants.length === 0) {
      console.warn(`[backfill] [${p.sku}] no Shopify variants matched`);
      reports.push(report);
      continue;
    }

    // Detect product-id collisions (multiple distinct parent products).
    // When the SKU prefix matches more than one product on Shopify
    // (usually a re-upload / duplicate), prefer the single ACTIVE one.
    // Skip if 0 or 2+ ACTIVE products remain — that needs human eyes.
    const productIds = new Set(shopifyVariants.map((v) => v.product.id));
    report.conflictingProductIds = [...productIds];
    let chosenParent: ShopifyVariantNode['product'] | null = null;
    if (productIds.size === 1) {
      chosenParent = shopifyVariants[0].product;
    } else {
      const activeVariants = shopifyVariants.filter((v) => v.product.status === 'ACTIVE');
      const activeProductIds = new Set(activeVariants.map((v) => v.product.id));
      if (activeProductIds.size === 1) {
        chosenParent = activeVariants[0].product;
        // Narrow the variant pool to the chosen parent so option-matching
        // below doesn't pull a SKU from a stale duplicate.
        shopifyVariants = activeVariants;
        console.log(
          `[backfill] [${p.sku}] collision resolved → ACTIVE product ${chosenParent.id} (${chosenParent.handle})`,
        );
      } else {
        console.warn(
          `[backfill] [${p.sku}] ${productIds.size} products, ${activeProductIds.size} ACTIVE — skipping for manual review`,
        );
        reports.push(report);
        continue;
      }
    }
    const parent = chosenParent;
    report.matchedShopifyProductId = parent.id;
    report.shopifyTitle = parent.title;
    report.shopifyHandle = parent.handle;

    // 4. Build a (color|size) lookup over Shopify's variants. SKU
    //    formats differ between systems (MMP: DN0821-XS-CRE, Shopify:
    //    Denio-DN0821-XS-WADM-PLA) so option attributes are the only
    //    reliable join key.
    const shopifyByOption = new Map<string, ShopifyVariantNode>();
    for (const sv of shopifyVariants) {
      shopifyByOption.set(variantOptionKey(sv), sv);
    }
    for (const mv of variants) {
      const key = optionKey(mv.color, mv.size);
      const sv = shopifyByOption.get(key);
      if (!sv) {
        report.unmatchedOptionPairs.push(`${mv.color ?? '?'}/${mv.size ?? '?'} (${mv.sku})`);
        continue;
      }
      report.matchedVariants++;
      const newSku = sv.sku ?? mv.sku; // never wipe an existing SKU
      const needsIdUpdate = mv.shopifyVariantId !== sv.id;
      const needsSkuUpdate = newSku !== mv.sku;
      if (needsIdUpdate || needsSkuUpdate) {
        report.variantUpdates.push({
          mmpVariantId: mv.id,
          oldSku: mv.sku,
          newSku,
          shopifyVariantId: sv.id,
        });
      }
    }

    // 5. USD price — meanblvd's primary currency is USD so variant.price
    //    is already in USD. Take the first variant; all sizes share the
    //    same price except the "Customize" upcharge, which we don't
    //    sync into MMP.
    report.usdPriceFromShopify = shopifyVariants[0]?.price ?? null;
    report.willUpdateProductId = p.shopifyProductId !== parent.id;
    report.willUpdatePriceUsd = p.priceUsd === null && report.usdPriceFromShopify !== null;

    // 6. Apply if requested.
    if (args.apply) {
      await db
        .update(schema.mmpProducts)
        .set({
          shopifyProductId: parent.id,
          priceUsd: report.willUpdatePriceUsd ? report.usdPriceFromShopify : p.priceUsd,
        })
        .where(eq(schema.mmpProducts.id, p.id));
      for (const u of report.variantUpdates) {
        await db
          .update(schema.mmpProductVariants)
          .set({ shopifyVariantId: u.shopifyVariantId, sku: u.newSku })
          .where(eq(schema.mmpProductVariants.id, u.mmpVariantId));
      }
    }

    reports.push(report);

    // Gentle pacing — Shopify GraphQL points refill quickly but we
    // make ~138 sequential queries; a small jitter keeps it well
    // under the per-second cap.
    await new Promise((r) => setTimeout(r, 120));
  }

  // 7. Final report.
  console.log('\n========== REPORT ==========');
  const matched = reports.filter((r) => r.matchedShopifyProductId !== null);
  const unmatched = reports.filter((r) => r.matchedShopifyProductId === null);
  const conflicted = reports.filter((r) => r.conflictingProductIds.length > 1);
  const totalVariantUpdates = matched.reduce((acc, r) => acc + r.variantUpdates.length, 0);

  console.log(`Products processed:        ${reports.length}`);
  console.log(`  matched on Shopify:      ${matched.length}`);
  console.log(`  unmatched:               ${unmatched.length}`);
  console.log(`  prefix-collision skips:  ${conflicted.length}`);
  console.log(`Variant updates queued:    ${totalVariantUpdates}`);
  console.log(`Price-USD backfills:       ${matched.filter((r) => r.willUpdatePriceUsd).length}`);

  if (unmatched.length > 0) {
    console.log('\n--- unmatched master SKUs ---');
    for (const r of unmatched) {
      console.log(`  ${r.masterSku.padEnd(12)}  ${r.name}`);
    }
  }
  if (conflicted.length > 0) {
    console.log('\n--- prefix collisions (manual review) ---');
    for (const r of conflicted) {
      console.log(`  ${r.masterSku}  ${r.name}  → products: ${r.conflictingProductIds.join(', ')}`);
    }
  }

  // Per-product breakdown of variant matching, condensed.
  console.log('\n--- per-product variant match ---');
  for (const r of matched) {
    const tag = r.unmatchedOptionPairs.length === 0 ? 'OK' : `MISS ${r.unmatchedOptionPairs.length}`;
    console.log(
      `  [${tag.padEnd(6)}] ${r.masterSku.padEnd(10)} ${r.matchedVariants}/${r.totalMmpVariants}  ${r.shopifyHandle}  usd=${r.usdPriceFromShopify ?? '-'}`,
    );
    if (r.unmatchedOptionPairs.length > 0) {
      console.log(`     unmatched MMP variants: ${r.unmatchedOptionPairs.join('; ')}`);
    }
  }

  console.log(`\n${args.apply ? '✅ APPLIED' : '🔎 DRY-RUN (no writes)'}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit());
