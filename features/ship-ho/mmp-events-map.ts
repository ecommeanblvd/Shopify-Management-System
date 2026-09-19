/** THUẦN: map delivery status (tracking provider) → webhook event trung tính. */
export type SuKienVanChuyen = 'shipment.in_transit' | 'shipment.delivered' | 'shipment.exception';

/**
 * `null` = KHÔNG có gì để báo brand. Kiện chỉ mới có nhãn (`label_created`) hay hãng chưa
 * trả lời (`unknown`) chưa hề rời kho — báo "đang vận chuyển" lúc này là báo sai (ca
 * 26-INSLG-SV-0008, 17/09/2026: hàng chưa từng gửi mà MMP nhận 3 lần in_transit).
 */
export function deliveryStatusToEvent(deliveryStatus: string): SuKienVanChuyen | null {
  const s = deliveryStatus.trim().toLowerCase();
  if (s === 'delivered') return 'shipment.delivered';
  if (s === 'label_created' || s === 'unknown' || s === '') return null;
  if (/(exception|fail|return|undeliver|refus|lost|damage)/.test(s)) return 'shipment.exception';
  return 'shipment.in_transit';
}
