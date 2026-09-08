import type { ShipHoOrderRow } from './queries';
import { reconcileCellState, type ReconcileCellKind } from './reconcile-decision';

/** Nhãn bộ lọc "Trạng thái đối soát" — đúng 5 mức cột "Đối soát" đang hiện (reconcileCellState). */
export const NHAN_DOI_SOAT: Record<ReconcileCellKind, string> = {
  waiting: 'Chờ bill',
  review: 'Cần đối soát',
  claiming: 'Đang claim',
  done: 'Đã đối soát',
  none: 'Chưa có tracking',
};
export const CAC_MUC_DOI_SOAT: ReconcileCellKind[] = ['waiting', 'review', 'claiming', 'done', 'none'];

/** Đọc giá trị `?doi_soat=` từ URL — sai/rỗng → không lọc. */
export function docMucDoiSoat(v: unknown): ReconcileCellKind | undefined {
  return typeof v === 'string' && (CAC_MUC_DOI_SOAT as string[]).includes(v) ? (v as ReconcileCellKind) : undefined;
}

export interface DongDoiSoat {
  reconcileStatus: string | null;
  reconcileDecision: string | null;
  trackingNumber: string | null;
}

/** THUẦN: giữ dòng có trạng thái đối soát đúng `muc` (cùng luật với badge cột "Đối soát"). */
export function locTheoDoiSoat<T extends DongDoiSoat>(rows: T[], muc: ReconcileCellKind | undefined): T[] {
  if (!muc) return rows;
  return rows.filter((r) => reconcileCellState(r.reconcileStatus, r.reconcileDecision, r.trackingNumber != null).kind === muc);
}

/** THUẦN: giữ dòng của đúng một brand (slug). Rỗng → không lọc. */
export function locTheoBrand<T extends { partnerBrandSlug: string }>(rows: T[], brand: string | undefined): T[] {
  const b = (brand ?? '').trim();
  return b ? rows.filter((r) => r.partnerBrandSlug === b) : rows;
}

/** THUẦN: lọc đơn theo source (nút "Chỉ đơn MMP"), brand, trạng thái đối soát và q
 *  (ILIKE trên code, mã đơn gốc, tracking, tên brand, người nhận). Rỗng → không lọc. */
export function filterShipHoOrders(
  rows: ShipHoOrderRow[],
  opts: { q?: string; source?: 'mmp'; brand?: string; doiSoat?: ReconcileCellKind },
): ShipHoOrderRow[] {
  let out = rows;
  if (opts.source === 'mmp') out = out.filter((r) => r.source === 'mmp');
  out = locTheoBrand(out, opts.brand);
  out = locTheoDoiSoat(out, opts.doiSoat);
  const q = (opts.q ?? '').trim().toLowerCase();
  if (!q) return out;
  const has = (v: string | null | undefined) => (v ?? '').toLowerCase().includes(q);
  return out.filter((r) =>
    has(r.code) || has(r.customerRef) || has(r.trackingNumber) || has(r.brandName) ||
    has(r.partnerBrandSlug) || has(r.recipientName));
}
