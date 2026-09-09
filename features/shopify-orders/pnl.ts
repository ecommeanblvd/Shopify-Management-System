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
  /** Giá vốn DỰ TÍNH: sku_costs + override tay (null khi thiếu dòng). */
  skuCostVnd: number | null;
  skuCostComplete: boolean;
  /** Giá vốn THỰC từ bảng kê brand đã chốt / PO / MMP (order_line_cogs), VND. null khi chưa có dòng nào. */
  giaVonThucVnd?: number | null;
  /** true khi MỌI dòng đơn đều đã có giá vốn thực. */
  giaVonThucComplete?: boolean;
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
  /** Hai giá vốn nối vào đơn (CEO 09/09/2026): dự tính (sku_costs/override) và thực (bảng kê đã chốt); margin dùng
   *  giá THỰC khi đủ mọi dòng, không thì dự tính, không có gì thì "thieu". */
  giaVon: { duTinhVnd: number | null; thucVnd: number | null; dung: 'thuc' | 'du_tinh' | 'thieu' };
}

const pct = (delta: number, denom: number): number | null => (denom > 0 ? (delta / denom) * 100 : null);

export function computeOrderPnl(i: PnlInput): PnlResult {
  const gmvVnd = i.subtotalVnd + i.shippingRevenueVnd;
  const thuThuanVnd = gmvVnd - i.discountVnd - i.refundVnd;

  const duTinhVnd = i.skuCostVnd === null || !i.skuCostComplete ? null : i.skuCostVnd;
  const thucVnd = i.giaVonThucVnd == null || !i.giaVonThucComplete ? null : i.giaVonThucVnd;
  const dung: 'thuc' | 'du_tinh' | 'thieu' = thucVnd != null ? 'thuc' : duTinhVnd != null ? 'du_tinh' : 'thieu';
  const spMissing = dung === 'thieu';
  const spCost = dung === 'thuc' ? thucVnd! : dung === 'du_tinh' ? duTinhVnd! : 0;
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
  const tongChiVnd = canTotal ? spCost + (i.shipCostVnd ?? 0) + (i.transactionFeeVnd ?? 0) : null;
  const revenueVnd = tongChiVnd === null ? null : thuThuanVnd - tongChiVnd;
  const revenuePct = revenueVnd === null ? null : pct(revenueVnd, gmvVnd);

  return {
    gmvVnd, thuThuanVnd, tongChiVnd, revenueVnd, revenuePct,
    marginSp, marginShip, feeMissing, costFeeVnd: i.transactionFeeVnd ?? 0, complete: canTotal,
    giaVon: { duTinhVnd, thucVnd: i.giaVonThucVnd ?? null, dung },
  };
}
