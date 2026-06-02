/**
 * Cross-store aggregation queries. Powers the "everywhere" views
 * surfaced from each function's parent toggle page — same data the
 * per-store pages show, but joined across every store where the
 * function is active.
 *
 * One source-of-truth keyed by function key so adding a new function
 * means appending one entry to FUNCTION_EVENT_SOURCES below.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

export interface StoreActivityRow {
  storeId: string;
  storeName: string;
  shopDomain: string;
  enabled: boolean;
  /** Lifetime event count for this function on this store. */
  totalEvents: number;
  /** Events in the last 7 days. */
  events7d: number;
  /** Last event timestamp on this store, null if none. */
  lastEventAt: Date | null;
}

/** Allow-list of (table, timestamp column) tuples per function key.
 *  Identifiers go through sql.raw — never user input. */
const FUNCTION_EVENT_SOURCES: Record<string, { table: string; tsColumn: string }> = {
  wishlist:         { table: 'wishlist_events',         tsColumn: 'created_at' },
  'recently-viewed': { table: 'recently_viewed_events', tsColumn: 'viewed_at'  },
  'save-for-later':  { table: 'save_for_later_items',   tsColumn: 'saved_at'   },
  // gift-registry is a UNION of three tables; handled inline below.
};

type Row = {
  store_id: string;
  store_name: string;
  shop_domain: string;
  enabled: boolean | null;
  total_events: string;
  events_7d: string;
  last_event_at: Date | null;
};

/** Returns one row per connected store, with activity counters for the
 *  given function. Stores where the function has never been enabled
 *  AND has zero events drop out — the dashboard only wants to render
 *  rows the operator can act on. */
export async function getCrossStoreActivity(
  functionKey: string,
): Promise<StoreActivityRow[]> {
  const eventsCte = buildEventsCte(functionKey);
  if (!eventsCte) return [];
  const rows = await db.execute<Row>(sql`
    WITH events AS (${eventsCte}),
    activity AS (
      SELECT store_id,
             COUNT(*)::text AS total_events,
             SUM(CASE WHEN ts > NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END)::text AS events_7d,
             MAX(ts) AS last_event_at
        FROM events
       GROUP BY store_id
    )
    SELECT s.id           AS store_id,
           s.name         AS store_name,
           s.shop_domain,
           sfs.enabled,
           COALESCE(a.total_events, '0')::text AS total_events,
           COALESCE(a.events_7d, '0')::text    AS events_7d,
           a.last_event_at
      FROM stores s
      LEFT JOIN store_function_settings sfs
        ON sfs.store_id = s.id
       AND sfs.function_key = ${functionKey}
      LEFT JOIN activity a ON a.store_id = s.id
     WHERE COALESCE(sfs.enabled, false) = true
        OR a.total_events IS NOT NULL
     ORDER BY a.last_event_at DESC NULLS LAST, s.name;
  `);
  return rows.rows.map((r) => ({
    storeId: r.store_id,
    storeName: r.store_name,
    shopDomain: r.shop_domain,
    enabled: r.enabled ?? false,
    totalEvents: Number(r.total_events),
    events7d: Number(r.events_7d),
    lastEventAt: r.last_event_at,
  }));
}

/** Returns the SQL fragment that, when used as a CTE body, yields
 *  rows of (store_id, ts) for the function's event source. */
function buildEventsCte(functionKey: string): ReturnType<typeof sql> | null {
  if (functionKey === 'gift-registry') {
    return sql`
      SELECT r.store_id AS store_id, r.created_at AS ts
        FROM gift_registries r
      UNION ALL
      SELECT r.store_id, i.added_at
        FROM gift_registry_items i
        JOIN gift_registries r ON r.id = i.registry_id
      UNION ALL
      SELECT r.store_id, res.created_at
        FROM gift_registry_reservations res
        JOIN gift_registries r ON r.id = res.registry_id
    `;
  }
  const cfg = FUNCTION_EVENT_SOURCES[functionKey];
  if (!cfg) return null;
  // `cfg.table` and `cfg.tsColumn` come from the hard-coded allow-list
  // above — safe to inline via sql.raw.
  return sql`
    SELECT ${sql.raw(cfg.tsColumn === 'created_at' ? 'store_id' : 'store_id')} AS store_id,
           ${sql.raw(cfg.tsColumn)} AS ts
      FROM ${sql.raw(cfg.table)}
  `;
}

export interface CrossStoreRollup {
  storeCount: number;
  activeStoreCount: number;
  totalEvents: number;
  totalEvents7d: number;
}

export function rollupCrossStore(rows: StoreActivityRow[]): CrossStoreRollup {
  let active = 0, total = 0, last7 = 0;
  for (const r of rows) {
    if (r.enabled) active += 1;
    total += r.totalEvents;
    last7 += r.events7d;
  }
  return {
    storeCount: rows.length,
    activeStoreCount: active,
    totalEvents: total,
    totalEvents7d: last7,
  };
}
