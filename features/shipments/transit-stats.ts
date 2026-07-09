/**
 * Thống kê thời gian vận chuyển (transit) cho Dashboard: theo dõi HÀNG ĐI trong
 * N ngày gần nhất (lọc theo ngày TẠO VẬN ĐƠN — đúng nghĩa "line ship chạy trong
 * window"), thống kê avg/min/max trên tập kiện đã ghi nhận giao. Kiện gửi từ
 * trước window (vd đuôi delay mùa lễ) KHÔNG lọt vào.
 *
 * Nguồn ngày giao: shipments.delivered_at (Lark ops + carrier API khi có) — có
 * thể trễ; expose deliveredN/shippedN + latestDeliveryAt để người xem tự cân nhắc.
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
  /** Kiện tạo vận đơn trong window. */
  shippedN: number;
  /** Trong đó đã ghi nhận giao (có delivered_at hợp lệ). */
  deliveredN: number;
  avgDays: number | null;
  minDays: number | null;
  maxDays: number | null;
}

export interface TransitCarrierStat {
  carrierKey: string;
  shippedN: number;
  deliveredN: number;
  avgDays: number | null;
  medianDays: number | null;
}

export interface TransitStats {
  routes: TransitRouteStat[];
  carriers: TransitCarrierStat[];
  /** Ngày giao mới nhất có trong dữ liệu — để lộ độ trễ nguồn (Lark ops nhập tay). */
  latestDeliveryAt: string | null;
}

// delivered hợp lệ: có ngày giao và không sớm hơn ngày tạo vận đơn (lọc noise nhập tay).
const OK = sql`s.delivered_at IS NOT NULL AND s.delivered_at::timestamp >= s.label_created_at`;
const DAYS = sql`EXTRACT(EPOCH FROM (s.delivered_at::timestamp - s.label_created_at)) / 86400`;

type RouteRow = { carrier_key: string | null; country: string | null; shipped: string; delivered: string; avg_days: string | null; min_days: string | null; max_days: string | null };
type CarrierRow = { carrier_key: string | null; shipped: string; delivered: string; avg_days: string | null; median_days: string | null };
type LatestRow = { latest: string | null };

const numOrNull = (s: string | null) => (s == null ? null : Number(s));

/** THUẦN: pivot routes → ma trận nước × carrier (avg ngày + n giao) để so sánh
 *  tốc độ giao giữa các carrier trên cùng tuyến. Chỉ gồm nước có ≥1 kiện giao. */
export interface TransitPivotRow {
  country: string;
  byCarrier: Record<string, { avgDays: number; deliveredN: number }>;
}
export function pivotRoutesByCountry(routes: TransitRouteStat[]): { carriers: string[]; rows: TransitPivotRow[] } {
  const carriers = [...new Set(routes.filter((r) => r.deliveredN > 0).map((r) => r.carrierKey))].sort();
  const byCountry = new Map<string, TransitPivotRow>();
  for (const r of routes) {
    if (r.deliveredN === 0 || r.avgDays == null) continue;
    let row = byCountry.get(r.country);
    if (!row) { row = { country: r.country, byCarrier: {} }; byCountry.set(r.country, row); }
    row.byCarrier[r.carrierKey] = { avgDays: r.avgDays, deliveredN: r.deliveredN };
  }
  // Sắp theo tổng kiện giao giảm dần — tuyến nhiều dữ liệu lên đầu.
  const rows = [...byCountry.values()].sort((a, b) =>
    Object.values(b.byCarrier).reduce((t, x) => t + x.deliveredN, 0)
    - Object.values(a.byCarrier).reduce((t, x) => t + x.deliveredN, 0));
  return { carriers, rows };
}

export async function getTransitStats(days: TransitRangeDays): Promise<TransitStats> {
  const [routes, carriers, latest] = await Promise.all([
    db.execute<RouteRow>(sql`
      SELECT s.carrier_key, COALESCE(o.ship_country, '?') AS country,
        COUNT(*)::text AS shipped,
        (COUNT(*) FILTER (WHERE ${OK}))::text AS delivered,
        ROUND((AVG(${DAYS}) FILTER (WHERE ${OK}))::numeric, 1)::text AS avg_days,
        ROUND((MIN(${DAYS}) FILTER (WHERE ${OK}))::numeric, 1)::text AS min_days,
        ROUND((MAX(${DAYS}) FILTER (WHERE ${OK}))::numeric, 1)::text AS max_days
      FROM shipments s
      JOIN shopify_orders o ON o.id = s.order_id
      WHERE s.tracking_number IS NOT NULL AND s.label_created_at IS NOT NULL
        AND s.label_created_at >= NOW() - (${days}::int * INTERVAL '1 day')
      GROUP BY 1, 2
      ORDER BY COUNT(*) DESC, 1, 2;
    `),
    db.execute<CarrierRow>(sql`
      SELECT s.carrier_key,
        COUNT(*)::text AS shipped,
        (COUNT(*) FILTER (WHERE ${OK}))::text AS delivered,
        ROUND((AVG(${DAYS}) FILTER (WHERE ${OK}))::numeric, 1)::text AS avg_days,
        ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY ${DAYS}) FILTER (WHERE ${OK}))::numeric, 1)::text AS median_days
      FROM shipments s
      WHERE s.tracking_number IS NOT NULL AND s.label_created_at IS NOT NULL
        AND s.label_created_at >= NOW() - (${days}::int * INTERVAL '1 day')
      GROUP BY 1;
    `),
    db.execute<LatestRow>(sql`SELECT MAX(delivered_at)::text AS latest FROM shipments;`),
  ]);

  return {
    routes: routes.rows.map((r) => ({
      carrierKey: r.carrier_key ?? '?', country: r.country ?? '?',
      shippedN: Number(r.shipped), deliveredN: Number(r.delivered),
      avgDays: numOrNull(r.avg_days), minDays: numOrNull(r.min_days), maxDays: numOrNull(r.max_days),
    })),
    carriers: carriers.rows.map((r) => ({
      carrierKey: r.carrier_key ?? '?',
      shippedN: Number(r.shipped), deliveredN: Number(r.delivered),
      avgDays: numOrNull(r.avg_days), medianDays: numOrNull(r.median_days),
    })),
    latestDeliveryAt: latest.rows[0]?.latest ?? null,
  };
}
