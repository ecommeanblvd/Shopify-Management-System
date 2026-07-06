/**
 * THUẦN: giá brand-facing ship hộ (Option A) — fuel & VAT áp trên base ĐÃ markup.
 *   margin     = baseVnd × markup% × (1+fuel%) × (1+vat%)
 *   chargedVnd = round(carrierCostVnd) + round(margin) + round(50.000 × (1+vat%))
 * Mỗi đơn ship hộ CÓ PHÍ XỬ LÝ ĐƠN HÀNG cố định 50.000 (chịu VAT) và KHÔNG có phí
 * đóng gói. Dòng "Phí xử lý đơn hàng" hiển thị 50.000 CHƯA gồm VAT; phần VAT của phí
 * (50.000 × vat%) gộp vào dòng VAT tổng — nhất quán với cách base/phụ phí/fuel cũng
 * hiển thị chưa-VAT và VAT gộp ở dòng cuối.
 * Lines (minh bạch, tổng == chargedVnd): markedBase, phụ phí, xăng dầu, phí xử lý, VAT (residual).
 * KHÔNG lộ carrierCost/margin/markup ra ngoài — chỉ trả chargedVnd + lines trung tính.
 */
import { ORDER_PROCESSING_FEE_VND, processingFeeWithVat } from './offer-pricing';

export interface BrandChargeParts { surchargesVnd: number; fuelRealVnd: number; vatRealVnd: number }
export interface BrandChargeLine { label: string; amountVnd: number }

export function computeBrandCharge(input: {
  carrierCostVnd: number; baseVnd: number;
  fuelPercent: number; vatPercent: number; markupPercent: number;
  parts: BrandChargeParts; serviceLabel: string;
}): { chargedVnd: number; lines: BrandChargeLine[] } {
  const { carrierCostVnd, baseVnd, fuelPercent, vatPercent, markupPercent, parts, serviceLabel } = input;
  const f = fuelPercent / 100, v = vatPercent / 100, m = markupPercent / 100;

  const deltaBase = baseVnd * m;
  const margin = Math.max(0, Math.round(deltaBase * (1 + f) * (1 + v)));
  // Phí xử lý: hiển thị chưa-VAT (50.000), nhưng cộng vào tổng đã gồm VAT.
  const processingExVat = Math.round(ORDER_PROCESSING_FEE_VND);
  const processingWithVat = processingFeeWithVat(vatPercent);
  const chargedVnd = Math.round(carrierCostVnd) + margin + processingWithVat;

  const markedBase = Math.round(baseVnd * (1 + m));
  const surLine = Math.round(parts.surchargesVnd);
  const fuelLine = Math.round(parts.fuelRealVnd + f * deltaBase);
  // VAT là dòng residual → gộp cả VAT của phí xử lý; tổng khớp tuyệt đối.
  const vatLine = chargedVnd - markedBase - surLine - fuelLine - processingExVat;

  const lines: BrandChargeLine[] = [
    { label: `Cước cơ bản (${serviceLabel})`, amountVnd: markedBase },
    { label: 'Phụ phí vùng/địa chỉ', amountVnd: surLine },
    { label: 'Phụ phí xăng dầu', amountVnd: fuelLine },
    { label: 'Phí xử lý đơn hàng', amountVnd: processingExVat },
    { label: 'VAT', amountVnd: vatLine },
  ];
  return { chargedVnd, lines };
}
