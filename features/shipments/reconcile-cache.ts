/**
 * Process-level cache for the reconcile engine output.
 *
 * reconcileShipments() runs the quote engine over EVERY shipment
 * (~2,500 rows ≈ tens of seconds of pure compute) — far too heavy to
 * recompute on every page view. The engine result only changes when
 * shipment/charge data or carrier config changes, so we cache it with
 * a TTL and bust explicitly on ops-file imports. Operator status
 * (đã đối soát / bỏ qua) is merged AFTER the engine pass by the view
 * layer, so marking rows stays instant and never needs a recompute.
 */
import { reconcileShipments, type ReconcileSummary } from './reconcile';

const TTL_MS = 15 * 60 * 1000;

let cached: { result: ReconcileSummary; at: number } | null = null;
let inflight: Promise<ReconcileSummary> | null = null;

/** Drop the cache — call after imports or config edits. */
export function invalidateReconcileCache(): void {
  cached = null;
}

/**
 * Cached engine pass. `force` recomputes immediately (the page's
 * "Tính lại" button). Concurrent callers share one in-flight compute.
 */
export async function getReconcileCached(force = false): Promise<{
  result: ReconcileSummary;
  computedAt: Date;
  fromCache: boolean;
}> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) {
    return { result: cached.result, computedAt: new Date(cached.at), fromCache: true };
  }
  if (!inflight) {
    inflight = reconcileShipments({ topN: 10_000 }).finally(() => { inflight = null; });
  }
  const result = await inflight;
  cached = { result, at: Date.now() };
  return { result, computedAt: new Date(cached.at), fromCache: false };
}
