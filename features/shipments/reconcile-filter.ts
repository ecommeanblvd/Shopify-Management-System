/**
 * Lọc / summary / phân trang cho bảng đối soát — THUẦN (no I/O), dùng chung
 * server (page) + client (table). Chỉ `import type` từ reconcile-view nên KHÔNG
 * kéo db/client vào client bundle. Semantics giữ NGUYÊN từ ReconcileTable cũ.
 */
import type { ReconcileViewRow, ReconcileStatus } from './reconcile-view';

/** Ngưỡng "khớp hoàn toàn" — trùng ngưỡng KHỚP của engine (lệch nhỏ do làm tròn). */
export const MATCH_TOLERANCE_VND = 1000;

/** Đơn pending NHƯNG lệch < ngưỡng (hoặc diagnose passthrough/match) → coi như tự
 *  đối soát (không cần người xác nhận). */
export function isAutoReconciled(r: ReconcileViewRow): boolean {
  if (r.status !== 'pending') return false;
  if (Math.abs(r.deltaVnd ?? 0) < MATCH_TOLERANCE_VND) return true;
  return r.diagnosis?.severity === 'passthrough' || r.diagnosis?.severity === 'match';
}

/** Trạng thái HIỆU DỤNG cho view: đơn khớp-pending hoặc disputing-đã-khớp-lại →
 *  'reconciled'; còn lại giữ status gốc. */
export function effStatus(r: ReconcileViewRow): ReconcileStatus {
  if (isAutoReconciled(r) || r.staleDispute) return 'reconciled';
  return r.status;
}

export interface ReconcileFilters {
  carrier: 'all' | 'fedex' | 'dhl';
  status: 'all' | 'pending' | 'reconciled' | 'ignored' | 'carrier_error' | 'disputing' | 'internal_error';
  country: string;
  minPct: string;
  q: string;
}

/** Lọc + sort theo |deltaVnd| giảm dần (giữ nguyên chuỗi filter của bảng cũ). */
export function filterReconcileRows(rows: ReconcileViewRow[], f: ReconcileFilters): ReconcileViewRow[] {
  const minAbs = f.minPct ? Number(f.minPct) : null;
  const needle = f.q.trim().toLowerCase();
  return rows
    .filter((r) => f.carrier === 'all' || r.carrierKey === f.carrier)
    .filter((r) => f.status === 'all' || effStatus(r) === f.status)
    .filter((r) => !f.country || r.shipCountry.toLowerCase() === f.country.toLowerCase())
    .filter((r) => minAbs === null || (r.deltaPct !== null && Math.abs(r.deltaPct) >= minAbs))
    .filter((r) =>
      !needle ||
      r.orderNumber.toLowerCase().includes(needle) ||
      r.trackingNumber.toLowerCase().includes(needle),
    )
    .sort((a, b) => Math.abs(b.deltaVnd ?? 0) - Math.abs(a.deltaVnd ?? 0));
}

export interface ReconcileSummaryStat {
  billed: number; engine: number; delta: number; pct: number;
  over10: number; pendingCount: number; disputingCount: number; n: number;
}

/** Σ billed/engine/delta + đếm (đơn auto-reconciled fold engine=billed để Σ Lệch
 *  không phình vì pass-through; over10/pendingCount chỉ đếm đơn CÒN pending). */
export function reconcileSummary(rows: ReconcileViewRow[]): ReconcileSummaryStat {
  let billed = 0, engine = 0, over10 = 0, pendingCount = 0, disputingCount = 0;
  for (const r of rows) {
    billed += r.billedTotal;
    engine += isAutoReconciled(r) ? r.billedTotal : (r.engineTotal ?? 0);
    const isPending = effStatus(r) === 'pending';
    if (isPending && r.deltaPct !== null && Math.abs(r.deltaPct) > 10) over10 += 1;
    if (isPending) pendingCount += 1;
    if (r.status === 'disputing' && !r.staleDispute) disputingCount += 1;
  }
  const delta = billed - engine;
  const pct = billed > 0 ? (delta / billed) * 100 : 0;
  return { billed, engine, delta, pct, over10, pendingCount, disputingCount, n: rows.length };
}

/** Slice trang hiện tại; safePage kẹp [0, totalPages-1]. */
export function paginate<T>(rows: T[], page: number, size: number): { pageRows: T[]; totalPages: number; safePage: number } {
  const totalPages = Math.max(1, Math.ceil(rows.length / size));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  return { pageRows: rows.slice(safePage * size, (safePage + 1) * size), totalPages, safePage };
}
