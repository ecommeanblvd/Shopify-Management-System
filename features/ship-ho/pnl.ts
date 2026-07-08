/**
 * THUẦN: quy tắc hiển thị Cước gốc & Margin cho bảng đơn ship hộ.
 *
 * Vòng đời một đơn:
 *   - draft/quoted/shipped: chỉ có cước gốc DỰ TÍNH (snapshot lúc báo giá).
 *   - reconciled: có thêm cước gốc THỰC TẾ (từ bill carrier) → ưu tiên hiển thị.
 *
 * Margin = Giá thu (charged) − Cước gốc. Dùng cước thực tế nếu đã đối soát, không
 * thì dùng dự tính (cờ `estimated=true` để UI gắn nhãn "dự tính").
 */

export function displayCarrierCost(
  estimatedVnd: number | null,
  actualVnd: number | null,
): { vnd: number | null; actual: boolean } {
  if (actualVnd != null) return { vnd: actualVnd, actual: true };
  if (estimatedVnd != null) return { vnd: estimatedVnd, actual: false };
  return { vnd: null, actual: false };
}

export function displayMargin(
  chargedVnd: number | null,
  estimatedCostVnd: number | null,
  actualCostVnd: number | null,
): { vnd: number | null; estimated: boolean } {
  if (chargedVnd == null) return { vnd: null, estimated: true };
  const cost = displayCarrierCost(estimatedCostVnd, actualCostVnd);
  if (cost.vnd == null) return { vnd: null, estimated: true };
  return { vnd: Math.round(chargedVnd - cost.vnd), estimated: !cost.actual };
}
