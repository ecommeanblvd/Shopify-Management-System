/**
 * Cross-function activity stats for the Functions overview dashboard.
 *
 * Returns one row per function key with:
 *   - activeStoreCount — stores where the function is enabled
 *   - last7DaysEvents — newly-created items / events in the last 7 days
 *
 * Each function gets its own count query against its own table — kept
 * separate (rather than a giant UNION) so a new function only has to
 * append a probe here, not touch existing ones.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

export interface FunctionActivity {
  key: string;
  activeStoreCount: number;
  last7DaysEvents: number;
}

type ActiveRow = { function_key: string; n: string };
type CountRow = { n: string };

/** Returns a map keyed by function key. Calling code looks up by
 *  manifest key; absent rows default to zero in the consumer. */
export async function getAllFunctionsActivity(): Promise<Map<string, FunctionActivity>> {
  const [activeRows, wishlistEvents, recentlyViewedEvents, giftRegistryEvents, saveForLaterEvents] = await Promise.all([
    db.execute<ActiveRow>(sql`
      SELECT function_key, COUNT(*)::text AS n
        FROM store_function_settings
       WHERE enabled = true
       GROUP BY function_key;
    `),
    db.execute<CountRow>(sql`
      SELECT COUNT(*)::text AS n
        FROM wishlist_events
       WHERE created_at > NOW() - INTERVAL '7 days';
    `),
    db.execute<CountRow>(sql`
      SELECT COUNT(*)::text AS n
        FROM recently_viewed_events
       WHERE viewed_at > NOW() - INTERVAL '7 days';
    `),
    db.execute<CountRow>(sql`
      SELECT
        (SELECT COUNT(*) FROM gift_registries WHERE created_at > NOW() - INTERVAL '7 days') +
        (SELECT COUNT(*) FROM gift_registry_items WHERE added_at > NOW() - INTERVAL '7 days') +
        (SELECT COUNT(*) FROM gift_registry_reservations
          WHERE created_at > NOW() - INTERVAL '7 days' AND status <> 'cancelled')
        AS n;
    `),
    db.execute<CountRow>(sql`
      SELECT COUNT(*)::text AS n
        FROM save_for_later_items
       WHERE saved_at > NOW() - INTERVAL '7 days';
    `),
  ]);

  const active = new Map<string, number>();
  for (const r of activeRows.rows) active.set(r.function_key, Number(r.n));

  const byKey: Record<string, number> = {
    wishlist: Number(wishlistEvents.rows[0]?.n ?? '0'),
    'recently-viewed': Number(recentlyViewedEvents.rows[0]?.n ?? '0'),
    'gift-registry': Number(giftRegistryEvents.rows[0]?.n ?? '0'),
    'save-for-later': Number(saveForLaterEvents.rows[0]?.n ?? '0'),
  };

  const out = new Map<string, FunctionActivity>();
  for (const key of Object.keys(byKey)) {
    out.set(key, {
      key,
      activeStoreCount: active.get(key) ?? 0,
      last7DaysEvents: byKey[key]!,
    });
  }
  return out;
}

export interface TotalsAcrossFunctions {
  totalActivations: number;
  totalEvents7d: number;
  busiestFunctionKey: string | null;
}

export function rollup(stats: Map<string, FunctionActivity>): TotalsAcrossFunctions {
  let totalActivations = 0;
  let totalEvents = 0;
  let topKey: string | null = null;
  let topEvents = 0;
  for (const v of stats.values()) {
    totalActivations += v.activeStoreCount;
    totalEvents += v.last7DaysEvents;
    if (v.last7DaysEvents > topEvents) {
      topEvents = v.last7DaysEvents;
      topKey = v.key;
    }
  }
  return {
    totalActivations,
    totalEvents7d: totalEvents,
    busiestFunctionKey: topKey,
  };
}
