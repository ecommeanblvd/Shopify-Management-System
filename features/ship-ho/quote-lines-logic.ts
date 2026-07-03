/** THUẦN: từ cước carrier + markup% → giá thu + margin cho 1 line. */
import { applyMarkup } from './markup';

export function summarizeLine(
  carrierCostVnd: number,
  markupPercent: number,
): { chargedVnd: number; marginVnd: number } {
  const chargedVnd = applyMarkup(carrierCostVnd, markupPercent);
  return { chargedVnd, marginVnd: chargedVnd - carrierCostVnd };
}
