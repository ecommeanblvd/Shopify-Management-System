/** THUẦN: tổng hợp bảng kê kỳ từ danh sách chargedVnd (VND). */
export function summarizeStatement(chargedVndList: number[]): { orderCount: number; totalChargedVnd: number } {
  const total = chargedVndList.reduce((s, v) => s + v, 0);
  return { orderCount: chargedVndList.length, totalChargedVnd: Math.round(total) };
}
