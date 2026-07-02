/**
 * THUẦN: giá thu partner = cước carrier (VND) cộng markup%.
 * Làm tròn tới VND gần nhất (VND không có phần thập phân), clamp ≥ 0.
 */
export function applyMarkup(carrierCostVnd: number, markupPercent: number): number {
  const raw = carrierCostVnd * (1 + markupPercent / 100);
  return Math.max(0, Math.round(raw));
}
