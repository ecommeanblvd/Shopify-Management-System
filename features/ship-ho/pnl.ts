/**
 * THUẦN: quy tắc hiển thị Cước gốc, Giá thu & Margin cho bảng đơn ship hộ.
 *
 * Vòng đời một đơn:
 *   - draft/quoted/shipped: chỉ có DỰ TÍNH (snapshot lúc báo giá) — cước gốc dự tính,
 *     giá thu dự tính.
 *   - reconciled (đã đối soát từ hoá đơn carrier): có THỰC TẾ — cước gốc thực (bill),
 *     và giá thu thực (re-bill theo cân thực). Ưu tiên hiển thị số thực.
 *
 * Margin = Giá thu − Cước gốc, mỗi vế ưu tiên số thực nếu đã có.
 */

export function displayCarrierCost(
  estimatedVnd: number | null,
  actualVnd: number | null,
): { vnd: number | null; actual: boolean } {
  if (actualVnd != null) return { vnd: actualVnd, actual: true };
  if (estimatedVnd != null) return { vnd: estimatedVnd, actual: false };
  return { vnd: null, actual: false };
}

/** Giá thu: thực (re-bill cân thực) ưu tiên dự tính (quote). */
export function displayCharged(
  quotedVnd: number | null,
  actualChargedVnd: number | null,
): { vnd: number | null; actual: boolean } {
  if (actualChargedVnd != null) return { vnd: actualChargedVnd, actual: true };
  if (quotedVnd != null) return { vnd: quotedVnd, actual: false };
  return { vnd: null, actual: false };
}

/**
 * Margin = Giá thu − Cước gốc. Mỗi vế ưu tiên số thực. Cờ `estimated=true` khi
 * ĐƠN CHƯA đối soát cước (actualCostVnd == null) → UI gắn nhãn "dự tính".
 */
export function displayMargin(
  quotedChargedVnd: number | null,
  actualChargedVnd: number | null,
  estimatedCostVnd: number | null,
  actualCostVnd: number | null,
): { vnd: number | null; estimated: boolean } {
  const charged = displayCharged(quotedChargedVnd, actualChargedVnd);
  const cost = displayCarrierCost(estimatedCostVnd, actualCostVnd);
  if (charged.vnd == null || cost.vnd == null) return { vnd: null, estimated: actualCostVnd == null };
  return { vnd: Math.round(charged.vnd - cost.vnd), estimated: actualCostVnd == null };
}
