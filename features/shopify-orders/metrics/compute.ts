export type ShippingCostSource = 'override' | 'invoice' | 'engine_estimate' | 'unknown';

/**
 * When the shipping cost couldn't be resolved (source === 'unknown'),
 * this tells the operator WHY so they can fix the root cause instead
 * of guessing. Engine-side reasons match
 * `EngineEstimateReason` in batch-shipping-estimator.ts.
 */
export type ShippingCostReason =
  | 'no_country'
  | 'no_weight'
  | 'no_market'           // retired by the estimator's fallback path but kept for legacy rows
  | 'no_carrier_link'     // retired by the estimator's fallback path but kept for legacy rows
  | 'no_carrier_accounts'
  | 'no_quote';

export interface ComputeInput {
  orderId: string;
  currency: string;
  grossLineTotal: number;
  totalDiscount: number;
  totalShipping: number;
  totalTax: number;
  totalRefunded: number;
  shippingCost: {
    /** In order currency (USD) — what Revenue subtracts. */
    amount: number;
    /** Original value in the cost currency (e.g. VND), no FX round-trip.
     *  Mirrors `amount` × storeFx, but computed FROM the source value
     *  (rate sheet integer for engine quotes; invoice raw for invoices;
     *  override raw for overrides) instead of derived backward from USD. */
    rawAmount: number;
    /** ISO-3 of `rawAmount`. Equals the order currency when no store-level
     *  cost currency is configured. */
    rawCurrency: string;
    source: ShippingCostSource;
    reason?: ShippingCostReason;
  };
  skuCosts: Array<{
    lineId: string;
    quantity: number;
    costPerUnit: number | null;
    costCurrency: string | null;
  }>;
}

export interface OrderMetrics {
  orderId: string;
  currency: string;
  gmv: number;
  refundedAmount: number;
  netGmv: number;
  discount: number;
  shippingRevenue: number;
  shippingCost: number;
  /** Same as `shippingCost` but in the brand's cost currency (e.g. VND),
   *  preserved from the source — rate sheet for engine quotes, the invoice
   *  for invoices, the operator's input for overrides. Used by the orders
   *  table when the store has a cost currency set so the operator can
   *  reconcile against the FedEx invoice without an FX round-trip. */
  shippingCostRaw: number;
  /** ISO-3 of `shippingCostRaw`. */
  shippingCostRawCurrency: string;
  shippingCostSource: ShippingCostSource;
  /** Only populated when `shippingCostSource === 'unknown'`. Tells the
   *  operator which prerequisite is missing — variant weight, market,
   *  carrier link, etc. */
  shippingCostReason: ShippingCostReason | null;
  skuCost: number;
  skuCostCoverage: number;
  tax: number;
  revenue: number;
  margin: number;
}

export function computeOrderMetrics(input: ComputeInput): OrderMetrics {
  const gmv = input.grossLineTotal;
  const refundedAmount = input.totalRefunded;
  const netGmv = gmv - refundedAmount;
  const skuCost = input.skuCosts.reduce(
    (sum, c) => sum + (c.costPerUnit ?? 0) * c.quantity,
    0,
  );
  const knownCostLines = input.skuCosts.filter((c) => c.costPerUnit !== null).length;
  const coverage = input.skuCosts.length === 0 ? 1 : knownCostLines / input.skuCosts.length;
  const revenue =
    netGmv - input.totalDiscount + input.totalShipping - input.shippingCost.amount - skuCost;
  const margin = netGmv > 0 ? revenue / netGmv : 0;

  return {
    orderId: input.orderId,
    currency: input.currency,
    gmv,
    refundedAmount,
    netGmv,
    discount: input.totalDiscount,
    shippingRevenue: input.totalShipping,
    shippingCost: input.shippingCost.amount,
    shippingCostRaw: input.shippingCost.rawAmount,
    shippingCostRawCurrency: input.shippingCost.rawCurrency,
    shippingCostSource: input.shippingCost.source,
    shippingCostReason: input.shippingCost.reason ?? null,
    skuCost,
    skuCostCoverage: coverage,
    tax: input.totalTax,
    revenue,
    margin,
  };
}
