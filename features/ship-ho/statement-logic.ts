/** THUẦN: tổng hợp bảng kê kỳ từ danh sách chargedVnd (VND). */
export function summarizeStatement(chargedVndList: number[]): { orderCount: number; totalChargedVnd: number } {
  const total = chargedVndList.reduce((s, v) => s + v, 0);
  return { orderCount: chargedVndList.length, totalChargedVnd: Math.round(total) };
}

/** THUẦN: giá đưa vào bảng kê của một đơn — đơn ĐÃ CÓ BILL (reconciled, có giá thực)
 *  thu theo giá thực; chưa có bill thu theo giá báo (CEO 08/09). */
export function giaThuBangKe(o: { chargedVnd: string | number | null; actualChargedVnd: string | number | null; reconcileStatus: string | null }): number | null {
  const thuc = o.reconcileStatus === 'reconciled' && o.actualChargedVnd != null ? Number(o.actualChargedVnd) : NaN;
  if (Number.isFinite(thuc)) return thuc;
  return o.chargedVnd == null ? null : Number(o.chargedVnd);
}
