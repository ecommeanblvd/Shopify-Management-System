/**
 * THUẦN: lọc đơn theo khoảng ngày trên MỘT trong hai mốc (CEO 10/09/2026):
 *  - 'order' — ngày phát sinh đơn (`processed_at_shopify`);
 *  - 'ship'  — ngày gửi hàng (pack sớm nhất có `shipments.label_created_at`); đơn chưa có ngày gửi thì KHÔNG nằm trong
 *    khoảng nào (chưa gửi thì chưa tính doanh số theo ngày gửi).
 * Khoảng [from, to] là ngày ISO, so theo giờ máy người xem — cùng cách bảng KPI đã lọc cache phía client từ trước.
 */
export type MocLoc = 'order' | 'ship';

export const NHAN_MOC: Record<MocLoc, string> = { order: 'Ngày đặt hàng', ship: 'Ngày gửi hàng' };

export const laMocLoc = (v: unknown): v is MocLoc => v === 'order' || v === 'ship';

export function mocCuaDon(o: { processedAt: Date | string; shippedAt: Date | string | null }, moc: MocLoc): Date | null {
  const v = moc === 'ship' ? o.shippedAt : o.processedAt;
  if (v == null) return null;
  return v instanceof Date ? v : new Date(v);
}

export function trongKhoang(o: { processedAt: Date | string; shippedAt: Date | string | null }, from: string, to: string, moc: MocLoc): boolean {
  const d = mocCuaDon(o, moc);
  if (!d) return false;
  const t = d.getTime();
  return t >= new Date(`${from}T00:00:00`).getTime() && t <= new Date(`${to}T23:59:59.999`).getTime();
}
