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
  status: 'all' | 'pending' | 'reconciled' | 'ignored' | 'carrier_error' | 'disputing' | 'internal_error' | 'credited' | 'accepted';
  country: string;
  minPct: string;
  q: string;
}

/** Thời điểm để sort "mới nhất" — ngày ship/label. null → cũ nhất (−∞). */
function rowTime(r: ReconcileViewRow): number {
  return r.labelDate ? r.labelDate.getTime() : -Infinity;
}

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
      const pa = effStatus(a) === 'pending' ? 0 : 1;
      const pb = effStatus(b) === 'pending' ? 0 : 1;
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
 *  Dòng chưa có hoá đơn carrier (billedTotal === null) bị loại khỏi Σ tiền nhưng
 *  vẫn được đếm vào pendingCount/disputingCount/n. */
export function reconcileSummary(rows: ReconcileViewRow[]): ReconcileSummaryStat {
  let billed = 0, engine = 0, over10 = 0, pendingCount = 0, disputingCount = 0;
  for (const r of rows) {
    if (r.billedTotal == null) {
      // pre-billed (chưa có hoá đơn carrier) — không vào số liệu tiền
      const isPendingPre = effStatus(r) === 'pending';
      if (isPendingPre) pendingCount += 1;
      if (r.status === 'disputing' && !r.staleDispute) disputingCount += 1;
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

/** Slice trang hiện tại; safePage kẹp [0, totalPages-1]. */
export function paginate<T>(rows: T[], page: number, size: number): { pageRows: T[]; totalPages: number; safePage: number } {
  const totalPages = Math.max(1, Math.ceil(rows.length / size));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  return { pageRows: rows.slice(safePage * size, (safePage + 1) * size), totalPages, safePage };
}
