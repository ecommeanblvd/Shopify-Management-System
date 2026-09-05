/**
 * Quyết định TRƯỚC (trong bộ nhớ) xem có cần chạy lệnh UPDATE freeze giao hàng
 * hay không, thay vì cứ chạy rồi để mệnh đề WHERE lọc.
 *
 * Vì sao: khối freeze chạy tới BA lệnh UPDATE cho MỖI đơn có trạng thái giao
 * (~3.900 đơn → ~10.000 lệnh), trong khi thực tế chỉ 51 dòng đổi. Mỗi lệnh là
 * một vòng tới database. Điều kiện lọc đã nằm sẵn trong WHERE, nên ta chỉ cần
 * kiểm cùng điều kiện đó trên dữ liệu đã nạp — kết quả y hệt, bớt hàng nghìn
 * vòng mạng.
 */
export interface ShipmentHienTai {
  deliveryStatus: string | null;
  deliveredAt: Date | null;
  deliverySource: string | null;
  trackingNumber: string | null;
  labelCreatedAt: Date | null;
}

/** Lệnh 1 — đóng trạng thái giao. WHERE: chưa 'delivered' (+ đã ship nếu đánh delivered). */
export function canDongTrangThai(dsShipment: ShipmentHienTai[], laDelivered: boolean): boolean {
  return dsShipment.some((s) => {
    if (s.deliveryStatus === 'delivered') return false;
    if (!laDelivered) return true;
    return s.trackingNumber != null || s.labelCreatedAt != null;
  });
}

/** Lệnh 2 — lấp ngày giao còn trống. WHERE: đã 'delivered' và deliveredAt NULL. */
export function canLapNgay(dsShipment: ShipmentHienTai[]): boolean {
  return dsShipment.some((s) => s.deliveryStatus === 'delivered' && s.deliveredAt == null);
}

/** Lệnh 3 — sửa ngày khi ops điền muộn. WHERE: 'delivered', nguồn 'lark', ngày KHÁC. */
export function canSuaNgay(dsShipment: ShipmentHienTai[], ngayThuc: Date | null): boolean {
  if (!ngayThuc) return false;
  return dsShipment.some((s) =>
    s.deliveryStatus === 'delivered' && s.deliverySource === 'lark'
    && s.deliveredAt != null && s.deliveredAt.getTime() !== ngayThuc.getTime());
}
