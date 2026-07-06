/**
 * THUẦN: giá thu partner ship hộ. Markup CHỈ trên cước base; fuel/phụ phí/VAT
 * carrier pass-through nguyên giá (đã nằm trong carrierCostVnd). Mỗi đơn ship hộ
 * cộng thêm PHÍ XỬ LÝ ĐƠN HÀNG cố định (chịu VAT) — KHÔNG có phí đóng gói.
 *   chargedVnd = carrierCostVnd + base×markup% + round(50.000 × (1+VAT%))
 *   margin     = base×markup%   (phí xử lý là khoản riêng, không tính vào margin markup)
 */
export const MIN_MARKUP_PERCENT = 30;

/** Phí xử lý đơn hàng ship hộ (VND, CHƯA gồm VAT) — cố định mỗi đơn. */
export const ORDER_PROCESSING_FEE_VND = 50000;

/** Phí xử lý đã gồm VAT (VND) — khoản thực cộng vào giá thu. */
export function processingFeeWithVat(vatPercent: number): number {
  return Math.round(ORDER_PROCESSING_FEE_VND * (1 + vatPercent / 100));
}

export function computeOffer(
  carrierCostVnd: number,
  baseVnd: number,
  markupPercent: number,
  vatPercent: number,
): { chargedVnd: number; marginVnd: number; processingFeeVnd: number } {
  const marginVnd = Math.max(0, Math.round(baseVnd * (markupPercent / 100)));
  const processingFeeVnd = processingFeeWithVat(vatPercent);
  return {
    chargedVnd: Math.round(carrierCostVnd) + marginVnd + processingFeeVnd,
    marginVnd,
    processingFeeVnd,
  };
}
