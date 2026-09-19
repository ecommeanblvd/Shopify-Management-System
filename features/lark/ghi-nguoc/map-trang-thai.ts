/** THUẦN: trạng thái giao của SMS → hai ô chọn trên Lark (spec §5.1). null = không ghi. */
const BANG: Record<string, { category: string; status: string }> = {
  label_created: { category: 'Shipment Created', status: 'Ready for Carrier' },
  in_transit: { category: 'In Transit', status: 'On Delivery' },
  out_for_delivery: { category: 'In Transit', status: 'On Delivery' },
  delivered: { category: 'Delivered', status: 'Delivery Completed' },
  exception: { category: 'Shipping Exceptions', status: 'Delayed' },
  returning: { category: 'Shipping Failed', status: 'Return-Processing' },
};

export function mapTrangThai(deliveryStatus: string | null | undefined): { category: string; status: string } | null {
  return deliveryStatus ? BANG[deliveryStatus] ?? null : null;
}
