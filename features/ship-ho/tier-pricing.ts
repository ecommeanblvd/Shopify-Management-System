/**
 * THUẦN: bảng giá chiết khấu tier cho đối tác ship hộ.
 *
 * Mô hình (CEO chốt 27/07/2026 — giữ thang 23/07 sau khi thử +10..+25): BẢNG
 * GIÁ GỐC (rack) = cước cơ bản × markup 40% (chỉ để TRÌNH BÀY CK). Thang markup
 * hiệu dụng 4 mốc trên base theo volume tháng trước: +20 / +16 / +12 / +8
 * (sàn 8% = Platinum/strategic). CK chỉ đánh vào bảng cước gốc; phụ phí + phí
 * xử lý 50k passthrough (không CK).
 *
 * Ưu tiên resolve: strategic > override (admin ép) > auto (volume) > standard.
 */

export const RACK_MARKUP_PERCENT = 40;
const FLOOR_MARKUP_PERCENT = 8;

export type ShipHoTierCode = 'standard' | 'silver' | 'gold' | 'platinum';

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

/** Thang 4 mốc markup hiệu dụng trên base (chốt): 20/16/12/8. */
export const SHIP_HO_TIERS: ShipHoTier[] = [
  { code: 'standard', name: 'Standard (+20%)', minOrders: 0, discountPct: discountForMarkup(20) },
  { code: 'silver', name: 'Silver (+16%)', minOrders: 50, discountPct: discountForMarkup(16) },
  { code: 'gold', name: 'Gold (+12%)', minOrders: 100, discountPct: discountForMarkup(12) },
  { code: 'platinum', name: 'Platinum (+8%)', minOrders: 200, discountPct: discountForMarkup(FLOOR_MARKUP_PERCENT) },
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

/** Markup hiệu dụng (%) theo BẬC của đối tác — nguồn duy nhất cho báo giá MMP, báo giá
 *  nội bộ (SMS/import) và tách dòng (CEO 08/09: "từ giờ tính theo đúng tier của từng
 *  brand"). Không đối tác → Standard. Làm tròn 4 chữ số như brand-estimate. */
export function markupTheoBac(p: { strategic: boolean; tierOverrideCode: string | null; tierCode: string | null } | null | undefined): number {
  const tier = resolveTier({ strategic: p?.strategic ?? false, overrideCode: p?.tierOverrideCode ?? null, autoCode: p?.tierCode ?? null });
  return Math.round(effectiveMarkupPercent(tier.discountPct) * 10000) / 10000;
}

/** Markup dùng khi TÍNH LẠI theo bill: ưu tiên markup ĐÃ GHI trên đơn lúc báo giá (brand
 *  được báo bao nhiêu trả bấy nhiêu; đổi bậc chỉ áp cho đơn báo giá sau đó) → Dự tính và
 *  Thực khớp nhau khi cân không đổi. Đơn chưa có markup (chưa báo giá) → theo bậc hiện tại. */
export function markupKhiReBill(daGhi: string | number | null | undefined, theoBacHienTai: number): number {
  const v = daGhi == null || daGhi === '' ? NaN : Number(daGhi);
  return Number.isFinite(v) && v >= 0 ? v : theoBacHienTai;
}
