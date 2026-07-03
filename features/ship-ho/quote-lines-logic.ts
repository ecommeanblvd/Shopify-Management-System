/** THUẦN: từ cước carrier + base + markup% → giá thu + margin cho 1 line. */
import { computeOffer } from './offer-pricing';

export function summarizeLine(
  carrierCostVnd: number,
  baseVnd: number,
  markupPercent: number,
): { chargedVnd: number; marginVnd: number } {
  return computeOffer(carrierCostVnd, baseVnd, markupPercent);
}
