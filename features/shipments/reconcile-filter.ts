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
  // Tiền-billed: chưa có hoá đơn carrier. Phải xử TRƯỚC isAutoReconciled —
  // deltaVnd null khiến Math.abs(0) < tolerance, sẽ bị nuốt thành 'reconciled'.
  if (r.billedTotal === null && r.status === 'pending') {
    return r.engineReason === 'no_weight' ? 'awaiting_measurement' : 'awaiting_billed';
  }
  if (isAutoReconciled(r) || r.staleDispute) return 'reconciled';
  return r.status;
}

export interface ReconcileFilters {
  carrier: 'all' | 'fedex' | 'dhl' | 'aramex';
  status: 'all' | 'pending' | 'reconciled' | 'ignored' | 'carrier_error' | 'disputing' | 'internal_error' | 'credited' | 'accepted' | 'awaiting_measurement' | 'awaiting_billed';
  country: string;
  minPct: string;
  q: string;
}

/** Thời điểm để sort "mới nhất" — ngày ship/label. null → cũ nhất (−∞). */
function rowTime(r: ReconcileViewRow): number {
  return r.labelDate ? r.labelDate.getTime() : -Infinity;
}

/** Trạng thái "chưa đối soát" — xếp lên đầu. Gồm pending billed + 2 trạng thái tiền-billed. */
const PENDING_GROUP = new Set<ReconcileStatus>(['pending', 'awaiting_measurement', 'awaiting_billed']);

/** Lọc + sort: (1) CHƯA đối soát (pending) lên đầu, (2) đơn MỚI NHẤT (ngày ship)
 *  → cũ nhất. Mức lệch (|delta|) KHÔNG còn là sort mặc định — chỉ là filter "Lệch ≥ %". */
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
    .sort((a, b) => {
      const pa = PENDING_GROUP.has(effStatus(a)) ? 0 : 1;
      const pb = PENDING_GROUP.has(effStatus(b)) ? 0 : 1;
      if (pa !== pb) return pa - pb;          // chưa đối soát lên đầu
      return rowTime(b) - rowTime(a);         // rồi mới nhất → cũ nhất
    });
}

export interface ReconcileSummaryStat {
  billed: number; engine: number; delta: number; pct: number;
  over10: number; pendingCount: number; disputingCount: number; n: number;
}

/** Σ billed/engine/delta + đếm (đơn auto-reconciled fold engine=billed để Σ Lệch
 *  không phình vì pass-through; over10/pendingCount chỉ đếm đơn CÒN pending).
 *  Dòng chưa có hoá đơn carrier (billedTotal === null) bị loại khỏi Σ tiền VÀ
 *  khỏi pendingCount/disputingCount — chỉ tính vào n (đếm riêng qua countByEffStatus). */
export function reconcileSummary(rows: ReconcileViewRow[]): ReconcileSummaryStat {
  let billed = 0, engine = 0, over10 = 0, pendingCount = 0, disputingCount = 0;
  for (const r of rows) {
    if (r.billedTotal == null) {
      // Pre-billed (chưa có hoá đơn carrier): không vào số liệu tiền, cũng không
      // vào pendingCount/disputingCount — đếm riêng qua countByEffStatus (dòng summary).
      continue;
    }
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

/** Đếm số dòng theo trạng thái hiệu lực (effStatus). Dùng cho dòng summary. */
export function countByEffStatus(rows: ReconcileViewRow[]): Record<ReconcileStatus, number> {
  const c: Record<ReconcileStatus, number> = {
    pending: 0, reconciled: 0, ignored: 0, carrier_error: 0, disputing: 0,
    internal_error: 0, credited: 0, accepted: 0, awaiting_measurement: 0, awaiting_billed: 0,
  };
  for (const r of rows) c[effStatus(r)] += 1;
  return c;
}

/** Slice trang hiện tại; safePage kẹp [0, totalPages-1]. */
export function paginate<T>(rows: T[], page: number, size: number): { pageRows: T[]; totalPages: number; safePage: number } {
  const totalPages = Math.max(1, Math.ceil(rows.length / size));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  return { pageRows: rows.slice(safePage * size, (safePage + 1) * size), totalPages, safePage };
}
