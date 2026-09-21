/**
 * THUẦN: gom dòng duty của một mã vận đơn theo SỐ HOÁ ĐƠN.
 *
 * Hợp đồng MMP §5 khoá `order.duty_charged` theo `(mmpRef, fedexInvoiceNumber)`: cùng khoá
 * gửi lại là GHI ĐÈ dòng đó. Một hoá đơn FedEx có thể có NHIỀU dòng duty cho cùng mã vận
 * đơn (FedEx tách theo sắc thuế); để nguyên từng dòng thì mỗi dòng bắn một event cùng khoá
 * và MMP chỉ giữ dòng cuối ⇒ thu thiếu đúng bằng các dòng trước. Gom trước khi trả: cộng
 * `dutyVnd`, lấy `issueDate` SỚM NHẤT (ngày hoá đơn về, mốc xếp kỳ bảng kê duty §2.3).
 * Giữ thứ tự xuất hiện đầu tiên của mỗi hoá đơn (query đã sắp theo kỳ hoá đơn).
 */
export interface DongDuty { billNumber: string; issueDate: string; dutyVnd: number }

export function gomDongDutyTheoHoaDon(dong: readonly DongDuty[]): DongDuty[] {
  const theoHoaDon = new Map<string, DongDuty>();
  for (const d of dong) {
    const cu = theoHoaDon.get(d.billNumber);
    if (!cu) {
      theoHoaDon.set(d.billNumber, { ...d });
      continue;
    }
    cu.dutyVnd += d.dutyVnd;
    if (d.issueDate < cu.issueDate) cu.issueDate = d.issueDate;
  }
  return [...theoHoaDon.values()];
}
