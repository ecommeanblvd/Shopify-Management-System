import { eq, min } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { upsertOrder } from '../sync/upsert-order';
import { submitBackfillBulkQuery } from './submit-bulk-query';
import { pollBulkOperation } from './poll-bulk-operation';
import { streamBulkResult } from './stream-jsonl';

const POLL_INTERVAL_MS = 30_000;
const WATCHDOG_MS = 2 * 60 * 60 * 1000; // 2h

export interface BackfillResult {
  storeId: string;
  ordersIngested: number;
  bulkOperationId: string;
  durationMs: number;
  /** The Shopify search clause used, or '' for a full-history export. For observability/logs. */
  filterClause: string;
}

/**
 * Build the Shopify `orders` search clause for a historical backfill.
 *
 * We only want the orders we DON'T already have. Sync channels (webhook/cron)
 * always pull the most-recent orders, so what's in the DB is a recent block and
 * the gap is everything OLDER than it. We ask Shopify for `created_at:<=<oldest
 * synced>` so it filters server-side and never streams back the rows we already
 * hold — saving bulk-export time and API budget. `<=` (not `<`) re-fetches only
 * the boundary order(s) sharing that exact timestamp, which `upsertOrder` dedups
 * idempotently — cheap insurance against same-second ties leaving a hole.
 *
 * If the store has no orders at all (fresh connect / test store), returns '' to
 * export the entire history.
 */
async function buildBackfillFilter(storeId: string): Promise<string> {
  const [row] = await db
    .select({ oldest: min(schema.shopifyOrders.createdAtShopify) })
    .from(schema.shopifyOrders)
    .where(eq(schema.shopifyOrders.storeId, storeId));
  const oldest = row?.oldest ? new Date(row.oldest) : null;
  return oldest ? `created_at:<=${oldest.toISOString()}` : '';
}

export interface BackfillOptions {
  /**
   * Override the Shopify `orders` search clause. Default (undefined) skips
   * orders already synced — see buildBackfillFilter. Pass an explicit clause
   * (e.g. `created_at:>=<iso>`) to force a re-fetch window, which is what the
   * address re-sync scripts need to refresh fields on orders already in the DB.
   */
  filterClause?: string;
}

export async function runBackfillForStore(
  storeId: string,
  opts?: BackfillOptions,
): Promise<BackfillResult> {
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
  if (!store) throw new Error(`store ${storeId} not found`);

  await db
    .insert(schema.shopifySyncState)
    .values({ storeId, backfillStatus: 'running', backfillStartedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.shopifySyncState.storeId,
      set: { backfillStatus: 'running', backfillStartedAt: new Date(), backfillError: null },
    });

  const start = Date.now();
  const filterClause = opts?.filterClause ?? (await buildBackfillFilter(storeId));
  let bulkId = '';

  try {
    bulkId = await submitBackfillBulkQuery(storeId, filterClause);
    await db
      .update(schema.shopifySyncState)
      .set({ backfillCursor: bulkId })
      .where(eq(schema.shopifySyncState.storeId, storeId));

    let url: string | null = null;
    while (true) {
      if (Date.now() - start > WATCHDOG_MS) {
        throw new Error('bulk operation stuck > 2h, abort');
      }
      const s = await pollBulkOperation(storeId);
      if (!s) throw new Error('no bulk operation in flight');
      if (s.status === 'FAILED' || s.status === 'CANCELLED' || s.status === 'EXPIRED') {
        throw new Error(`bulk operation ${s.status} (${s.errorCode ?? 'unknown'})`);
      }
      if (s.status === 'COMPLETED') { url = s.url; break; }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    if (!url) throw new Error('bulk completed without url');

    let ingested = 0;
    await streamBulkResult(url, async (orders) => {
      for (const o of orders) {
        await upsertOrder(storeId, o, 'backfill');
        ingested++;
      }
    });

    await db
      .update(schema.shopifySyncState)
      .set({ backfillStatus: 'done', backfillFinishedAt: new Date() })
      .where(eq(schema.shopifySyncState.storeId, storeId));

    return { storeId, ordersIngested: ingested, bulkOperationId: bulkId, durationMs: Date.now() - start, filterClause };
  } catch (err) {
    await db
      .update(schema.shopifySyncState)
      .set({
        backfillStatus: 'failed',
        backfillFinishedAt: new Date(),
        backfillError: err instanceof Error ? err.message : String(err),
      })
      .where(eq(schema.shopifySyncState.storeId, storeId));
    throw err;
  }
}
