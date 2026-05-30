import { eq } from 'drizzle-orm';
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
}

export async function runBackfillForStore(storeId: string): Promise<BackfillResult> {
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
  const since = new Date(start - 365 * 24 * 60 * 60 * 1000).toISOString();
  let bulkId = '';

  try {
    bulkId = await submitBackfillBulkQuery(storeId, since);
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

    return { storeId, ordersIngested: ingested, bulkOperationId: bulkId, durationMs: Date.now() - start };
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
