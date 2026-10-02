/** THUẦN: trạng thái giao của SMS → hai ô chọn trên Lark (spec §5.1). null = không ghi. */
const BANG: Record<string, { category: string; status: string }> = {
  label_created: { category: 'Shipment Created', status: 'Ready for Carrier' },
  in_transit: { category: 'In Transit', status: 'On Delivery' },
  out_for_delivery: { category: 'In Transit', status: 'On Delivery' },
  delivered: { category: 'Delivered', status: 'Delivery Completed' },
  exception: { category: 'Shipping Exceptions', status: 'Delayed' },
  /* `awaiting_pickup` dùng LẠI đúng cặp của `exception` (02/10/2026): cột trên Lark là cột CHỌN,
   * gửi một giá trị lạ thì Lark đẻ thêm lựa chọn mới trong bảng vận hành của đội kho. Trước
   * 02/10 ca này (FedEx `HL`) cũng ghi lên Lark bằng đúng cặp này, nên giữ vậy là KHÔNG đổi gì
   * phía Lark. Muốn có lựa chọn riêng thì phải nhờ đội Lark thêm option trước. */
  awaiting_pickup: { category: 'Shipping Exceptions', status: 'Delayed' },
  returning: { category: 'Shipping Failed', status: 'Return-Processing' },
};

export function mapTrangThai(deliveryStatus: string | null | undefined): { category: string; status: string } | null {
  return deliveryStatus ? BANG[deliveryStatus] ?? null : null;
}
