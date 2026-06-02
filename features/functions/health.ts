/**
 * Function health monitor.
 *
 * Surfaces (store × function) pairs that are toggled ON but haven't
 * recorded an event recently — the classic "operator pasted the
 * script tag in the wrong theme" or "theme update overwrote it"
 * failure mode. The dashboard would otherwise show zero activity
 * forever without flagging it.
 *
 * Classification (single source of truth — pure function, easy to test):
 *   - never:   enabled, but the function has zero events for this store
 *   - silent:  enabled, last event > 14 days ago
 *   - quiet:   enabled, last event 7-14 days ago
 *   - healthy: enabled, event in the last 7 days
 *
 * Quiet is the "warning" tier — possibly normal for a low-traffic
 * store, but worth surfacing so the operator can check.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

export type HealthStatus = 'healthy' | 'quiet' | 'silent' | 'never';

export interface ClassifiedHealth {
  status: HealthStatus;
  daysSilent: number | null;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const HEALTHY_THRESHOLD_DAYS = 7;
const QUIET_THRESHOLD_DAYS = 14;

/** Pure classification, broken out so unit tests don't need a DB. */
export function classifyHealth(
  lastEventAt: Date | null, now: Date = new Date(),
): ClassifiedHealth {
  if (!lastEventAt) return { status: 'never', daysSilent: null };
  const diffMs = now.getTime() - lastEventAt.getTime();
  const days = Math.max(0, Math.floor(diffMs / MS_PER_DAY));
  if (days < HEALTHY_THRESHOLD_DAYS) return { status: 'healthy', daysSilent: days };
  if (days < QUIET_THRESHOLD_DAYS) return { status: 'quiet', daysSilent: days };
  return { status: 'silent', daysSilent: days };
}

export interface FunctionHealthRow {
  functionKey: string;
  storeId: string;
  storeName: string;
  shopDomain: string;
  lastEventAt: Date | null;
  status: HealthStatus;
  daysSilent: number | null;
}

type DbRow = {
  function_key: string;
  store_id: string;
  store_name: string;
  shop_domain: string;
  last_event_at: Date | null;
};

/** Runs one big UNION across the 4 function sources, joins with the
 *  enabled flag in store_function_settings, classifies each row. */
export async function getFunctionHealth(): Promise<FunctionHealthRow[]> {
  const result = await db.execute<DbRow>(sql`
    WITH events AS (
      SELECT 'wishlist'::text AS function_key,
             store_id, MAX(created_at) AS last_event_at
        FROM wishlist_events GROUP BY store_id
      UNION ALL
      SELECT 'recently-viewed'::text,
             store_id, MAX(viewed_at)
        FROM recently_viewed_events GROUP BY store_id
      UNION ALL
      SELECT 'save-for-later'::text,
             store_id, MAX(saved_at)
        FROM save_for_later_items GROUP BY store_id
      UNION ALL
      SELECT 'gift-registry'::text,
             r.store_id,
             GREATEST(
               COALESCE(MAX(r.created_at), to_timestamp(0)),
               COALESCE(MAX(i.added_at), to_timestamp(0)),
               COALESCE(MAX(res.created_at), to_timestamp(0))
             ) AS last_event_at
        FROM gift_registries r
        LEFT JOIN gift_registry_items i ON i.registry_id = r.id
        LEFT JOIN gift_registry_reservations res ON res.registry_id = r.id
        GROUP BY r.store_id
    )
    SELECT sfs.function_key,
           sfs.store_id, s.name AS store_name, s.shop_domain,
           e.last_event_at
      FROM store_function_settings sfs
      JOIN stores s ON s.id = sfs.store_id
      LEFT JOIN events e
        ON e.function_key = sfs.function_key
       AND e.store_id    = sfs.store_id
     WHERE sfs.enabled = true
     ORDER BY sfs.function_key, s.name;
  `);
  const now = new Date();
  return result.rows.map((r) => {
    const { status, daysSilent } = classifyHealth(r.last_event_at, now);
    return {
      functionKey: r.function_key,
      storeId: r.store_id,
      storeName: r.store_name,
      shopDomain: r.shop_domain,
      lastEventAt: r.last_event_at,
      status,
      daysSilent,
    };
  });
}

export interface HealthRollup {
  total: number;
  healthy: number;
  quiet: number;
  silent: number;
  never: number;
  needsAttention: number;
}

/** Counts per status. `needsAttention` = silent + never (the ones
 *  worth a dashboard warning); `quiet` is informational. */
export function rollupHealth(rows: FunctionHealthRow[]): HealthRollup {
  const r: HealthRollup = {
    total: rows.length,
    healthy: 0, quiet: 0, silent: 0, never: 0,
    needsAttention: 0,
  };
  for (const row of rows) {
    r[row.status] += 1;
    if (row.status === 'silent' || row.status === 'never') r.needsAttention += 1;
  }
  return r;
}
