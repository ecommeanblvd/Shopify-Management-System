/**
 * THUẦN: suy trạng thái HÀNH TRÌNH của đơn ship hộ từ tín hiệu thật (status +
 * tracking + deliveryStatus + đối soát + margin) cho cột Trạng thái của bảng.
 *
 * Hành trình: Mới nhận → Đã báo giá → Đang vận chuyển → Đang giao → Đã giao →
 * Đã lên bảng kê → Đã thanh toán. Kèm `warnings[]` — BẤT KỲ vấn đề nào của đơn
 * (sự cố giao hàng, margin âm sau đối soát) để staff kiểm tra ngay.
 */

export type ShipHoTone = 'muted' | 'info' | 'ok' | 'warn' | 'bad';

export interface ShipHoStageInput {
  status: string; // draft | quoted | shipped | delivered | billed | settled
  trackingNumber: string | null;
  deliveryStatus: string | null; // label_created | in_transit | out_for_delivery | delivered | returning | exception | unknown
  reconcileStatus: string | null;
  marginVnd: number | null;
}

export interface ShipHoStage {
  label: string;
  tone: ShipHoTone;
  warnings: string[];
}

export function deriveShipHoStage(i: ShipHoStageInput): ShipHoStage {
  const warnings: string[] = [];
  if (i.deliveryStatus === 'exception') warnings.push('Sự cố giao hàng');
  /* Cảnh báo RIÊNG, không dùng chung chữ với 'exception' (CEO 02/10/2026): việc cần làm khác
   * hẳn nhau. Sự cố thì gọi hãng; chờ khách lấy thì gọi KHÁCH. Một chữ cho hai việc là người
   * đọc phải mở từng đơn ra mới biết phải làm gì. */
  if (i.deliveryStatus === 'awaiting_pickup') warnings.push('Chờ khách tới lấy — nhắc brand liên hệ khách');
  if (i.reconcileStatus === 'reconciled' && i.marginVnd != null && i.marginVnd < 0) {
    warnings.push('Margin âm (bill > giá thu)');
  }

  const delivered = i.status === 'delivered' || i.deliveryStatus === 'delivered';

  // Ưu tiên trạng thái tài chính cuối, rồi lùi dần theo hành trình vận chuyển.
  if (i.status === 'settled') return { label: 'Đã thanh toán', tone: 'ok', warnings };
  if (i.status === 'billed') return { label: 'Đã lên bảng kê', tone: 'info', warnings };
  if (delivered) return { label: 'Đã giao', tone: 'ok', warnings };
  if (i.deliveryStatus === 'returning') return { label: 'Đang hoàn về', tone: 'bad', warnings };
  if (i.deliveryStatus === 'label_created') return { label: 'Mới tạo nhãn — hãng chưa nhận hàng', tone: 'warn', warnings };
  if (i.deliveryStatus === 'exception') return { label: 'Sự cố vận chuyển', tone: 'bad', warnings };
  /* `tone: 'warn'` chứ không 'bad': hãng đã làm xong phần mình, kiện không hỏng — nhưng cũng
   * không phải 'info', vì nó nằm im tới khi có người gọi khách. */
  if (i.deliveryStatus === 'awaiting_pickup') return { label: 'Chờ khách tới lấy', tone: 'warn', warnings };
  if (i.trackingNumber) {
    if (i.deliveryStatus === 'out_for_delivery') return { label: 'Đang giao', tone: 'info', warnings };
    return { label: 'Đang vận chuyển', tone: 'info', warnings };
  }
  if (i.status === 'shipped') return { label: 'Đã gửi (chưa có tracking)', tone: 'warn', warnings };
  if (i.status === 'quoted') return { label: 'Đã báo giá', tone: 'info', warnings };
  return { label: 'Mới nhận', tone: 'muted', warnings };
}
