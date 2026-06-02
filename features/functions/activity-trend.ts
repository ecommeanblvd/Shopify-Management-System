/**
 * 7-day activity trend across all 4 functions, bucketed per UTC day.
 * Powers the stacked bar chart on /f/functions so the operator sees
 * at a glance which function is driving today's activity.
 *
 * Each function's "event" timestamp lives in a different table — see
 * the per-function CTE inside the query.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

export interface ActivityDayBucket {
  /** YYYY-MM-DD UTC. */
  day: string;
  /** Counts per function key. Every known key is present, zero-filled. */
  byFunction: Record<string, number>;
}

const KNOWN_KEYS = ['wishlist', 'recently-viewed', 'gift-registry', 'save-for-later'] as const;

type Row = { day: string; function_key: string; n: string };

export async function getActivityTrend(days = 7): Promise<ActivityDayBucket[]> {
  const result = await db.execute<Row>(sql`
    WITH days AS (
      SELECT generate_series(
        DATE_TRUNC('day', NOW() - (${days - 1}::int * INTERVAL '1 day')),
        DATE_TRUNC('day', NOW()),
        INTERVAL '1 day'
      )::date AS day
    ),
    fn AS (
      SELECT key FROM (VALUES
        ('wishlist'::text),
        ('recently-viewed'),
        ('gift-registry'),
        ('save-for-later')
      ) AS t(key)
    ),
    events AS (
      SELECT 'wishlist'::text AS function_key,
             DATE_TRUNC('day', created_at)::date AS day,
             COUNT(*) AS n
        FROM wishlist_events
       WHERE created_at > NOW() - (${days}::int * INTERVAL '1 day')
       GROUP BY DATE_TRUNC('day', created_at)::date
      UNION ALL
      SELECT 'recently-viewed', DATE_TRUNC('day', viewed_at)::date, COUNT(*)
        FROM recently_viewed_events
       WHERE viewed_at > NOW() - (${days}::int * INTERVAL '1 day')
       GROUP BY DATE_TRUNC('day', viewed_at)::date
      UNION ALL
      SELECT 'save-for-later', DATE_TRUNC('day', saved_at)::date, COUNT(*)
        FROM save_for_later_items
       WHERE saved_at > NOW() - (${days}::int * INTERVAL '1 day')
       GROUP BY DATE_TRUNC('day', saved_at)::date
      UNION ALL
      SELECT 'gift-registry', DATE_TRUNC('day', t.ts)::date, COUNT(*)
        FROM (
          SELECT created_at AS ts FROM gift_registries
           WHERE created_at > NOW() - (${days}::int * INTERVAL '1 day')
          UNION ALL
          SELECT added_at FROM gift_registry_items
           WHERE added_at > NOW() - (${days}::int * INTERVAL '1 day')
          UNION ALL
          SELECT created_at FROM gift_registry_reservations
           WHERE created_at > NOW() - (${days}::int * INTERVAL '1 day')
        ) t
       GROUP BY DATE_TRUNC('day', t.ts)::date
    )
    SELECT TO_CHAR(d.day, 'YYYY-MM-DD') AS day,
           fn.key                       AS function_key,
           COALESCE(e.n, 0)::text       AS n
      FROM days d
      CROSS JOIN fn
      LEFT JOIN events e
        ON e.day          = d.day
       AND e.function_key = fn.key
     ORDER BY d.day, fn.key;
  `);

  // Pivot rows into one bucket per day with a fully-populated map.
  const byDay = new Map<string, ActivityDayBucket>();
  for (const r of result.rows) {
    if (!byDay.has(r.day)) {
      const empty: Record<string, number> = {};
      for (const k of KNOWN_KEYS) empty[k] = 0;
      byDay.set(r.day, { day: r.day, byFunction: empty });
    }
    byDay.get(r.day)!.byFunction[r.function_key] = Number(r.n);
  }
  return Array.from(byDay.values());
}
