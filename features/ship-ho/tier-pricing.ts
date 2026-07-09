/**
 * THUẦN: bảng giá chiết khấu tier cho đối tác ship hộ (spec 09/07/2026).
 *
 * Mô hình: BẢNG GIÁ GỐC (rack) = cước cơ bản × markup 40%. Brand hưởng CHIẾT
 * KHẤU % trên bảng giá gốc theo volume tháng trước; sàn markup hiệu dụng 20%
 * (Platinum, discount = 1 − 1.2/1.4 — exact). CK chỉ đánh vào bảng cước gốc;
 * phụ phí + phí xử lý passthrough (không CK).
 *
 * Ưu tiên resolve: strategic > override (admin ép) > auto (volume) > standard.
 */

export const RACK_MARKUP_PERCENT = 40;
const FLOOR_MARKUP_PERCENT = 20;

export type ShipHoTierCode = 'standard' | 'bronze' | 'silver' | 'gold' | 'platinum';

export interface ShipHoTier {
  code: ShipHoTierCode;
  name: string;
  /** Ngưỡng đơn/tháng (tháng trước) tối thiểu để vào bậc. */
  minOrders: number;
  /** % chiết khấu trên bảng giá gốc. */
  discountPct: number;
}

/** Platinum: discount exact để markup hiệu dụng = ĐÚNG sàn 20%. */
const PLATINUM_DISCOUNT_PCT = (1 - (1 + FLOOR_MARKUP_PERCENT / 100) / (1 + RACK_MARKUP_PERCENT / 100)) * 100;

export const SHIP_HO_TIERS: ShipHoTier[] = [
  { code: 'standard', name: 'Standard', minOrders: 0, discountPct: 0 },
  { code: 'bronze', name: 'Bronze', minOrders: 20, discountPct: 4 },
  { code: 'silver', name: 'Silver', minOrders: 50, discountPct: 7 },
  { code: 'gold', name: 'Gold', minOrders: 100, discountPct: 10 },
  { code: 'platinum', name: 'Platinum', minOrders: 200, discountPct: PLATINUM_DISCOUNT_PCT },
];

const BY_CODE = new Map(SHIP_HO_TIERS.map((t) => [t.code, t]));

export function tierByCode(code: string | null | undefined): ShipHoTier | null {
  return code ? (BY_CODE.get(code as ShipHoTierCode) ?? null) : null;
}

/** Volume tháng trước → tier code (bậc cao nhất có minOrders ≤ n). */
export function tierForVolume(ordersLastMonth: number): ShipHoTierCode {
  let best: ShipHoTier = SHIP_HO_TIERS[0];
  for (const t of SHIP_HO_TIERS) if (ordersLastMonth >= t.minOrders) best = t;
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
