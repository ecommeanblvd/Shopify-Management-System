/**
 * THUẦN: giá thu partner ship hộ. Markup CHỈ trên cước base; fuel/phụ phí/VAT
 * pass-through nguyên giá carrier (đã nằm trong carrierCostVnd).
 *   chargedVnd = carrierCostVnd + base×markup%   → margin = base×markup%
 */
export const MIN_MARKUP_PERCENT = 30;

export function computeOffer(
  carrierCostVnd: number,
  baseVnd: number,
  markupPercent: number,
): { chargedVnd: number; marginVnd: number } {
  const marginVnd = Math.max(0, Math.round(baseVnd * (markupPercent / 100)));
  return { chargedVnd: Math.round(carrierCostVnd) + marginVnd, marginVnd };
}
