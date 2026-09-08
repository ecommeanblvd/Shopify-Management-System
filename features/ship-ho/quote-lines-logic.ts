/** THUẦN: từ cước carrier + base + markup% + VAT% + fuel% → giá thu + margin cho 1 line.
 *  Cùng một công thức với computeOffer (offer-pricing.ts). */
import { computeOffer } from './offer-pricing';

export function summarizeLine(
  carrierCostVnd: number,
  baseVnd: number,
  markupPercent: number,
  vatPercent: number,
  fuelPercent: number,
): { chargedVnd: number; marginVnd: number; processingFeeVnd: number } {
  return computeOffer(carrierCostVnd, baseVnd, markupPercent, vatPercent, fuelPercent);
}
