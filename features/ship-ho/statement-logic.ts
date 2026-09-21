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

export interface DonTrongKe {
  id: string;
  actualChargedVnd: string | number | null;
  reconcileStatus: string | null;
  reconcileDecision: string | null;
}

/**
 * THUẦN: chia đơn đang gán vào một bảng kê CƯỚC draft thành hai nhóm —
 * `thu` (giá đưa vào tổng, qua `giaThuBangKe`) và `go` (id đơn phải GỠ khỏi kê vì
 * chưa chốt được giá — ví dụ mới rơi về 'pending_review'/'claiming' sau khi đã gán
 * vào kê, hoặc actual_charged_vnd lại null). Dùng bởi `tinhLaiTongBangKe` (N2, review
 * 21/09/2026) để đơn "go" không bị kẹt trong kê draft mãi mãi — `generateStatement`
 * kỳ sau mới nhặt lại được vì statement_id đã gỡ.
 */
export function chiaDonTrongKe(orders: readonly DonTrongKe[]): { thu: number[]; go: string[] } {
  const thu: number[] = [];
  const go: string[] = [];
  for (const o of orders) {
    const g = giaThuBangKe(o);
    if (g != null) thu.push(g); else go.push(o.id);
  }
  return { thu, go };
}
