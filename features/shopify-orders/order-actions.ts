'use server';

import { and, eq, sql } from 'drizzle-orm';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { resolveShippingEstimate } from './sync/resolve-shipping-estimate';
import { computeOrderPnl, type ShipCostSource } from './pnl';

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
    /** Effective fuel % that was applied (weekly carrier index). */
    fuelPercent: number;
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
  /** Carrier key ('fedex' | 'dhl') — drives carrier-specific labels in the
   *  cost breakdown (DHL Elevated Risk, GoGreen, Direct Signature…). */
  defaultCarrierKey: string | null;
  defaultZone: string | null;
  defaultTierUpperKg: number | null;
  shippingCostOverride: number | null;
  shippingCostOverrideNote: string | null;
  /** Cost engine ước tính (cost currency = VND), tính LUÔN kể cả khi đã có
   *  hóa đơn — để bảng so sánh hiện cả engine lẫn billed. null khi engine
   *  không định giá được. */
  engineCostVnd: number | null;
  /** Cost thực tế từ shipping_invoices khớp tracking (VND). null khi chưa có. */
  billedCostVnd: number | null;
  /** Tiền của đơn (order.currency) + tiền cost (order.costCurrency) + tỉ giá,
   *  cho UI quy đổi Rev về VND. */
  orderCurrency: string;
  costCurrency: string | null;
  fxCostPerOrderCurrency: number | null;
}

export interface OrderDetail {
  orderId: string;
  storeId: string;
  shopifyOrderNumber: string;
  processedAt: Date;
  currency: string;
  shipCountry: string | null;
  /** Ngày đi hàng — sớm nhất trong các pack (shipments.label_created_at). Điền từ
   *  Excel LOG hoặc hoá đơn carrier (đối soát). null khi chưa đi hàng / chưa có dữ liệu. */
  shipDate: Date | null;
  /** Weight pulled from the Shopify order snapshot. Frozen at sync time. */
  shipWeightKg: number | null;
  /** Operator-set override. When non-null, the engine uses this instead of
   *  `shipWeightKg`. Lets operators correct legacy orders without
   *  re-syncing from Shopify. */
  shipWeightKgOverride: number | null;
  /** Địa chỉ giao + kết quả verify FedEx Address Validation. */
  address: {
    line1: string | null; line2: string | null; city: string | null;
    province: string | null; postcode: string | null; name: string | null; company: string | null;
    class: string | null; deliverable: boolean | null; issue: string | null;
    standardized: string | null; verifiedAt: Date | null;
    /** 4 mức: verified|census_verified|zip_only|undeliverable. null = đơn cũ chưa re-verify. */
    confidence: string | null;
  };
  lines: OrderLineDetail[];
  shipping: OrderShippingDetail;
  /** P&L tính sẵn (VND). null khi thiếu FX để quy đổi. Xem features/shopify-orders/pnl.ts */
  pnl: import('./pnl').PnlResult | null;
  /** true khi store chưa set FX nên không quy được order-ccy→VND. */
  needsFx: boolean;
}

