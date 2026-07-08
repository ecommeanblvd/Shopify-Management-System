/**
 * Thống kê thời gian vận chuyển (transit) cho Dashboard: trung bình số ngày từ
 * lúc tạo vận đơn → giao thành công, theo carrier × quốc gia đích, lọc theo
 * cửa sổ thời gian GIAO (delivered_at trong N ngày gần nhất).
 *
 * Nguồn ngày giao: shipments.delivered_at (Lark ops + carrier API khi có).
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

export const TRANSIT_RANGE_DAYS = [7, 14, 30, 90] as const;
export type TransitRangeDays = (typeof TRANSIT_RANGE_DAYS)[number];

export function normalizeTransitRange(raw: string | undefined): TransitRangeDays {
  const n = Number(raw);
  return (TRANSIT_RANGE_DAYS as readonly number[]).includes(n) ? (n as TransitRangeDays) : 14;
}

export interface TransitRouteStat {
  carrierKey: string;
  country: string;
  n: number;
  avgDays: number;
  minDays: number;
  maxDays: number;
}

export interface TransitCarrierStat {
  carrierKey: string;
  n: number;
  avgDays: number;
  medianDays: number;
  /** Kiện tạo vận đơn trong cửa sổ nhưng CHƯA ghi nhận giao. */
  pendingN: number;
}

export interface TransitStats {
  routes: TransitRouteStat[];
  carriers: TransitCarrierStat[];
  /** Ngày giao mới nhất có trong dữ liệu — để lộ độ trễ nguồn (Lark ops nhập tay). */
  latestDeliveryAt: string | null;
}

type RouteRow = { carrier_key: string | null; country: string | null; n: string; avg_days: string; min_days: string; max_days: string };
type CarrierRow = { carrier_key: string | null; n: string; avg_days: string; median_days: string };
type PendingRow = { carrier_key: string | null; n: string };
type LatestRow = { latest: string | null };

export async function getTransitStats(days: TransitRangeDays): Promise<TransitStats> {
  const [routes, carriers, pending, latest] = await Promise.all([
    db.execute<RouteRow>(sql`
      SELECT s.carrier_key, COALESCE(o.ship_country, '?') AS country,
        COUNT(*)::text AS n,
        ROUND((AVG(EXTRACT(EPOCH FROM (s.delivered_at::timestamp - s.label_created_at)) / 86400))::numeric, 1)::text AS avg_days,
        ROUND((MIN(EXTRACT(EPOCH FROM (s.delivered_at::timestamp - s.label_created_at)) / 86400))::numeric, 1)::text AS min_days,
        ROUND((MAX(EXTRACT(EPOCH FROM (s.delivered_at::timestamp - s.label_created_at)) / 86400))::numeric, 1)::text AS max_days
      FROM shipments s
      JOIN shopify_orders o ON o.id = s.order_id
      WHERE s.delivered_at IS NOT NULL AND s.label_created_at IS NOT NULL
        AND s.delivered_at >= NOW() - (${days}::int * INTERVAL '1 day')
        -- Loại dữ liệu bẩn: ngày giao (ops nhập tay) sớm hơn ngày tạo vận đơn.
        AND s.delivered_at::timestamp >= s.label_created_at
      GROUP BY 1, 2
      ORDER BY COUNT(*) DESC, 1, 2;
    `),
    db.execute<CarrierRow>(sql`
      SELECT s.carrier_key,
        COUNT(*)::text AS n,
        ROUND((AVG(EXTRACT(EPOCH FROM (s.delivered_at::timestamp - s.label_created_at)) / 86400))::numeric, 1)::text AS avg_days,
        ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (s.delivered_at::timestamp - s.label_created_at)) / 86400))::numeric, 1)::text AS median_days
      FROM shipments s
      WHERE s.delivered_at IS NOT NULL AND s.label_created_at IS NOT NULL
        AND s.delivered_at >= NOW() - (${days}::int * INTERVAL '1 day')
        AND s.delivered_at::timestamp >= s.label_created_at
      GROUP BY 1;
    `),
    db.execute<PendingRow>(sql`
      SELECT s.carrier_key, COUNT(*)::text AS n
      FROM shipments s
      WHERE s.tracking_number IS NOT NULL AND s.delivered_at IS NULL
        AND s.label_created_at >= NOW() - (${days}::int * INTERVAL '1 day')
      GROUP BY 1;
    `),
    db.execute<LatestRow>(sql`SELECT MAX(delivered_at)::text AS latest FROM shipments;`),
  ]);

  const pendingByCarrier = new Map<string, number>();
  for (const p of pending.rows) pendingByCarrier.set(p.carrier_key ?? '?', Number(p.n));

  return {
    routes: routes.rows.map((r) => ({
      carrierKey: r.carrier_key ?? '?', country: r.country ?? '?',
      n: Number(r.n), avgDays: Number(r.avg_days), minDays: Number(r.min_days), maxDays: Number(r.max_days),
    })),
    carriers: carriers.rows.map((r) => ({
      carrierKey: r.carrier_key ?? '?',
      n: Number(r.n), avgDays: Number(r.avg_days), medianDays: Number(r.median_days),
      pendingN: pendingByCarrier.get(r.carrier_key ?? '?') ?? 0,
    })),
    latestDeliveryAt: latest.rows[0]?.latest ?? null,
  };
}
