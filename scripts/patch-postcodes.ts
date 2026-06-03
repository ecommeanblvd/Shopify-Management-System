/**
 * Surgical UPDATE: fetch shippingAddress.zip from Shopify cho mỗi
 * order ĐÃ có sẵn trong DB nhưng còn thiếu `ship_postcode`.
 *
 * KHÔNG thêm orders mới (khác với backfill-shopify-orders.ts).
 * Chạy theo store, batch 50 IDs/lần qua GraphQL `nodes(ids: ...)`.
 *
 * Usage:
 *   tsx scripts/patch-postcodes.ts --store=<store-uuid> [--limit=N]
 */

import { eq, and, isNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';

const BATCH_SIZE = 50;

interface NodeQueryResult {
  data?: {
    nodes: Array<{ id: string; shippingAddress?: { zip: string | null } | null } | null>;
  };
  errors?: unknown;
}

async function fetchPostcodes(
  shopDomain: string,
  apiVersion: string,
  token: string,
  shopifyOrderIds: readonly string[],
): Promise<Map<string, string | null>> {
  const query = `
    query PatchZips($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Order {
          id
          shippingAddress { zip }
        }
      }
    }
  `;
  const res = await graphqlCall({
    shopDomain, apiVersion, token, query,
    variables: { ids: shopifyOrderIds },
  }) as NodeQueryResult;
  if (res.errors) throw new Error(`GraphQL: ${JSON.stringify(res.errors)}`);
  const map = new Map<string, string | null>();
  for (const node of res.data?.nodes ?? []) {
    if (!node) continue;
    const zip = node.shippingAddress?.zip?.trim() || null;
    map.set(node.id, zip);
  }
  return map;
}

async function main(): Promise<void> {
  const storeArg = process.argv.find((a) => a.startsWith('--store='));
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  if (!storeArg) {
    process.stderr.write('usage: tsx scripts/patch-postcodes.ts --store=<uuid> [--limit=N]\n');
    process.exit(1);
  }
  const storeId = storeArg.split('=')[1];
  const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;

  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
  if (!store) throw new Error(`store ${storeId} not found`);
  const token = await getStoreToken(storeId);
  process.stdout.write(`Patching postcodes for ${store.name} (${store.shopDomain})…\n`);

  // Orders missing postcode. shopify_order_id is the gid we need for the
  // nodes() query — already stored on the row.
  const rows = await db
    .select({
      id: schema.shopifyOrders.id,
      shopifyOrderId: schema.shopifyOrders.shopifyOrderId,
    })
    .from(schema.shopifyOrders)
    .where(and(
      eq(schema.shopifyOrders.storeId, storeId),
      isNull(schema.shopifyOrders.shipPostcode),
    ));
  const target = rows.slice(0, Math.min(limit, rows.length));
  process.stdout.write(`${target.length} orders missing ship_postcode (of ${rows.length} total)\n`);
  if (target.length === 0) return;

  let updated = 0, nullFromShopify = 0, errors = 0;
  for (let i = 0; i < target.length; i += BATCH_SIZE) {
    const batch = target.slice(i, i + BATCH_SIZE);
    const idsForGql = batch.map((r) => r.shopifyOrderId);
    try {
      const zips = await fetchPostcodes(store.shopDomain, store.apiVersion, token, idsForGql);
      for (const r of batch) {
        const zip = zips.get(r.shopifyOrderId) ?? null;
        if (zip === null) {
          nullFromShopify++;
          continue;
        }
        await db
          .update(schema.shopifyOrders)
          .set({ shipPostcode: zip })
          .where(eq(schema.shopifyOrders.id, r.id));
        updated++;
      }
    } catch (err) {
      errors++;
      process.stderr.write(`batch ${i}: ${err instanceof Error ? err.message : String(err)}\n`);
    }
    if ((i / BATCH_SIZE) % 5 === 0) {
      const pct = ((i + batch.length) * 100 / target.length).toFixed(1);
      process.stdout.write(`  progress ${i + batch.length}/${target.length} (${pct}%) — updated=${updated} null=${nullFromShopify}\n`);
    }
  }
  process.stdout.write(`\nDONE — updated=${updated} null_from_shopify=${nullFromShopify} errors=${errors}\n`);
}

main()
  .catch((err) => {
    process.stderr.write(`patch-postcodes: fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
