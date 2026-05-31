'use server';

import { and, eq, sql } from 'drizzle-orm';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { resolveShippingEstimate } from './sync/resolve-shipping-estimate';

// ─────────────────────────────────────────────────────────────────────
// Order detail for the edit modal
// ─────────────────────────────────────────────────────────────────────
//
// The list of orders themselves lives on getStoreMetrics() in
// dashboard-actions.ts so each row already has its computed P&L.

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
  /** Present only when `defaultSource === 'unknown'`. Tells the operator
   *  what's missing — see `EngineEstimateReason`. */
  defaultUnknownReason: 'no_country' | 'no_weight' | 'no_market' | 'no_carrier_link' | 'no_quote' | null;
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
  let defaultShipping: {
    amount: number;
    source: 'invoice' | 'engine_estimate' | 'unknown';
    reason: OrderShippingDetail['defaultUnknownReason'];
  } = {
    amount: 0,
    source: 'unknown',
    reason: null,
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
      defaultShipping = { amount: Number(inv.actual_cost), source: 'invoice', reason: null };
    }
  }
  if (defaultShipping.source === 'unknown') {
    const est = await resolveShippingEstimate({
      shipCountry: order.shipCountry,
      shipWeightKg: order.shipWeightKg !== null ? Number(order.shipWeightKg) : null,
    });
    if (est.source !== 'unknown') {
      defaultShipping = { amount: est.amount, source: 'engine_estimate', reason: null };
    } else {
      // Still unknown — capture WHY so the modal can show the operator
      // exactly which prerequisite is missing.
      defaultShipping = { amount: 0, source: 'unknown', reason: est.reason ?? null };
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
      defaultUnknownReason: defaultShipping.reason,
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
