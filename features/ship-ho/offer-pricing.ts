/**
 * THUẦN: giá thu partner ship hộ — MỘT công thức duy nhất cho báo giá nội bộ, tách
 * dòng cho brand (brand-pricing.ts) và re-bill khi đối soát (reconcile-charge.ts).
 * CEO chốt 08/09/2026:
 *
 *   giá thu = ((cước cơ bản + markup + phụ phí) × (1 + xăng dầu%) + 50.000) × (1 + VAT%)
 *
 * Carrier tính MEAN đúng kiểu đó (phụ phí và cước cùng chịu xăng dầu, rồi tất cả
 * chịu VAT), nên phần MEAN cộng thêm — markup và phí xử lý — cũng đi qua cùng hai
 * hệ số. Vì carrierCostVnd đã gồm (cước + phụ phí) × (1+fuel) × (1+VAT), công thức
 * tương đương:
 *   chargedVnd = carrierCostVnd + base×markup%×(1+fuel%)×(1+VAT%) + 50.000×(1+VAT%)
 *   marginVnd  = base×markup%×(1+fuel%)×(1+VAT%)   (phí xử lý là khoản riêng)
 */
/** Phí xử lý đơn hàng ship hộ (VND, CHƯA gồm VAT) — cố định mỗi đơn. */
export const ORDER_PROCESSING_FEE_VND = 50000;

/** Phí xử lý đã gồm VAT (VND) — khoản thực cộng vào giá thu. */
export function processingFeeWithVat(vatPercent: number): number {
  return Math.round(ORDER_PROCESSING_FEE_VND * (1 + vatPercent / 100));
}

/** Margin MEAN trên cước cơ bản, đã qua hệ số xăng dầu và VAT như carrier áp lên cước. */
export function grossedMarginVnd(baseVnd: number, markupPercent: number, fuelPercent: number, vatPercent: number): number {
  return Math.max(0, Math.round(baseVnd * (markupPercent / 100) * (1 + fuelPercent / 100) * (1 + vatPercent / 100)));
}

export function computeOffer(
  carrierCostVnd: number,
  baseVnd: number,
  markupPercent: number,
  vatPercent: number,
  fuelPercent: number,
): { chargedVnd: number; marginVnd: number; processingFeeVnd: number } {
  const marginVnd = grossedMarginVnd(baseVnd, markupPercent, fuelPercent, vatPercent);
  const processingFeeVnd = processingFeeWithVat(vatPercent);
  return {
    chargedVnd: Math.round(carrierCostVnd) + marginVnd + processingFeeVnd,
    marginVnd,
    processingFeeVnd,
  };
}
