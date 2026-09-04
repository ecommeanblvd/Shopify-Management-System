/**
 * Sự kiện còn kẹt trong outbox có còn ĐÁNG gửi không.
 *
 * Outbox gửi lại vô thời hạn, nhưng trạng thái đơn thì đi tiếp. Một sự kiện kẹt
 * từ tháng trước gửi bây giờ sẽ GHI ĐÈ MMP bằng số cũ — nguy hiểm hơn là không
 * gửi. Ví dụ thật (03/09): `order.reconciled` của SV-0009 kẹt từ 20/07 mang giá
 * 1.535.080đ, trong khi bản 27/07 đã gửi thành công với 1.466.179đ.
 *
 * Hai luật, đều dựa trên sự kiện ĐÃ GỬI THÀNH CÔNG sau nó:
 *  1. Cùng loại đã gửi bản mới hơn → bản kẹt là số cũ, bỏ.
 *  2. `order.reconcile_pending` mà sau đó `order.reconciled` đã gửi → đơn đã
 *     chốt giá xong; gửi lại thông báo "đang chờ đối soát" là báo sai trạng thái.
 */
export interface SuKienDaGui {
  event: string;
  occurredAt: Date;
}

export interface SuKienKet {
  event: string;
  occurredAt: Date;
}

/** THUẦN: sự kiện kẹt đã bị vượt chưa. Trả lý do (để ghi vào last_error) hoặc null. */
export function lyDoBoQua(ket: SuKienKet, daGui: SuKienDaGui[]): string | null {
  const sauNo = daGui.filter((d) => d.occurredAt > ket.occurredAt);
  const cungLoai = sauNo.find((d) => d.event === ket.event);
  if (cungLoai) {
    return `bỏ qua: đã gửi ${ket.event} mới hơn lúc ${cungLoai.occurredAt.toISOString()}`;
  }
  if (ket.event === 'order.reconcile_pending') {
    const chotGia = sauNo.find((d) => d.event === 'order.reconciled');
    if (chotGia) {
      return `bỏ qua: đơn đã chốt giá (order.reconciled gửi lúc ${chotGia.occurredAt.toISOString()}), thông báo chờ đối soát không còn đúng`;
    }
  }
  return null;
}
