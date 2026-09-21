/** THUẦN: tổng hợp bảng kê kỳ từ danh sách chargedVnd (VND). */
export function summarizeStatement(chargedVndList: number[]): { orderCount: number; totalChargedVnd: number } {
  const total = chargedVndList.reduce((s, v) => s + v, 0);
  return { orderCount: chargedVndList.length, totalChargedVnd: Math.round(total) };
}

export type LoaiBangKe = 'freight' | 'duty';

/**
 * Quyết định đối soát coi là ĐÃ CHỐT (ngoài `null` = khớp bill, tự chốt) → được thu
 * vào bảng kê cước. Khớp đúng `CHARGE_FINALISED` của reconcile-decision.ts: đơn nào
 * chưa đẩy được giá cuối sang MMP thì cũng chưa được thu brand.
 * Một nguồn duy nhất cho cả hàm thuần và câu SQL gom bảng kê (`IN ${QUYET_DINH_DA_CHOT}`).
 */
export const QUYET_DINH_DA_CHOT: readonly string[] = ['accepted', 'claim_credited', 'claim_rejected'];

/**
 * THUẦN: giá đưa vào bảng kê CƯỚC — chỉ giá thực đã chốt đối soát (CEO 21/09/2026).
 * Chưa chốt → null → đơn ở mục "Chờ hoá đơn".
 * Đơn đã `reconciled` nhưng còn `pending_review`/`claiming` là con số Đức CHƯA xác nhận
 * (spec §2.2 "không thu brand một con số Đức chưa xác nhận") → cũng null.
 */
export function giaThuBangKe(o: {
  actualChargedVnd: string | number | null;
  reconcileStatus: string | null;
  reconcileDecision: string | null;
}): number | null {
  if (o.reconcileStatus !== 'reconciled' || o.actualChargedVnd == null) return null;
  if (o.reconcileDecision != null && !QUYET_DINH_DA_CHOT.includes(o.reconcileDecision)) return null;
  const v = Number(o.actualChargedVnd);
  return Number.isFinite(v) ? v : null;
}
