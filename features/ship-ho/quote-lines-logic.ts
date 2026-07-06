/** THUẦN: từ cước carrier + base + markup% + VAT% → giá thu + margin cho 1 line.
 *  Giá thu gồm phí xử lý đơn hàng cố định (chịu VAT) — xem computeOffer. */
import { computeOffer } from './offer-pricing';

export function summarizeLine(
  carrierCostVnd: number,
  baseVnd: number,
  markupPercent: number,
  vatPercent: number,
): { chargedVnd: number; marginVnd: number; processingFeeVnd: number } {
  return computeOffer(carrierCostVnd, baseVnd, markupPercent, vatPercent);
}
