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

/**
 * KHÔNG có hàm "markup khi re-bill" riêng: tính lại theo bill dùng CHÍNH `markupTheoBac`
 * ở trên (CEO 30/09/2026, thay quyết định 08/09).
 *
 * Vì sao bỏ: bản 08/09 cho re-bill đọc `ship_ho_orders.markup_percent` với lý do "brand được
 * báo bao nhiêu trả bấy nhiêu". Nhưng cột đó trên đơn CŨ là giá trị legacy từ trước khi có
 * hệ bậc (kalisa 30, brand khác 20) — chính con số mà commit 08/09 bỏ không đọc nữa khi BÁO
 * GIÁ vì nó sai. Đọc lại nó lúc tính lại làm đơn đã chốt giá nhảy lên: đo production 30/09,
 * 17 đơn đã bắn giá mới sang MMP (+6.041.723đ) và 78 đơn nữa sẽ nhảy khi hoá đơn duty về
 * (+24.038.592đ). Ví dụ #KLS1990: 1.567.050đ (gửi MMP 23/07, markup 8% = Platinum) thành
 * 1.711.590đ (markup 20% legacy).
 *
 * Bậc là thoả thuận với brand, nên nó là nguồn đúng cho CẢ báo giá lẫn tính lại.
 * Đơn đã đối soát vẫn ĐÓNG BĂNG theo `donDaDongBang` — đổi bậc không tự viết lại hoá đơn cũ.
 */
