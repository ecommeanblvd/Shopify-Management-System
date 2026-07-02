/**
 * Recurring warehouse → Shopify sync for vendor "MEAN BLVD" resale products on
 * the `meanblvd.myshopify.com` store. WRITES to the production store.
 *
 * For every MEAN BLVD product:
 *   1. Set each tracked variant's on-hand inventory = warehouse SELLABLE qty
 *      (sum(qty_on_hand - qty_reserved), clamped ≥ 0; 0 if the SKU is absent).
 *   2. ACTIVE product whose variants all end at 0 sellable → ARCHIVE it.
 *   3. ARCHIVED product with any variant now > 0 sellable → un-archive (ACTIVE).
 *
 * All planning is done by the pure `planMeanblvdSync`; this module only does
 * I/O: load the store + token, resolve the active location, paginate the vendor
 * query, load warehouse sellable, then apply the plan via `graphqlCall`.
 *
 * Errors within a mutation group are collected and do NOT abort the run.
 */
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import {
  normSku,
  planMeanblvdSync,
  type MeanProduct,
  type MeanVariant,
} from './meanblvd-sync-logic';

const SHOP_DOMAIN = 'meanblvd.myshopify.com';
const INVENTORY_BATCH = 200;
const RATE_LIMIT_SLEEP_MS = 350;