export async function getOrderDetail(orderId: string): Promise<OrderDetail | null> {
  const [order] = await db.select().from(schema.shopifyOrders).where(eq(schema.shopifyOrders.id, orderId));
  if (!order) return null;
  // Cost FX lives per-store (e.g. Mirer takes USD orders but pays carriers
  // in VND). costCurrency = the operational/cost currency; fx = how many
  // cost-currency units per 1 order-currency unit. Used by the modal's ship
  // comparison to normalise Rev (order ccy) into VND.
  const [store] = await db
    .select({
      costCurrency: schema.stores.costCurrency,
      fxCostPerOrderCurrency: schema.stores.fxCostPerOrderCurrency,
    })
    .from(schema.stores)
    .where(eq(schema.stores.id, order.storeId));
  const lines = await db.select().from(schema.shopifyOrderLines).where(eq(schema.shopifyOrderLines.orderId, orderId));

  const refundRows = await db
    .select({ amt: schema.shopifyOrderRefunds.amount })
    .from(schema.shopifyOrderRefunds)
    .where(eq(schema.shopifyOrderRefunds.orderId, orderId));
  const refundOrderCcy = refundRows.reduce((s, r) => s + Number(r.amt), 0);

  // Ngày đi hàng: pack sớm nhất có label_created_at (Excel LOG hoặc đối soát carrier).
  const shipRows = await db
    .select({ labelCreatedAt: schema.shipments.labelCreatedAt })
    .from(schema.shipments)
    .where(eq(schema.shipments.orderId, orderId));
  const shipDate = shipRows
    .map((s) => s.labelCreatedAt)
    .filter((d): d is Date => d != null)
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

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
    carrierKey: string | null;
    carrierLabel: string | null;
    zone: string | null;
    tierUpperKg: number | null;
  } = {
    amount: 0, rawAmount: 0, rawCurrency: '',
    source: 'unknown', reason: null,
    breakdown: null, carrierLabel: null, carrierKey: null, zone: null, tierUpperKg: null,
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
        breakdown: null, carrierLabel: null, carrierKey: null, zone: null, tierUpperKg: null,
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
          fuelPercent: est.breakdown.fuelPercent,
          vatPercent: est.breakdown.vatPercent,
          vat: est.breakdown.vat,
          discountPercent: est.breakdown.discountPercent,
          discount: est.breakdown.discount,
          carrierCost: est.breakdown.carrierCost,
        },
        carrierLabel: est.carrierLabel,
        carrierKey: est.carrierKey,
        zone: est.zone,
        tierUpperKg: est.tierUpperKg,
      };
    } else {
      // Still unknown — capture WHY so the modal can show the operator
      // exactly which prerequisite is missing.
      defaultShipping = {
        amount: 0, rawAmount: 0, rawCurrency: '',
        source: 'unknown', reason: est.reason ?? null,
        breakdown: null, carrierLabel: null, carrierKey: null, zone: null, tierUpperKg: null,
      };
    }
  }

  // Billed thực tế: ƯU TIÊN dữ liệu hoá đơn carrier đã đối soát (shipment_charges
  // — nguồn trực tiếp từ Bill/Invoice carrier, phủ mọi đơn đã đối soát, gồm cả đơn
  // cũ). shipping_invoices (CSV upload) chỉ là fallback. Đơn nhiều pack → cộng dồn.
  const chargeRows = await db
    .select({ total: schema.shipmentCharges.totalAmount })
    .from(schema.shipmentCharges)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.shipmentCharges.shipmentId))
    .where(eq(schema.shipments.orderId, orderId));
  const billedFromCharges = chargeRows.length
    ? chargeRows.reduce((s, r) => s + Number(r.total), 0)
    : null;
  const billedCostVnd = billedFromCharges
    ?? (defaultShipping.source === 'invoice' ? defaultShipping.rawAmount : null);
  // engine: tính LUÔN (kể cả khi đã có billed) để bảng so sánh có cả hai.
  // Nếu khối default đã là engine_estimate thì tái dùng rawAmount, khỏi gọi lại.
  let engineCostVnd: number | null =
    defaultShipping.source === 'engine_estimate' ? defaultShipping.rawAmount : null;
  if (engineCostVnd === null) {
    const effW = order.shipWeightKgOverride !== null ? Number(order.shipWeightKgOverride)
      : order.shipWeightKg !== null ? Number(order.shipWeightKg) : null;
    const est = await resolveShippingEstimate({
      shipCountry: order.shipCountry, shipCity: order.shipCity, shipPostcode: order.shipPostcode,
      shipWeightKg: effW, effectiveDate: order.processedAtShopify ?? undefined,
      shippingCarrierKey: order.shippingCarrierKey ?? null,
    });
    engineCostVnd = est.source !== 'unknown' ? est.costAmount : null;
  }

  // P&L: quy mọi khoản order-currency → VND (cost currency) qua FX của store.
  const fx = order.currency === (store?.costCurrency ?? order.currency)
    ? 1
    : (store?.fxCostPerOrderCurrency != null ? Number(store.fxCostPerOrderCurrency) : null);

  const subtotalOrderCcy = lines.reduce((s, l) => s + Number(l.unitPrice) * l.quantity, 0);
  const discountOrderCcy = order.totalDiscount != null ? Number(order.totalDiscount) : 0;

  // Giá vốn (đã ở cost currency = VND): costOverride ?? defaultCostPerUnit, ×qty.
  // defaultCostPerUnit không nằm trên row thô — tra từ costMap (như khối .map()
  // ở dưới). costOverride là numeric → string|null từ drizzle.
  let skuCostVnd = 0;
  let skuComplete = true;
  for (const l of lines) {
    const c = l.sku ? costMap.get(l.sku) : undefined;
    const defaultCostPerUnit = c ? Number(c.costPerUnit) : null;
    const unit = l.costOverride !== null ? Number(l.costOverride)
      : (defaultCostPerUnit !== null ? defaultCostPerUnit : null);
    if (unit === null) { skuComplete = false; continue; }
    skuCostVnd += unit * l.quantity;
  }

  const shipCostVnd = billedCostVnd ?? engineCostVnd ?? null;
  const shipCostSource: ShipCostSource =
    billedCostVnd != null ? 'billed' : engineCostVnd != null ? 'engine' : 'unknown';

  const toVnd = (v: number) => (fx === null ? null : Math.round(v * fx));
  const subtotalVnd = toVnd(subtotalOrderCcy);
  const shippingRevenueVnd = toVnd(Number(order.totalShipping));
  const discountVnd = toVnd(discountOrderCcy);
  const refundVnd = toVnd(refundOrderCcy);
  const transactionFeeVnd = order.transactionFee != null ? toVnd(Number(order.transactionFee)) : null;

  const pnl = (subtotalVnd === null || shippingRevenueVnd === null)
    ? null
    : computeOrderPnl({
        subtotalVnd, shippingRevenueVnd,
        discountVnd: discountVnd ?? 0, refundVnd: refundVnd ?? 0,
        skuCostVnd: skuComplete ? skuCostVnd : null,
        skuCostComplete: skuComplete,
        shipCostVnd, shipCostSource,
        transactionFeeVnd,
      });

  return {
    orderId: order.id,
    storeId: order.storeId,
    shopifyOrderNumber: order.shopifyOrderNumber,
    processedAt: order.processedAtShopify,
    currency: order.currency,
    shipCountry: order.shipCountry,
    shipDate,
    shipWeightKg: order.shipWeightKg !== null ? Number(order.shipWeightKg) : null,
    shipWeightKgOverride: order.shipWeightKgOverride !== null ? Number(order.shipWeightKgOverride) : null,
    address: {
      line1: order.shipAddress1, line2: order.shipAddress2, city: order.shipCity,
      province: order.shipProvinceCode, postcode: order.shipPostcode,
      name: order.shipName, company: order.shipCompany,
      class: order.addrClass, deliverable: order.addrDeliverable, issue: order.addrIssue,
      standardized: order.addrStandardized, verifiedAt: order.addrVerifiedAt,
      confidence: order.addrConfidence,
    },
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
      defaultCarrierKey: defaultShipping.carrierKey,
      defaultZone: defaultShipping.zone,
      defaultTierUpperKg: defaultShipping.tierUpperKg,
      shippingCostOverride: order.shippingCostOverride !== null ? Number(order.shippingCostOverride) : null,
      shippingCostOverrideNote: order.shippingCostOverrideNote,
      engineCostVnd,
      billedCostVnd,
      orderCurrency: order.currency,
      costCurrency: store?.costCurrency ?? null,
      fxCostPerOrderCurrency:
        store?.fxCostPerOrderCurrency !== null && store?.fxCostPerOrderCurrency !== undefined
          ? Number(store.fxCostPerOrderCurrency)
          : null,
    },
    pnl,
    needsFx: pnl === null,
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
