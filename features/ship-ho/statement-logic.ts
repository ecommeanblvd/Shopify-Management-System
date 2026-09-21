/** THUẦN: tổng hợp bảng kê kỳ từ danh sách chargedVnd (VND). */
export function summarizeStatement(chargedVndList: number[]): { orderCount: number; totalChargedVnd: number } {
  const total = chargedVndList.reduce((s, v) => s + v, 0);
  return { orderCount: chargedVndList.length, totalChargedVnd: Math.round(total) };
}

export type LoaiBangKe = 'freight' | 'duty';

/** THUẦN: giá đưa vào bảng kê CƯỚC — chỉ giá thực đã chốt đối soát (CEO 21/09/2026). Chưa chốt → null → đơn ở mục "Chờ hoá đơn". */
export function giaThuBangKe(o: { actualChargedVnd: string | number | null; reconcileStatus: string | null }): number | null {
  if (o.reconcileStatus !== 'reconciled' || o.actualChargedVnd == null) return null;
  const v = Number(o.actualChargedVnd);
  return Number.isFinite(v) ? v : null;
}
