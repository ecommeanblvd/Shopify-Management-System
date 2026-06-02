'use server';

import { and, eq, sql } from 'drizzle-orm';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';

export interface GiftRegistryStoreStatus {
  storeId: string;
  shopDomain: string;
  storeName: string;
  enabled: boolean;
  updatedAt: Date | null;
}

export async function listGiftRegistryStatusPerStore(): Promise<GiftRegistryStoreStatus[]> {
  const rows = await db.execute<{
    id: string; shop_domain: string; name: string;
    enabled: boolean | null; updated_at: Date | null;
  }>(sql`
    SELECT s.id, s.shop_domain, s.name,
           sfs.enabled,
           sfs.updated_at
      FROM stores s
      LEFT JOIN store_function_settings sfs
        ON sfs.store_id = s.id AND sfs.function_key = 'gift-registry'
     ORDER BY s.name;
  `);
  return rows.rows.map((r) => ({
    storeId: r.id,
    shopDomain: r.shop_domain,
    storeName: r.name,
    enabled: r.enabled ?? false,
    updatedAt: r.updated_at,
  }));
}

export async function setGiftRegistryEnabled(
  storeId: string, enabled: boolean,
): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('unauthenticated');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_functions')) {
    throw new Error('forbidden');
  }
  await db
    .insert(schema.storeFunctionSettings)
    .values({
      storeId,
      functionKey: 'gift-registry',
      enabled,
      updatedBy: session.user.id,
    })
    .onConflictDoUpdate({
      target: [schema.storeFunctionSettings.storeId, schema.storeFunctionSettings.functionKey],
      set: { enabled, updatedBy: session.user.id, updatedAt: new Date() },
    });
  revalidatePath('/f/functions/gift-registry');
  revalidatePath('/f/functions');
}

export interface GiftRegistrySummary {
  registryCount: number;
  itemCount: number;
  reservationCount: number;
  upcomingCount: number;
}

export async function getGiftRegistrySummary(storeId: string): Promise<GiftRegistrySummary> {
  const rows = await db.execute<{
    registry_count: string; item_count: string;
    reservation_count: string; upcoming_count: string;
  }>(sql`
    WITH r AS (SELECT id, event_date FROM gift_registries WHERE store_id = ${storeId})
    SELECT
      (SELECT COUNT(*)::text FROM r)                                          AS registry_count,
      (SELECT COUNT(*)::text FROM gift_registry_items WHERE registry_id IN (SELECT id FROM r)) AS item_count,
      (SELECT COUNT(*)::text FROM gift_registry_reservations
        WHERE registry_id IN (SELECT id FROM r) AND status <> 'cancelled')    AS reservation_count,
      (SELECT COUNT(*)::text FROM r WHERE event_date IS NOT NULL AND event_date >= CURRENT_DATE) AS upcoming_count;
  `);
  const r = rows.rows[0];
  return {
    registryCount: Number(r?.registry_count ?? '0'),
    itemCount: Number(r?.item_count ?? '0'),
    reservationCount: Number(r?.reservation_count ?? '0'),
    upcomingCount: Number(r?.upcoming_count ?? '0'),
  };
}

export interface RegistryListRow {
  id: string;
  shareToken: string;
  ownerEmail: string;
  ownerName: string | null;
  eventName: string;
  eventDate: string | null;
  itemCount: number;
  reservationCount: number;
}

export async function listRegistriesForStore(
  storeId: string, limit = 50,
): Promise<RegistryListRow[]> {
  const rows = await db.execute<{
    id: string; share_token: string;
    owner_email: string; owner_name: string | null;
    event_name: string; event_date: string | null;
    item_count: string; reservation_count: string;
  }>(sql`
    SELECT r.id, r.share_token, r.owner_email, r.owner_name,
           r.event_name, r.event_date::text,
           COALESCE(i.cnt, 0)::text AS item_count,
           COALESCE(s.cnt, 0)::text AS reservation_count
      FROM gift_registries r
      LEFT JOIN (
        SELECT registry_id, COUNT(*) AS cnt FROM gift_registry_items GROUP BY registry_id
      ) i ON i.registry_id = r.id
      LEFT JOIN (
        SELECT registry_id, COUNT(*) AS cnt FROM gift_registry_reservations
         WHERE status <> 'cancelled' GROUP BY registry_id
      ) s ON s.registry_id = r.id
     WHERE r.store_id = ${storeId}
     ORDER BY r.created_at DESC
     LIMIT ${limit};
  `);
  return rows.rows.map((r) => ({
    id: r.id,
    shareToken: r.share_token,
    ownerEmail: r.owner_email,
    ownerName: r.owner_name,
    eventName: r.event_name,
    eventDate: r.event_date,
    itemCount: Number(r.item_count),
    reservationCount: Number(r.reservation_count),
  }));
}

export interface GiftRegistryEventBucket {
  eventType: 'registry_created' | 'item_added' | 'reservation_made' | 'reservation_cancelled';
  count: number;
}

/** Synthesises an event-type breakdown for the last N days from the
 *  three tables — there's no dedicated events log for gift-registry,
 *  so we run one count per source and stitch them together. The
 *  output keeps every bucket (even zero-count ones) so the chart
 *  legend stays stable. */
export async function getGiftRegistryEventBreakdown(
  storeId: string, days = 7,
): Promise<GiftRegistryEventBucket[]> {
  const rows = await db.execute<{
    registries_created: string; items_added: string;
    reservations_made: string; reservations_cancelled: string;
  }>(sql`
    WITH r AS (SELECT id FROM gift_registries WHERE store_id = ${storeId})
    SELECT
      (SELECT COUNT(*) FROM gift_registries
        WHERE store_id = ${storeId}
          AND created_at > NOW() - (${days}::int * INTERVAL '1 day'))::text AS registries_created,
      (SELECT COUNT(*) FROM gift_registry_items
        WHERE registry_id IN (SELECT id FROM r)
          AND added_at > NOW() - (${days}::int * INTERVAL '1 day'))::text AS items_added,
      (SELECT COUNT(*) FROM gift_registry_reservations
        WHERE registry_id IN (SELECT id FROM r)
          AND created_at > NOW() - (${days}::int * INTERVAL '1 day')
          AND status <> 'cancelled')::text AS reservations_made,
      (SELECT COUNT(*) FROM gift_registry_reservations
        WHERE registry_id IN (SELECT id FROM r)
          AND updated_at > NOW() - (${days}::int * INTERVAL '1 day')
          AND status = 'cancelled')::text AS reservations_cancelled;
  `);
  const r = rows.rows[0];
  return [
    { eventType: 'registry_created', count: Number(r?.registries_created ?? '0') },
    { eventType: 'item_added', count: Number(r?.items_added ?? '0') },
    { eventType: 'reservation_made', count: Number(r?.reservations_made ?? '0') },
    { eventType: 'reservation_cancelled', count: Number(r?.reservations_cancelled ?? '0') },
  ];
}

// Re-exports kept available for future cron jobs.
void and;
void eq;
