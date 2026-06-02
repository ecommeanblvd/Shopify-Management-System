/**
 * Shared "last N days, bucketed by UTC day" trend helper. The
 * Recently Viewed and Save for later pages both want the same shape;
 * keep the SQL parametrized so a future function can reuse it.
 *
 * The output always contains exactly `days` buckets in chronological
 * order — empty days return count=0 so the chart spaces them correctly.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

export interface DailyTrendBucket {
  day: string; // YYYY-MM-DD UTC
  count: number;
}

type Row = { day: string; n: string };

/** Allow-list of (table, column) combos so the SQL can't be tricked
 *  into reading from outside the functions module. The callsite passes
 *  one of these keys, never raw input. */
const SOURCES: Record<string, { table: string; column: string; storeColumn: string }> = {
  recently_viewed: {
    table: 'recently_viewed_events',
    column: 'viewed_at',
    storeColumn: 'store_id',
  },
  save_for_later: {
    table: 'save_for_later_items',
    column: 'saved_at',
    storeColumn: 'store_id',
  },
};

export async function getDailyTrend(
  source: keyof typeof SOURCES,
  storeId: string,
  days = 7,
): Promise<DailyTrendBucket[]> {
  const cfg = SOURCES[source];
  // `cfg.table`, `cfg.column`, `cfg.storeColumn` are all from the
  // allow-list above, never user input — safe to interpolate as
  // identifiers via sql.raw.
  const rows = await db.execute<Row>(sql`
    WITH d AS (
      SELECT generate_series(
        DATE_TRUNC('day', NOW() - (${days - 1}::int * INTERVAL '1 day')),
        DATE_TRUNC('day', NOW()),
        INTERVAL '1 day'
      )::date AS day
    )
    SELECT TO_CHAR(d.day, 'YYYY-MM-DD') AS day,
           COALESCE(COUNT(t.${sql.raw(cfg.column)}), 0)::text AS n
      FROM d
      LEFT JOIN ${sql.raw(cfg.table)} t
        ON DATE_TRUNC('day', t.${sql.raw(cfg.column)}) = d.day
       AND t.${sql.raw(cfg.storeColumn)} = ${storeId}
     GROUP BY d.day
     ORDER BY d.day;
  `);
  return rows.rows.map((r) => ({ day: r.day, count: Number(r.n) }));
}
