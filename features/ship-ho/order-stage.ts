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
  deliveryStatus: string | null; // in_transit | out_for_delivery | delivered | exception | unknown
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
  if (i.reconcileStatus === 'reconciled' && i.marginVnd != null && i.marginVnd < 0) {
    warnings.push('Margin âm (bill > giá thu)');
  }

  const delivered = i.status === 'delivered' || i.deliveryStatus === 'delivered';

  // Ưu tiên trạng thái tài chính cuối, rồi lùi dần theo hành trình vận chuyển.
  if (i.status === 'settled') return { label: 'Đã thanh toán', tone: 'ok', warnings };
  if (i.status === 'billed') return { label: 'Đã lên bảng kê', tone: 'info', warnings };
  if (delivered) return { label: 'Đã giao', tone: 'ok', warnings };
  if (i.deliveryStatus === 'exception') return { label: 'Sự cố vận chuyển', tone: 'bad', warnings };
  if (i.trackingNumber) {
    if (i.deliveryStatus === 'out_for_delivery') return { label: 'Đang giao', tone: 'info', warnings };
    return { label: 'Đang vận chuyển', tone: 'info', warnings };
  }
  if (i.status === 'shipped') return { label: 'Đã gửi (chưa có tracking)', tone: 'warn', warnings };
  if (i.status === 'quoted') return { label: 'Đã báo giá', tone: 'info', warnings };
  return { label: 'Mới nhận', tone: 'muted', warnings };
}
