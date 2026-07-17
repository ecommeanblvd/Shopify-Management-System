/**
 * Queries cho Báo cáo ship (/f/ship-report): kéo raw items rồi giao cho pure fns
 * (pnl.ts / surcharges.ts) gộp. Mốc thời gian = ngày ship (label_created_at /
 * created_at ship hộ). Thu Shopify quy VND qua FX của store (fxCostPerOrderCurrency).
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import type { ShipPnlItem } from './pnl';
import type { SurchargeItem } from './surcharges';

export interface ShipReportRaw {
  pnlItems: ShipPnlItem[];
  surchargeItems: SurchargeItem[];
  totalShipments: number;
}

/** @param monthsBack số tháng gần nhất (tính cả tháng hiện tại). */
export async function loadShipReport(monthsBack: number): Promise<ShipReportRaw> {
  const since = sql`date_trunc('month', NOW()) - ${sql.raw(String(Math.max(0, monthsBack - 1)))} * INTERVAL '1 month'`;

  // ── Shopify shipments: thu = totalShipping × fx (1 nếu cùng currency), chi = billed ──
  const shopify = await db.execute(sql`
    SELECT
      to_char(s.label_created_at, 'YYYY-MM') AS month,
      s.carrier_key AS carrier,
      o.ship_country AS country,
      CASE WHEN o.currency = COALESCE(st.cost_currency, o.currency) THEN o.total_shipping::float8
           WHEN st.fx_cost_per_order_currency IS NOT NULL THEN o.total_shipping::float8 * st.fx_cost_per_order_currency::float8
           ELSE NULL END AS revenue_vnd,
      sc.total_amount::float8 AS cost_vnd
    FROM shipments s
    JOIN shopify_orders o ON o.id = s.order_id
    JOIN stores st ON st.id = o.store_id
    LEFT JOIN shipment_charges sc ON sc.shipment_id = s.id
    WHERE s.label_created_at >= ${since}
  `);

  // ── Ship hộ: thu = actualCharged ?? charged; chi = actualCost ?? cost dự tính ──
  const shipHo = await db.execute(sql`
    SELECT
      to_char(created_at, 'YYYY-MM') AS month,
      carrier_key AS carrier,
      country,
      COALESCE(actual_charged_vnd, charged_vnd)::float8 AS revenue_vnd,
      COALESCE(actual_carrier_cost_vnd, carrier_cost_vnd)::float8 AS cost_vnd,
      (reconcile_status = 'reconciled') AS billed
    FROM ship_ho_orders
    WHERE created_at >= ${since} AND status::text NOT IN ('draft', 'cancelled')
  `);

  const pnlItems: ShipPnlItem[] = [
    ...shopify.rows.map((r: Record<string, unknown>) => ({
      month: String(r.month),
      segment: 'shopify' as const,
      carrierKey: (r.carrier as string | null) ?? 'fedex',
      country: r.country as string | null,
      revenueVnd: r.revenue_vnd == null ? null : Math.round(Number(r.revenue_vnd)),
      costVnd: r.cost_vnd == null ? null : Math.round(Number(r.cost_vnd)),
      billed: r.cost_vnd != null,
    })),
    ...shipHo.rows.map((r: Record<string, unknown>) => ({
      month: String(r.month),
      segment: 'ship_ho' as const,
      carrierKey: (r.carrier as string | null) ?? 'fedex',
      country: r.country as string | null,
      revenueVnd: r.revenue_vnd == null ? null : Math.round(Number(r.revenue_vnd)),
      costVnd: r.cost_vnd == null ? null : Math.round(Number(r.cost_vnd)),
      billed: Boolean(r.billed),
    })),
  ];

  // ── Phụ phí: shipment_charges (Shopify, unpivot cột) + carrier_bill_lines (ship hộ) ──
  const sur = await db.execute(sql`
    SELECT to_char(s.label_created_at, 'YYYY-MM') AS month, s.carrier_key AS carrier, o.ship_country AS country,
           k.type, k.amount::float8 AS amount
    FROM shipments s
    JOIN shopify_orders o ON o.id = s.order_id
    JOIN shipment_charges sc ON sc.shipment_id = s.id
    CROSS JOIN LATERAL (VALUES
      ('residential', sc.residential), ('directSignature', sc.direct_signature),
      ('remote', sc.remote), ('demand', sc.demand),
      ('addressCorrection', sc.address_correction), ('importHandling', sc.import_handling),
      ('elevatedRisk', sc.elevated_risk), ('gogreen', sc.gogreen)
    ) AS k(type, amount)
    WHERE s.label_created_at >= ${since} AND k.amount IS NOT NULL AND k.amount::float8 > 0
  `);
  const surHo = await db.execute(sql`
    SELECT to_char(sh.created_at, 'YYYY-MM') AS month, sh.carrier_key AS carrier, sh.country,
           k.type, k.amount::float8 AS amount
    FROM ship_ho_orders sh
    JOIN carrier_bill_lines bl ON bl.tracking_number = sh.tracking_number
    CROSS JOIN LATERAL (VALUES
      ('remote', bl.remote), ('demand', bl.demand),
      ('residential', bl.signature), ('importHandling', bl.other)
    ) AS k(type, amount)
    WHERE sh.created_at >= ${since} AND k.amount IS NOT NULL AND k.amount::float8 > 0
  `);

  const mapSur = (r: Record<string, unknown>): SurchargeItem => ({
    month: String(r.month),
    carrierKey: (r.carrier as string | null) ?? 'fedex',
    country: r.country as string | null,
    type: String(r.type),
    amountVnd: Number(r.amount),
  });

  return {
    pnlItems,
    surchargeItems: [...sur.rows.map(mapSur), ...surHo.rows.map(mapSur)],
    totalShipments: pnlItems.length,
  };
}
