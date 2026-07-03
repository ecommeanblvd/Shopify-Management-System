/**
 * THUẦN: giá brand-facing ship hộ (Option A) — fuel & VAT áp trên base ĐÃ markup.
 *   margin     = baseVnd × markup% × (1+fuel%) × (1+vat%)
 *   chargedVnd = round(carrierCostVnd) + round(margin)
 * Lines (minh bạch, tổng == chargedVnd): markedBase, phụ phí, xăng dầu, VAT (dòng cuối là residual).
 * KHÔNG lộ carrierCost/margin/markup ra ngoài — chỉ trả chargedVnd + lines trung tính.
 */
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
  const chargedVnd = Math.round(carrierCostVnd) + margin;

  const markedBase = Math.round(baseVnd * (1 + m));
  const surLine = Math.round(parts.surchargesVnd);
  const fuelLine = Math.round(parts.fuelRealVnd + f * deltaBase);
  const vatLine = chargedVnd - markedBase - surLine - fuelLine; // residual → tổng khớp tuyệt đối

  const lines: BrandChargeLine[] = [
    { label: `Cước cơ bản (${serviceLabel})`, amountVnd: markedBase },
    { label: 'Phụ phí vùng/địa chỉ', amountVnd: surLine },
    { label: 'Phụ phí xăng dầu', amountVnd: fuelLine },
    { label: 'VAT', amountVnd: vatLine },
  ];
  return { chargedVnd, lines };
}
