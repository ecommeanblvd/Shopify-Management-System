'use server';

import { and, eq, gte, lte, desc, sql } from 'drizzle-orm';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { resolveShippingEstimate } from './sync/resolve-shipping-estimate';

// ─────────────────────────────────────────────────────────────────────
// Listing orders (clickable rows on the dashboard)
// ─────────────────────────────────────────────────────────────────────

export interface OrderListRow {
  orderId: string;
  shopifyOrderNumber: string;
  processedAt: Date;
  currency: string;
  lineCount: number;
  gmv: number;                    // Σ(unit_price × qty), pre any discount
  refundedAmount: number;
  hasOverrides: boolean;          // cost or shipping override exists
}

export async function listStoreOrders(args: {
  storeId: string;
  dateFrom: Date;
  dateTo: Date;
  limit?: number;
}): Promise<OrderListRow[]> {
  const limit = args.limit ?? 100;
  const rowsRes = await db.execute<{
    order_id: string;
    shopify_order_number: string;
    processed_at_shopify: Date | string;
    currency: string;
    line_count: string;
    gmv: string;
    refunded_amount: string;
    has_overrides: boolean;
  }>(sql`
    SELECT
      o.id AS order_id,
      o.shopify_order_number,
      o.processed_at_shopify,
      o.currency,
      COUNT(l.*) AS line_count,
      COALESCE(SUM(l.unit_price * l.quantity), 0)::text AS gmv,
      COALESCE((
        SELECT SUM(r.amount) FROM shopify_order_refunds r WHERE r.order_id = o.id
      ), 0)::text AS refunded_amount,
      (
        o.shipping_cost_override IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM shopify_order_lines l2
           WHERE l2.order_id = o.id AND l2.cost_override IS NOT NULL
        )
      ) AS has_overrides
    FROM shopify_orders o
    LEFT JOIN shopify_order_lines l ON l.order_id = o.id
    WHERE o.store_id = ${args.storeId}
      AND o.processed_at_shopify BETWEEN ${args.dateFrom} AND ${args.dateTo}
    GROUP BY o.id
    ORDER BY o.processed_at_shopify DESC
    LIMIT ${limit};
  `);
  return rowsRes.rows.map((r) => ({
    orderId: r.order_id,
    shopifyOrderNumber: r.shopify_order_number,
    processedAt: r.processed_at_shopify instanceof Date ? r.processed_at_shopify : new Date(r.processed_at_shopify),
    currency: r.currency,
    lineCount: Number(r.line_count),
    gmv: Number(r.gmv),
    refundedAmount: Number(r.refunded_amount),
    hasOverrides: r.has_overrides,
  }));
}

// ─────────────────────────────────────────────────────────────────────
// Order detail for the edit modal
// ─────────────────────────────────────────────────────────────────────

export interface OrderLineDetail {
  lineId: string;
  sku: string | null;
  vendor: string | null;
  productTitle: string;
  variantTitle: string | null;
  quantity: number;
  unitPrice: string;
  discountAlloc: string;
  /** Cost effective for this line at the order's processed_at — null when no
   *  sku_costs row matches. The operator can override this. */
  defaultCostPerUnit: number | null;
  defaultCostCurrency: string | null;
  costOverride: number | null;
}

export interface OrderShippingDetail {
  shippingRevenue: number;
  /** Default shipping cost the system would use absent an override. */
  defaultShippingCost: number;
  /** Where the default would come from: 'invoice' | 'engine_estimate' | 'unknown'. */
  defaultSource: 'invoice' | 'engine_estimate' | 'unknown';
  shippingCostOverride: number | null;
  shippingCostOverrideNote: string | null;
}

export interface OrderDetail {
  orderId: string;
  storeId: string;
  shopifyOrderNumber: string;
  processedAt: Date;
  currency: string;
  shipCountry: string | null;
  shipWeightKg: number | null;
  lines: OrderLineDetail[];
  shipping: OrderShippingDetail;
}

