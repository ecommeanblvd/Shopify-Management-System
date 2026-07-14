'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { runBackfillForStore } from './run-backfill';

/**
 * Kick off a full-history order backfill for a store from a UI button. Pulls
 * every order Shopify will return (requires the `read_all_orders` scope for
 * data older than 60 days), skipping orders already synced by asking Shopify
 * for only those older than the oldest order already in the DB — see
 * runBackfillForStore / buildBackfillFilter.
 *
 * Fire-and-forget: runBackfillForStore() polls Shopify's bulk operation
 * with 30s intervals and a 2-hour watchdog — far too long for an HTTP
 * server-action response. We mark the sync state as 'running' immediately
 * (so the UI flips), spawn the actual work on the Node event loop without
 * awaiting it, and return. The function persists progress + final status
 * to `shopify_sync_state`, which the health card / admin page both read.
 *
 * On Railway this works because the main app service is a long-lived
 * Node process, not a per-request serverless function. The promise keeps
 * running after the response goes out.
 *
 * Idempotent: if backfill is already running, returns without re-spawning.
 */
export async function startBackfill(storeId: string): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('unauthenticated');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_stores')) throw new Error('forbidden');

  // Refuse to re-spawn while one is in flight.
  const [state] = await db
    .select({ status: schema.shopifySyncState.backfillStatus })
    .from(schema.shopifySyncState)
    .where(eq(schema.shopifySyncState.storeId, storeId));
  if (state?.status === 'running') {
    return;
  }

  void runBackfillForStore(storeId).catch((err) => {
    // The function itself records 'failed' status + the error message in
    // sync state, so this catch is just to prevent an unhandled rejection
    // from crashing the Node process.
    // eslint-disable-next-line no-console
    console.error(`[backfill] store=${storeId} fatal:`, err);
  });

  revalidatePath('/admin/shopify-sync-health');
  revalidatePath(`/f/orders/${storeId}`);
}
