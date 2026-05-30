export type ShippingCostSource = 'invoice' | 'engine_estimate' | 'unknown';

export interface ComputeInput {
  orderId: string;
  currency: string;
  grossLineTotal: number;
  totalDiscount: number;
  totalShipping: number;
  totalTax: number;
  totalRefunded: number;
  shippingCost: { amount: number; source: ShippingCostSource };
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
  shippingCostSource: ShippingCostSource;
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
    shippingCostSource: input.shippingCost.source,
    skuCost,
    skuCostCoverage: coverage,
    tax: input.totalTax,
    revenue,
    margin,
  };
}
