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

export interface BrandChargeParts {
  /** Phụ phí vùng/địa chỉ CHUNG (remote, xử lý hàng nhập, demand, per-kg, per-step, peak). */
  surchargesVnd: number;
  /** Phí giao nhà dân (residential) — tách dòng riêng cho brand thấy rõ. */
  residentialVnd: number;
  /** Phí ký nhận trực tiếp (Direct Signature) — tách dòng riêng, chỉ khi brand chọn. */
  directSignatureVnd: number;
  fuelRealVnd: number;
  vatRealVnd: number;
}
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
  const residentialLine = Math.round(parts.residentialVnd);
  const dsLine = Math.round(parts.directSignatureVnd);
  const fuelLine = Math.round(parts.fuelRealVnd + f * deltaBase);
  // VAT là dòng residual → gộp cả VAT của phí xử lý + mọi phụ phí đã tách;
  // tổng lines khớp chargedVnd tuyệt đối bất kể tách bao nhiêu dòng.
  const vatLine = chargedVnd - markedBase - surLine - residentialLine - dsLine - fuelLine - processingExVat;

  // Tách từng loại phụ phí thành dòng riêng (chỉ hiện khi > 0) để brand thấy
  // ĐÚNG và ĐỦ các khoản. Dòng chung/fuel/xử lý/VAT luôn hiện.
  const lines: BrandChargeLine[] = [
    { label: `Cước cơ bản (${serviceLabel})`, amountVnd: markedBase },
  ];
  if (surLine > 0) lines.push({ label: 'Phụ phí vùng/địa chỉ', amountVnd: surLine });
  if (residentialLine > 0) lines.push({ label: 'Phí giao nhà dân', amountVnd: residentialLine });
  if (dsLine > 0) lines.push({ label: 'Ký nhận trực tiếp (Direct Signature)', amountVnd: dsLine });
  lines.push({ label: 'Phụ phí xăng dầu', amountVnd: fuelLine });
  lines.push({ label: 'Phí xử lý đơn hàng', amountVnd: processingExVat });
  lines.push({ label: 'VAT', amountVnd: vatLine });
  return { chargedVnd, lines };
}
