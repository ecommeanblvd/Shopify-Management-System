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
  /** id shipment — cần để ghi ĐÚNG kiện, không ghi cả đơn. */
  id?: string;
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

/** Trạng thái giao đọc từ Lark — theo một mã vận đơn hoặc gộp cả đơn. */
export interface TrangThaiGiaoLark {
  deliveryState: import('@/lib/fedex/track').DeliveryStatus | null;
  actualDeliveredAt: Date | null;
  expectedDeliveryDate: Date | null;
}

/**
 * Chọn trạng thái giao Lark áp cho MỘT kiện (CEO 16/09/2026).
 *
 * Lark ghi mỗi mã vận đơn một dòng, mỗi dòng có "Ngày giao thực tế" riêng. Trước đây bước đồng
 * bộ gộp mọi dòng của đơn thành MỘT trạng thái rồi ghi vào MỌI kiện — đơn tách kiện vì vậy bị
 * gán ngày giao của kiện cuối cho cả kiện đầu (#MBLVD29942: kiện gửi 20/08, giao thật 24/08,
 * bị ghi 10/09), và SLA đo thành trễ oan.
 *
 * Luật: có dòng Lark trùng mã vận đơn → dùng đúng dòng đó. Không có thì chỉ dùng trạng thái cả
 * đơn khi đơn CHỈ CÓ MỘT kiện — nhiều kiện mà không biết dòng nào của kiện nào thì bỏ qua, để
 * tra vận đơn của hãng điền ngày thật.
 */
export function chonTrangThaiChoKien(
  kien: Pick<ShipmentHienTai, 'trackingNumber'>,
  soKienCuaDon: number,
  theoTracking: ReadonlyMap<string, TrangThaiGiaoLark>,
  cuaDon: TrangThaiGiaoLark | undefined,
): TrangThaiGiaoLark | null {
  const tk = kien.trackingNumber?.trim();
  if (tk && theoTracking.has(tk)) return theoTracking.get(tk)!;
  if (soKienCuaDon === 1 && cuaDon) return cuaDon;
  return null;
}
