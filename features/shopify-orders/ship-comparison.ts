export interface ShipComparisonInput {
  shippingRevenue: number;          // tiền đơn
  orderCurrency: string;
  costCurrency: string | null;      // kỳ vọng 'VND'
  fxCostPerOrderCurrency: number | null;
  engineCostVnd: number | null;
  billedCostVnd: number | null;
  overrideVnd: number | null;
}
export interface ShipComparison {
  revVnd: number | null;
  engineCostVnd: number | null;
  billedCostVnd: number | null;
  costVnd: number | null;
  costBasis: 'override' | 'billed' | 'engine' | null;
  marginVnd: number | null;
  marginPct: number | null;
  needsFx: boolean;
}
const VND = 'VND';
export function computeShipComparison(i: ShipComparisonInput): ShipComparison {
  const cc = i.costCurrency ?? VND;
  // Rev quy về tiền cost (VND): cùng tiền → giữ nguyên; khác tiền → ×fx; thiếu fx → null.
  const sameCcy = i.orderCurrency === cc;
  const needsFx = !sameCcy && i.fxCostPerOrderCurrency == null;
  const revVnd = sameCcy ? i.shippingRevenue
    : i.fxCostPerOrderCurrency != null ? Math.round(i.shippingRevenue * i.fxCostPerOrderCurrency)
    : null;
  // cost ưu tiên override > billed > engine.
  let costVnd: number | null = null; let costBasis: ShipComparison['costBasis'] = null;
  if (i.overrideVnd != null) { costVnd = i.overrideVnd; costBasis = 'override'; }
  else if (i.billedCostVnd != null) { costVnd = i.billedCostVnd; costBasis = 'billed'; }
  else if (i.engineCostVnd != null) { costVnd = i.engineCostVnd; costBasis = 'engine'; }
  const marginVnd = revVnd != null && costVnd != null ? revVnd - costVnd : null;
  const marginPct = marginVnd != null && revVnd ? (marginVnd / revVnd) * 100 : null;
  return { revVnd, engineCostVnd: i.engineCostVnd, billedCostVnd: i.billedCostVnd,
    costVnd, costBasis, marginVnd, marginPct, needsFx };
}
