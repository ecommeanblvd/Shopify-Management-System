import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { upsertOrder } from '../sync/upsert-order';
import type { ShopifyOrderPayload } from '../shopify-types';

const PAGE_SIZE = 50;

const PAGED_QUERY = `
  query orders($q: String!, $cursor: String) {
    orders(first: ${PAGE_SIZE}, query: $q, after: $cursor, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id name createdAt processedAt cancelledAt
        displayFinancialStatus displayFulfillmentStatus currencyCode
        subtotalLineItemsQuantity
        totalDiscountsSet { shopMoney { amount currencyCode } }
        totalShippingPriceSet { shopMoney { amount currencyCode } }
        totalTaxSet { shopMoney { amount currencyCode } }
        totalPriceSet { shopMoney { amount currencyCode } }
        shippingAddress { countryCodeV2 city zip address1 address2 provinceCode name company }
        totalWeight
        lineItems(first: 250) {
          nodes {
            id sku vendor title variantTitle quantity
            originalUnitPriceSet { shopMoney { amount currencyCode } }
            discountAllocations { allocatedAmountSet { shopMoney { amount currencyCode } } }
          }
        }
        refunds {
          id createdAt note
          totalRefundedSet { shopMoney { amount currencyCode } }
        }
        fulfillments { trackingInfo { number company } }
      }
    }
  }
`.trim();

export interface StoreSyncResult {
  storeId: string;
  storeName: string;
  ingested: number;
  error?: string;
}

export async function runHourlySync(): Promise<StoreSyncResult[]> {
  const stores = await db.select().from(schema.stores).where(eq(schema.stores.status, 'active'));
  const results: StoreSyncResult[] = [];

  for (const store of stores) {
    const lockKey = hash(store.id);
    const lockRes = await db.execute<{ locked: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(${lockKey}) AS locked`,
    );
    const lockedRow = lockRes.rows[0];
    if (!lockedRow?.locked) {
      results.push({ storeId: store.id, storeName: store.name, ingested: 0, error: 'locked' });
      continue;
    }

    try {
      const [state] = await db
        .select()
        .from(schema.shopifySyncState)
        .where(eq(schema.shopifySyncState.storeId, store.id));
      const since = state?.lastCronSyncAt ?? new Date(Date.now() - 60 * 60 * 1000);
      const q = `updated_at:>=${since.toISOString()}`;

      const token = await getStoreToken(store.id);
      let cursor: string | null = null;
      let ingested = 0;
      do {
        const res = await graphqlCall({
          shopDomain: store.shopDomain,
          apiVersion: store.apiVersion,
          token,
          query: PAGED_QUERY,
          variables: { q, cursor },
        });
        const body = res as {
          data?: { orders?: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: ShopifyOrderPayload[] } };
          errors?: unknown;
        };
        if (body.errors) throw new Error(`GraphQL error: ${JSON.stringify(body.errors)}`);
        const page = body.data?.orders;
        if (!page) break;
        for (const o of page.nodes) {
          await upsertOrder(store.id, o, 'cron');
          ingested++;
        }
        cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
      } while (cursor);

      await db
        .insert(schema.shopifySyncState)
        .values({ storeId: store.id, lastCronSyncAt: new Date() })
        .onConflictDoUpdate({
          target: schema.shopifySyncState.storeId,
          set: { lastCronSyncAt: new Date() },
        });
      results.push({ storeId: store.id, storeName: store.name, ingested });
    } catch (err) {
      results.push({
        storeId: store.id, storeName: store.name, ingested: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}
