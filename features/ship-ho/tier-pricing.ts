/**
 * THUẦN: bảng giá chiết khấu tier cho đối tác ship hộ.
 *
 * Mô hình (CEO chốt 23/07/2026, thay spec 09/07): BẢNG GIÁ GỐC (rack) = cước
 * cơ bản × markup 40% (chỉ để TRÌNH BÀY CK). Thang markup hiệu dụng 5 mốc trên
 * base theo volume tháng trước: +30 / +25 / +20 / +15 / +10 (sàn 10% =
 * Platinum/strategic). CK chỉ đánh vào bảng cước gốc; phụ phí + phí xử lý 50k
 * passthrough (không CK).
 *
 * Ưu tiên resolve: strategic > override (admin ép) > auto (volume) > standard.
 */

export const RACK_MARKUP_PERCENT = 40;
const FLOOR_MARKUP_PERCENT = 10;

export type ShipHoTierCode = 'standard' | 'bronze' | 'silver' | 'gold' | 'platinum';

export interface ShipHoTier {
  code: ShipHoTierCode;
  name: string;
  /** Ngưỡng đơn/tháng (tháng trước) tối thiểu để vào bậc. */
  minOrders: number;
  /** % chiết khấu trên bảng giá gốc. */
  discountPct: number;
  /** Nấc đặc biệt: volume KHÔNG tự đạt, chỉ admin override tay. */
  manualOnly?: boolean;
}

/** Discount exact để markup hiệu dụng = ĐÚNG m%: d = 1 − (1+m)/(1+rack). */
const discountForMarkup = (markupPct: number): number =>
  (1 - (1 + markupPct / 100) / (1 + RACK_MARKUP_PERCENT / 100)) * 100;

/** Thang 5 mốc markup hiệu dụng trên base (CEO 23/07): 30/25/20/15/10. */
export const SHIP_HO_TIERS: ShipHoTier[] = [
  { code: 'standard', name: 'Standard (+30%)', minOrders: 0, discountPct: discountForMarkup(30) },
  { code: 'bronze', name: 'Bronze (+25%)', minOrders: 20, discountPct: discountForMarkup(25) },
  { code: 'silver', name: 'Silver (+20%)', minOrders: 50, discountPct: discountForMarkup(20) },
  { code: 'gold', name: 'Gold (+15%)', minOrders: 100, discountPct: discountForMarkup(15) },
  { code: 'platinum', name: 'Platinum (+10%)', minOrders: 200, discountPct: discountForMarkup(FLOOR_MARKUP_PERCENT) },
];

const BY_CODE = new Map(SHIP_HO_TIERS.map((t) => [t.code, t]));

export function tierByCode(code: string | null | undefined): ShipHoTier | null {
  return code ? (BY_CODE.get(code as ShipHoTierCode) ?? null) : null;
}

/** Volume tháng trước → tier code (bậc cao nhất có minOrders ≤ n; bỏ nấc manualOnly). */
export function tierForVolume(ordersLastMonth: number): ShipHoTierCode {
  let best: ShipHoTier = SHIP_HO_TIERS[0];
  for (const t of SHIP_HO_TIERS) if (!t.manualOnly && ordersLastMonth >= t.minOrders) best = t;
  return best.code;
}

/** strategic > override hợp lệ > auto hợp lệ > standard. */
export function resolveTier(p: {
  strategic: boolean;
  overrideCode: string | null;
  autoCode: string | null;
}): ShipHoTier {
  if (p.strategic) return BY_CODE.get('platinum')!;
  return tierByCode(p.overrideCode) ?? tierByCode(p.autoCode) ?? BY_CODE.get('standard')!;
}

/** CK d% trên rack → markup hiệu dụng %: (1.4×(1−d/100) − 1)×100. */
export function effectiveMarkupPercent(discountPct: number): number {
  return ((1 + RACK_MARKUP_PERCENT / 100) * (1 - discountPct / 100) - 1) * 100;
}
