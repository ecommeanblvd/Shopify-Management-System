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
  /* `awaiting_pickup` (nấc mới 02/10/2026) → `shipment.exception`, KHÔNG phải in_transit.
   *
   * MMP chỉ có ba nghĩa: in_transit · delivered · exception. Kiện nằm ở điểm nhận chờ khách
   * KHÔNG còn đi, nên báo in_transit là nói sai; và brand cần biết để gọi khách. Chọn
   * `exception` cũng GIỮ NGUYÊN hợp đồng đang chạy: trước 02/10 ca này tới MMP từ FedEx `HL`
   * cũng dưới dạng exception. Nấc mới làm SMS phân biệt được bên trong, còn MMP thấy y như cũ —
   * nên không cần một vòng hỏi đối tác. Phải khai TƯỜNG MINH vì chuỗi "awaiting_pickup" không
   * khớp biểu thức bắt ngoại lệ phía dưới, và nhánh cuối sẽ cho nó ra in_transit. */
  if (s === 'awaiting_pickup') return 'shipment.exception';
  if (/(exception|fail|return|undeliver|refus|lost|damage)/.test(s)) return 'shipment.exception';
  return 'shipment.in_transit';
}
