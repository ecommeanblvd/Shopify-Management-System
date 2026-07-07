import type { ShipHoOrderRow } from './queries';

/** THUẦN: lọc đơn theo source (nút "Chỉ đơn MMP") và q (ILIKE trên code, mã đơn
 *  gốc, tracking, tên brand, người nhận). Rỗng → không lọc. */
export function filterShipHoOrders(
  rows: ShipHoOrderRow[],
  opts: { q?: string; source?: 'mmp' },
): ShipHoOrderRow[] {
  let out = rows;
  if (opts.source === 'mmp') out = out.filter((r) => r.source === 'mmp');
  const q = (opts.q ?? '').trim().toLowerCase();
  if (!q) return out;
  const has = (v: string | null | undefined) => (v ?? '').toLowerCase().includes(q);
  return out.filter((r) =>
    has(r.code) || has(r.customerRef) || has(r.trackingNumber) || has(r.brandName) ||
    has(r.partnerBrandSlug) || has(r.recipientName));
}
