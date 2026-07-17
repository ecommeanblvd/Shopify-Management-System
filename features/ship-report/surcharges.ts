/**
 * THUẦN: phân tích phụ phí từ dữ liệu bill — loại nào ăn bao nhiêu, dính bao nhiêu
 * đơn, tuyến nào nặng nhất. Nguồn: shipment_charges (Shopify) + carrier_bill_lines
 * (ship hộ), unpivot thành (type, amountVnd) trước khi vào đây.
 */

export const SURCHARGE_LABELS: Record<string, string> = {
  residential: 'Giao nhà dân (residential)',
  directSignature: 'Ký nhận trực tiếp',
  remote: 'Vùng xa (out of delivery area)',
  demand: 'Phụ phí nhu cầu (demand)',
  addressCorrection: 'Sửa địa chỉ',
  importHandling: 'Xử lý hàng nhập khẩu',
  elevatedRisk: 'Khu vực rủi ro cao',
  gogreen: 'GoGreen (DHL)',
  other: 'Khác',
};

export interface SurchargeItem {
  month: string;
  carrierKey: string | null;
  country: string | null;
  type: string;       // key trong SURCHARGE_LABELS
  amountVnd: number;  // > 0
}

export interface SurchargeSummaryRow {
  type: string;
  label: string;
  totalVnd: number;
  shipments: number;       // số đơn dính khoản này
  avgVnd: number;          // TB/đơn dính
  pctOfShipments: number | null; // % trên tổng đơn trong scope (cần totalShipments)
}

export function surchargeSummary(items: SurchargeItem[], totalShipments: number | null): SurchargeSummaryRow[] {
  const map = new Map<string, { totalVnd: number; shipments: number }>();
  for (const i of items) {
    if (!(i.amountVnd > 0)) continue;
    const cur = map.get(i.type) ?? { totalVnd: 0, shipments: 0 };
    cur.totalVnd += i.amountVnd;
    cur.shipments += 1;
    map.set(i.type, cur);
  }
  return [...map.entries()]
    .map(([type, v]) => ({
      type,
      label: SURCHARGE_LABELS[type] ?? type,
      totalVnd: Math.round(v.totalVnd),
      shipments: v.shipments,
      avgVnd: Math.round(v.totalVnd / v.shipments),
      pctOfShipments: totalShipments && totalShipments > 0
        ? Math.round((v.shipments / totalShipments) * 1000) / 10
        : null,
    }))
    .sort((a, b) => b.totalVnd - a.totalVnd);
}

export interface SurchargeRouteRow {
  country: string;
  carrierKey: string;
  totalVnd: number;
  shipments: number;
  avgVnd: number;
}

/** Top tuyến (quốc gia × carrier) cho 1 loại phụ phí, sort tổng tiền giảm dần. */
export function surchargeTopRoutes(items: SurchargeItem[], type: string, limit = 10): SurchargeRouteRow[] {
  const map = new Map<string, { totalVnd: number; shipments: number }>();
  for (const i of items) {
    if (i.type !== type || !(i.amountVnd > 0)) continue;
    const key = `${i.country ?? '—'}|${i.carrierKey ?? '—'}`;
    const cur = map.get(key) ?? { totalVnd: 0, shipments: 0 };
    cur.totalVnd += i.amountVnd;
    cur.shipments += 1;
    map.set(key, cur);
  }
  return [...map.entries()]
    .map(([key, v]) => {
      const [country, carrierKey] = key.split('|');
      return { country, carrierKey, totalVnd: Math.round(v.totalVnd), shipments: v.shipments, avgVnd: Math.round(v.totalVnd / v.shipments) };
    })
    .sort((a, b) => b.totalVnd - a.totalVnd)
    .slice(0, limit);
}
