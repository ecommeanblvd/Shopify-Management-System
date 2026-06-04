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
  /** Same as `defaultShippingCost` but in the carrier's cost currency
   *  (e.g. VND straight from the rate sheet). Used by the modal so the
   *  breakdown table mirrors the FedEx invoice 1-for-1. */
  defaultShippingCostRaw: number;
  /** ISO-3 of `defaultShippingCostRaw`. Empty when source is 'unknown'. */
  defaultShippingCostRawCurrency: string;
  /** Where the default would come from: 'invoice' | 'engine_estimate' | 'unknown'. */
  defaultSource: 'invoice' | 'engine_estimate' | 'unknown';
  /** Present only when `defaultSource === 'unknown'`. Tells the operator
   *  what's missing — see `EngineEstimateReason`. */
  defaultUnknownReason:
    | 'no_country'
    | 'no_weight'
    | 'no_market'
    | 'no_carrier_link'
    | 'no_carrier_accounts'
    | 'no_quote'
    | null;
  /** Engine breakdown of base + surcharges + fuel + VAT, in the cost
   *  currency. Present only when `defaultSource === 'engine_estimate'`.
   *  Modal renders it as a labelled cost table. */
  defaultBreakdown: {
    /** Actual scale weight (kg) the engine was given. */
    actualWeightKg: number;
    /** Dim weight (kg) derived from L×W×H/divisor. Zero when dim not
     *  provided or carrier has no `dimDivisorCm3PerKg`. */
    dimWeightKg: number;
    /** What was billed: max(actual, dim). Equals actual when no dim. */
    chargeableWeightKg: number;
    base: number;
    peak: number;
    remote: number;
    residential: number;
    perKg: number;
    demand: number;
    countryFixed: number;
    /** Stepped per-weight surcharge (DHL GoGreen Plus and similar).
     *  ceil(weight / step_kg) × value, summed across active rows. */
    perStep: number;
    fuel: number;
    /** Effective VAT % that was applied. */
    vatPercent: number;
    vat: number;
    /** Negotiated volume discount % applied to published base (sum of
     *  active contract_discount_pct rows). E.g. 70 → 70 % off published. */
    discountPercent: number;
    /** Absolute VND amount deducted by the volume discount —
     *  `base × discountPercent / 100`, positive. Already factored into
     *  `carrierCost`; surfaced for UI to render as a "-" line. */
    discount: number;
    /** subtotalBeforeMarkup — i.e. base + accessorials + fuel + VAT
     *  − discount. */
    carrierCost: number;
  } | null;
  /** Operator-visible carrier name + zone label + matched tier (kg) when
   *  the engine quoted. Helps the operator cross-reference against the
   *  rate sheet that produced the breakdown. */
  defaultCarrierLabel: string | null;
  defaultZone: string | null;
  defaultTierUpperKg: number | null;
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
  /** Weight pulled from the Shopify order snapshot. Frozen at sync time. */
  shipWeightKg: number | null;
  /** Operator-set override. When non-null, the engine uses this instead of
   *  `shipWeightKg`. Lets operators correct legacy orders without
   *  re-syncing from Shopify. */
  shipWeightKgOverride: number | null;
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
    rawAmount: number;
    rawCurrency: string;
    source: 'invoice' | 'engine_estimate' | 'unknown';
    reason: OrderShippingDetail['defaultUnknownReason'];
    breakdown: OrderShippingDetail['defaultBreakdown'];
    carrierLabel: string | null;
    zone: string | null;
    tierUpperKg: number | null;
  } = {
    amount: 0, rawAmount: 0, rawCurrency: '',
    source: 'unknown', reason: null,
    breakdown: null, carrierLabel: null, zone: null, tierUpperKg: null,
  };
  if (trackings.length > 0) {
    const invRes = await db.execute<{ tracking_number: string; actual_cost: string; currency: string }>(sql`
      SELECT tracking_number, actual_cost::text, currency FROM shipping_invoices
       WHERE store_id = ${order.storeId}
         AND tracking_number IN (${sql.join(trackings.map((t) => sql`${t}`), sql`, `)})
       LIMIT 1;
    `);
    const inv = invRes.rows[0];
    if (inv) {
      const raw = Number(inv.actual_cost);
      defaultShipping = {
        amount: raw, rawAmount: raw, rawCurrency: inv.currency,
        source: 'invoice', reason: null,
        breakdown: null, carrierLabel: null, zone: null, tierUpperKg: null,
      };
    }
  }
  if (defaultShipping.source === 'unknown') {
    // Operator weight override wins so the breakdown reflects the
    // corrected weight, not the stale Shopify snapshot value.
    const effectiveWeight = order.shipWeightKgOverride !== null
      ? Number(order.shipWeightKgOverride)
      : order.shipWeightKg !== null ? Number(order.shipWeightKg) : null;
    const est = await resolveShippingEstimate({
      shipCountry: order.shipCountry,
      shipCity: order.shipCity,
      shipPostcode: order.shipPostcode,
      shipWeightKg: effectiveWeight,
      // Reproduce the carrier's rate sheet at the moment the order
      // shipped — fuel surcharge changes weekly, so today's value would
      // mis-price a 6-week-old order. processed_at_shopify is when
      // Shopify accepted the order (≈ ship date for fulfilled orders).
      effectiveDate: order.processedAtShopify ?? undefined,
      // Pin the quote to the carrier the customer actually paid for.
      // NULL → estimator defaults to FedEx per operator spec.
      shippingCarrierKey: order.shippingCarrierKey ?? null,
    });
    if (est.source !== 'unknown' && est.breakdown !== null) {
      defaultShipping = {
        amount: est.amount,
        rawAmount: est.costAmount,
        rawCurrency: est.costCurrency,
        source: 'engine_estimate',
        reason: null,
        breakdown: {
          actualWeightKg: est.breakdown.actualWeightKg,
          dimWeightKg: est.breakdown.dimWeightKg,
          chargeableWeightKg: est.breakdown.chargeableWeightKg,
          base: est.breakdown.base,
          peak: est.breakdown.peak,
          remote: est.breakdown.remote,
          residential: est.breakdown.residential,
          perKg: est.breakdown.perKg,
          demand: est.breakdown.demand,
          countryFixed: est.breakdown.countryFixed,
          perStep: est.breakdown.perStep,
          fuel: est.breakdown.fuel,
          vatPercent: est.breakdown.vatPercent,
          vat: est.breakdown.vat,
          discountPercent: est.breakdown.discountPercent,
          discount: est.breakdown.discount,
          carrierCost: est.breakdown.carrierCost,
        },
        carrierLabel: est.carrierLabel,
        zone: est.zone,
        tierUpperKg: est.tierUpperKg,
      };
    } else {
      // Still unknown — capture WHY so the modal can show the operator
      // exactly which prerequisite is missing.
      defaultShipping = {
        amount: 0, rawAmount: 0, rawCurrency: '',
        source: 'unknown', reason: est.reason ?? null,
        breakdown: null, carrierLabel: null, zone: null, tierUpperKg: null,
      };
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
    shipWeightKgOverride: order.shipWeightKgOverride !== null ? Number(order.shipWeightKgOverride) : null,
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
      defaultShippingCostRaw: defaultShipping.rawAmount,
      defaultShippingCostRawCurrency: defaultShipping.rawCurrency,
      defaultSource: defaultShipping.source,
      defaultUnknownReason: defaultShipping.reason,
      defaultBreakdown: defaultShipping.breakdown,
      defaultCarrierLabel: defaultShipping.carrierLabel,
      defaultZone: defaultShipping.zone,
      defaultTierUpperKg: defaultShipping.tierUpperKg,
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
  /** Per-order weight override (kg). When non-null, the engine uses this
   *  to look up the rate instead of the Shopify-snapshot weight. `null`
   *  clears it. Used for legacy orders whose variant weight was wrong
   *  at sync time and got snapshotted — fixing the variant later doesn't
   *  retroactively update past orders. */
  shipWeightKgOverride: number | null;
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
        shipWeightKgOverride:
          input.shipWeightKgOverride === null ? null : input.shipWeightKgOverride.toString(),
      })
      .where(eq(schema.shopifyOrders.id, input.orderId));
  });

  revalidatePath(`/f/orders/${order.storeId}`);
  return { linesUpdated, shippingUpdated: true };
}

// Silence unused-import warnings for helpers kept available to extend later.