export async function getOrderDetail(orderId: string): Promise<OrderDetail | null> {
  const [order] = await db.select().from(schema.shopifyOrders).where(eq(schema.shopifyOrders.id, orderId));
  if (!order) return null;
  const lines = await db.select().from(schema.shopifyOrderLines).where(eq(schema.shopifyOrderLines.orderId, orderId));

  // Cost lookup for the order's processed_at date.
  const skus = lines.map((l) => l.sku).filter((s): s is string => !!s);
  let costMap = new Map<string, { costPerUnit: string; currency: string }>();
  if (skus.length > 0) {
    const costsRes = await db.execute<{
      sku: string; cost_per_unit: string; currency: string;
    }>(sql`
      SELECT DISTINCT ON (sku) sku, cost_per_unit::text AS cost_per_unit, currency
        FROM sku_costs
       WHERE store_id = ${order.storeId}
         AND sku IN (${sql.join(skus.map((s) => sql`${s}`), sql`, `)})
         AND effective_from <= ${order.processedAtShopify.toISOString().slice(0, 10)}::date
       ORDER BY sku, effective_from DESC;
    `);
    costMap = new Map(costsRes.rows.map((r) => [r.sku, { costPerUnit: r.cost_per_unit, currency: r.currency }]));
  }

  // Shipping default — invoice if matched by tracking, else engine estimate, else unknown.
  const trackings = extractTrackingNumbers(order.rawPayload);
  let defaultShipping: { amount: number; source: 'invoice' | 'engine_estimate' | 'unknown' } = {
    amount: 0,
    source: 'unknown',
  };
  if (trackings.length > 0) {
    const invRes = await db.execute<{ tracking_number: string; actual_cost: string }>(sql`
      SELECT tracking_number, actual_cost::text FROM shipping_invoices
       WHERE store_id = ${order.storeId}
         AND tracking_number IN (${sql.join(trackings.map((t) => sql`${t}`), sql`, `)})
       LIMIT 1;
    `);
    const inv = invRes.rows[0];
    if (inv) {
      defaultShipping = { amount: Number(inv.actual_cost), source: 'invoice' };
    }
  }
  if (defaultShipping.source === 'unknown') {
    const est = await resolveShippingEstimate({
      shipCountry: order.shipCountry,
      shipWeightKg: order.shipWeightKg !== null ? Number(order.shipWeightKg) : null,
    });
    if (est.source !== 'unknown') {
      defaultShipping = { amount: est.amount, source: 'engine_estimate' };
    }
  }

  return {
    orderId: order.id,
    storeId: order.storeId,
    shopifyOrderNumber: order.shopifyOrderNumber,
    processedAt: order.processedAtShopify,
    currency: order.currency,
    shipCountry: order.shipCountry,
    shipWeightKg: order.shipWeightKg !== null ? Number(order.shipWeightKg) : null,
    lines: lines.map((l) => {
      const c = l.sku ? costMap.get(l.sku) : undefined;
      return {
        lineId: l.id,
        sku: l.sku,
        vendor: l.vendor,
        productTitle: l.productTitle,
        variantTitle: l.variantTitle,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountAlloc: l.discountAlloc,
        defaultCostPerUnit: c ? Number(c.costPerUnit) : null,
        defaultCostCurrency: c?.currency ?? null,
        costOverride: l.costOverride !== null ? Number(l.costOverride) : null,
      };
    }),
    shipping: {
      shippingRevenue: Number(order.totalShipping),
      defaultShippingCost: defaultShipping.amount,
      defaultSource: defaultShipping.source,
      shippingCostOverride: order.shippingCostOverride !== null ? Number(order.shippingCostOverride) : null,
      shippingCostOverrideNote: order.shippingCostOverrideNote,
    },
  };
}

function extractTrackingNumbers(payload: unknown): string[] {
  const p = payload as { fulfillments?: Array<{ trackingInfo?: Array<{ number?: string | null }> }> };
  if (!p?.fulfillments) return [];
  const out: string[] = [];
  for (const f of p.fulfillments) {
    if (!f?.trackingInfo) continue;
    for (const t of f.trackingInfo) {
      if (t?.number) out.push(t.number);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Apply overrides
// ─────────────────────────────────────────────────────────────────────

export interface UpdateOrderOverridesInput {
  orderId: string;
  /** Per-line cost override. Pass `null` to clear (revert to sku_costs lookup). */
  lineCosts: Record<string, number | null>;
  /** Per-order shipping cost override. `null` clears it. */
  shippingCostOverride: number | null;
  shippingCostOverrideNote: string | null;
}

export interface UpdateOrderOverridesResult {
  linesUpdated: number;
  shippingUpdated: boolean;
}

export async function updateOrderOverrides(
  input: UpdateOrderOverridesInput,
): Promise<UpdateOrderOverridesResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('unauthenticated');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_sku_costs')) {
    throw new Error('forbidden');
  }

  const [order] = await db
    .select({ id: schema.shopifyOrders.id, storeId: schema.shopifyOrders.storeId })
    .from(schema.shopifyOrders)
    .where(eq(schema.shopifyOrders.id, input.orderId));
  if (!order) throw new Error(`order ${input.orderId} not found`);

  let linesUpdated = 0;
  await db.transaction(async (tx) => {
    for (const [lineId, cost] of Object.entries(input.lineCosts)) {
      await tx
        .update(schema.shopifyOrderLines)
        .set({ costOverride: cost === null ? null : cost.toString() })
        .where(
          and(
            eq(schema.shopifyOrderLines.id, lineId),
            eq(schema.shopifyOrderLines.orderId, input.orderId),
          ),
        );
      linesUpdated++;
    }

    await tx
      .update(schema.shopifyOrders)
      .set({
        shippingCostOverride:
          input.shippingCostOverride === null ? null : input.shippingCostOverride.toString(),
        shippingCostOverrideNote: input.shippingCostOverrideNote,
      })
      .where(eq(schema.shopifyOrders.id, input.orderId));
  });

  revalidatePath(`/f/orders/${order.storeId}`);
  return { linesUpdated, shippingUpdated: true };
}

// Silence unused-import warnings for helpers kept available to extend later.
void desc;
void gte;
void lte;
