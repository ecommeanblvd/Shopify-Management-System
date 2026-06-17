/**
 * Tính P&L "Revenue mình tạo ra" + cân đối margin cho 1 đơn. THUẦN, không I/O.
 * Mọi input/output là VND (caller quy USD→VND qua FX trước khi gọi).
 */

export type ShipCostSource = 'billed' | 'engine' | 'unknown';

export interface PnlInput {
  subtotalVnd: number;
  shippingRevenueVnd: number;
  discountVnd: number;
  refundVnd: number;
  skuCostVnd: number | null;
  skuCostComplete: boolean;
  shipCostVnd: number | null;
  shipCostSource: ShipCostSource;
  transactionFeeVnd: number | null;
}

export interface MarginPair {
  revenueVnd: number;
  costVnd: number;
  deltaVnd: number;
  pct: number | null;
  loss: boolean;
  missing: boolean;
  source?: ShipCostSource;
}

export interface PnlResult {
  gmvVnd: number;
  thuThuanVnd: number;
  tongChiVnd: number | null;
  revenueVnd: number | null;
  revenuePct: number | null;
  marginSp: MarginPair;
  marginShip: MarginPair;
  feeMissing: boolean;
  /** Phí transaction đã resolve (0 khi feeMissing). */
  costFeeVnd: number;
  /** Đủ giá vốn + ship để chốt revenueVnd. KHÔNG xét feeMissing (fee thiếu chỉ cảnh báo, vẫn ra revenue). */
  complete: boolean;
}

const pct = (delta: number, denom: number): number | null => (denom > 0 ? (delta / denom) * 100 : null);

export function computeOrderPnl(i: PnlInput): PnlResult {
  const gmvVnd = i.subtotalVnd + i.shippingRevenueVnd;
  const thuThuanVnd = gmvVnd - i.discountVnd - i.refundVnd;

  const spMissing = i.skuCostVnd === null || !i.skuCostComplete;
  const spCost = spMissing ? 0 : (i.skuCostVnd ?? 0);
  const spDelta = i.subtotalVnd - spCost;
  const marginSp: MarginPair = spMissing
    ? { revenueVnd: i.subtotalVnd, costVnd: 0, deltaVnd: 0, pct: null, loss: false, missing: true }
    : { revenueVnd: i.subtotalVnd, costVnd: spCost, deltaVnd: spDelta, pct: pct(spDelta, i.subtotalVnd), loss: spDelta < 0, missing: false };

  const shipMissing = i.shipCostVnd === null || i.shipCostSource === 'unknown';
  const shipCost = shipMissing ? 0 : (i.shipCostVnd ?? 0);
  const shipDelta = i.shippingRevenueVnd - shipCost;
  const marginShip: MarginPair = shipMissing
    ? { revenueVnd: i.shippingRevenueVnd, costVnd: 0, deltaVnd: 0, pct: null, loss: false, missing: true, source: i.shipCostSource }
    : { revenueVnd: i.shippingRevenueVnd, costVnd: shipCost, deltaVnd: shipDelta, pct: pct(shipDelta, i.shippingRevenueVnd), loss: shipDelta < 0, missing: false, source: i.shipCostSource };

  const feeMissing = i.transactionFeeVnd === null;
  const canTotal = !spMissing && !shipMissing;
  const tongChiVnd = canTotal ? (i.skuCostVnd ?? 0) + (i.shipCostVnd ?? 0) + (i.transactionFeeVnd ?? 0) : null;
  const revenueVnd = tongChiVnd === null ? null : thuThuanVnd - tongChiVnd;
  const revenuePct = revenueVnd === null ? null : pct(revenueVnd, gmvVnd);

  return {
    gmvVnd, thuThuanVnd, tongChiVnd, revenueVnd, revenuePct,
    marginSp, marginShip, feeMissing, costFeeVnd: i.transactionFeeVnd ?? 0, complete: canTotal,
  };
}