export interface MeanblvdSyncSummary {
  meanProducts: number;
  inventorySets: number;
  archived: number;
  unarchived: number;
  errors: string[];
  dryRun: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface LocationsResponse {
  locations?: {
    nodes?: Array<{ id: string; name: string; isActive: boolean; shipsInventory: boolean }>;
  };
}

interface ProductsResponse {
  products?: {
    pageInfo?: { hasNextPage: boolean; endCursor: string | null };
    nodes?: Array<{
      id: string;
      status: string;
      variants?: {
        nodes?: Array<{
          sku: string | null;
          inventoryQuantity: number | null;
          inventoryItem?: { id: string; tracked: boolean } | null;
        }>;
      };
    }>;
  };
}

interface UserErrorsResponse {
  [key: string]: { userErrors?: Array<{ field?: string[] | null; message: string }> } | undefined;
}

const LOCATIONS_QUERY = /* GraphQL */ `
  {
    locations(first: 10) {
      nodes { id name isActive shipsInventory }
    }
  }
`;

const PRODUCTS_QUERY = /* GraphQL */ `
  query MeanblvdProducts($c: String) {
    products(first: 60, query: "vendor:'MEAN BLVD'", after: $c) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        status
        variants(first: 100) {
          nodes {
            sku
            inventoryQuantity
            inventoryItem { id tracked }
          }
        }
      }
    }
  }
`;

const INVENTORY_MUTATION = /* GraphQL */ `
  mutation SetOnHand($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      userErrors { field message }
    }
  }
`;

const STATUS_MUTATION = /* GraphQL */ `
  mutation SetStatus($id: ID!, $status: ProductStatus!) {
    productUpdate(product: { id: $id, status: $status }) {
      product { id status }
      userErrors { field message }
    }
  }
`;

/** Fail loudly if GraphQL transport-level errors came back. */
function assertNoGraphqlErrors(res: { errors?: unknown }, context: string): void {
  if (res.errors && (!Array.isArray(res.errors) || res.errors.length > 0)) {
    throw new Error(`${context}: GraphQL errors ${JSON.stringify(res.errors)}`);
  }
}

/** Collect Shopify userErrors for a mutation payload into the errors array. */
function collectUserErrors(
  data: unknown,
  mutationRoot: string,
  context: string,
  errors: string[],
): void {
  const root = (data as UserErrorsResponse | undefined)?.[mutationRoot];
  const userErrors = root?.userErrors ?? [];
  for (const ue of userErrors) {
    errors.push(`${context}: ${ue.field?.join('.') ?? ''} ${ue.message}`.trim());
  }
}

/** Resolve the first active location that ships inventory; throw if none. */
async function resolveActiveLocation(
  shopDomain: string,
  apiVersion: string,
  token: string,
): Promise<string> {
  const res = await graphqlCall({ shopDomain, apiVersion, token, query: LOCATIONS_QUERY });
  assertNoGraphqlErrors(res, 'locations');
  const nodes = (res.data as LocationsResponse | undefined)?.locations?.nodes ?? [];
  const active = nodes.find((n) => n.isActive && n.shipsInventory);
  if (!active) {
    throw new Error('No active location with shipsInventory=true on meanblvd store');
  }
  return active.id;
}

/** Paginate the vendor query into MeanProduct[] (only usable variants kept). */
async function fetchMeanProducts(
  shopDomain: string,
  apiVersion: string,
  token: string,
): Promise<MeanProduct[]> {
  const products: MeanProduct[] = [];
  let cursor: string | null = null;

  for (;;) {
    const res = await graphqlCall({
      shopDomain,
      apiVersion,
      token,
      query: PRODUCTS_QUERY,
      variables: { c: cursor },
    });
    assertNoGraphqlErrors(res, 'products');
    const page = (res.data as ProductsResponse | undefined)?.products;
    const nodes = page?.nodes ?? [];

    for (const n of nodes) {
      const variants: MeanVariant[] = (n.variants?.nodes ?? [])
        .filter((v) => v.inventoryItem?.tracked === true && (v.sku ?? '').trim() !== '')
        .map((v) => ({
          sku: v.sku ?? '',
          inventoryQuantity: v.inventoryQuantity ?? 0,
          inventoryItemId: v.inventoryItem!.id,
          tracked: true,
        }));
      products.push({
        id: n.id,
        status: (n.status as MeanProduct['status']) ?? 'ACTIVE',
        variants,
      });
    }

    if (!page?.pageInfo?.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
    await sleep(RATE_LIMIT_SLEEP_MS);
  }

  return products;
}

/** Load warehouse sellable qty grouped + normalized by SKU. */
async function loadSellableByNormSku(): Promise<Map<string, number>> {
  const result = await db.execute<{ sku: string; sellable: number }>(sql`
    SELECT sku, sum(qty_on_hand - qty_reserved)::int AS sellable
    FROM warehouse_inventory
    WHERE sku IS NOT NULL
    GROUP BY sku
  `);
  const map = new Map<string, number>();
  for (const row of result.rows) {
    const key = normSku(row.sku);
    map.set(key, (map.get(key) ?? 0) + row.sellable);
  }
  return map;
}

export async function syncMeanblvdToShopify(
  opts?: { dryRun?: boolean },
): Promise<MeanblvdSyncSummary> {
  const dryRun = opts?.dryRun ?? false;

  // 1) Load store row + token.
  const [store] = await db
    .select()
    .from(schema.stores)
    .where(eq(schema.stores.shopDomain, SHOP_DOMAIN))
    .limit(1);
  if (!store) throw new Error(`Store not found: ${SHOP_DOMAIN}`);
  const token = await getStoreToken(store.id);
  const { apiVersion } = store;

  // 2) Resolve active location + 3) paginate products + 4) warehouse sellable.
  const locationId = await resolveActiveLocation(SHOP_DOMAIN, apiVersion, token);
  const products = await fetchMeanProducts(SHOP_DOMAIN, apiVersion, token);
  const sellableByNormSku = await loadSellableByNormSku();

  // 5) Plan (pure).
  const plan = planMeanblvdSync(products, sellableByNormSku);

  const summary: MeanblvdSyncSummary = {
    meanProducts: products.length,
    inventorySets: plan.inventorySets.length,
    archived: plan.archive.length,
    unarchived: plan.unarchive.length,
    errors: [],
    dryRun,
  };

  if (dryRun) return summary;

  const errors: string[] = [];

  // 6a) Inventory sets in batches of 200 (one mutation call per batch).
  for (let i = 0; i < plan.inventorySets.length; i += INVENTORY_BATCH) {
    const batch = plan.inventorySets.slice(i, i + INVENTORY_BATCH);
    const input = {
      name: 'on_hand',
      reason: 'correction',
      ignoreCompareQuantity: true,
      quantities: batch.map((s) => ({
        inventoryItemId: s.inventoryItemId,
        locationId,
        quantity: s.quantity,
      })),
    };
    try {
      const res = await graphqlCall({
        shopDomain: SHOP_DOMAIN,
        apiVersion,
        token,
        query: INVENTORY_MUTATION,
        variables: { input },
      });
      assertNoGraphqlErrors(res, `inventorySet batch@${i}`);
      collectUserErrors(res.data, 'inventorySetQuantities', `inventorySet batch@${i}`, errors);
    } catch (e) {
      errors.push(`inventorySet batch@${i}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await sleep(RATE_LIMIT_SLEEP_MS);
  }

  // 6b) Archive, then 6c) un-archive — one product per call.
  for (const [status, ids] of [
    ['ARCHIVED', plan.archive] as const,
    ['ACTIVE', plan.unarchive] as const,
  ]) {
    for (const id of ids) {
      try {
        const res = await graphqlCall({
          shopDomain: SHOP_DOMAIN,
          apiVersion,
          token,
          query: STATUS_MUTATION,
          variables: { id, status },
        });
        assertNoGraphqlErrors(res, `productUpdate ${status} ${id}`);
        collectUserErrors(res.data, 'productUpdate', `productUpdate ${status} ${id}`, errors);
      } catch (e) {
        errors.push(`productUpdate ${status} ${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
      await sleep(RATE_LIMIT_SLEEP_MS);
    }
  }

  return { ...summary, errors };
}
