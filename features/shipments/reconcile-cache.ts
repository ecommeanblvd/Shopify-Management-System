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
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { reconcileShipments, type ReconcileSummary } from './reconcile';

const TTL_MS = 15 * 60 * 1000;

export interface CacheEntryMeta {
  /** When this entry was computed (app clock, ms). */
  at: number;
  /** MAX(updated_at) of carrier config tables seen at compute time (DB clock, ms).
   *  A newer value means config changed → recompute. */
  configVersion: number;
}

let cached: ({ result: ReconcileSummary } & CacheEntryMeta) | null = null;
let inflight: Promise<ReconcileSummary> | null = null;

/** Drop the in-process cache — fast path after same-process imports. */
export function invalidateReconcileCache(): void {
  cached = null;
}

/**
 * Pure staleness decision (TDD). Stale when: no cache, the carrier config
 * changed since the cache was built (configVersion moved), or the TTL expired.
 * Comparing configVersion (DB time) to configVersion (DB time) is clock-skew-proof.
 */
export function isReconcileCacheStale(
  entry: CacheEntryMeta | null,
  currentConfigVersion: number,
  nowMs: number,
  ttlMs: number,
): boolean {
  if (!entry) return true;
  if (entry.configVersion !== currentConfigVersion) return true;
  if (nowMs - entry.at >= ttlMs) return true;
  return false;
}

/** Latest carrier-config change time (ms): MAX(updated_at) of carrier_surcharges
 *  (operator edits fuel/ER/GoGreen/… here — bumped via $onUpdate) GREATEST with
 *  MAX(created_at) of carrier_rate_cards (no updated_at column; a new rate card
 *  is an insert). Any change moves it → auto-busts the cache so the reconcile
 *  reflects new config WITHOUT a manual "Tính lại". 0 when both empty. */
async function latestConfigVersion(): Promise<number> {
  const res = await db.execute(sql`
    select greatest(
      coalesce((select max(updated_at) from carrier_surcharges), 'epoch'::timestamp),
      coalesce((select max(created_at) from carrier_rate_cards), 'epoch'::timestamp)
    ) as v`);
  const v = (res.rows ?? (res as unknown as Array<{ v: unknown }>))[0]?.v;
  return v ? new Date(v as string).getTime() : 0;
}

/**
 * Cached engine pass. `force` recomputes immediately (the page's "Tính lại"
 * button). Otherwise served from cache unless stale (config changed → auto
 * recompute, or TTL expired). Concurrent callers share one in-flight compute.
 */
export async function getReconcileCached(force = false): Promise<{
  result: ReconcileSummary;
  computedAt: Date;
  fromCache: boolean;
}> {
  const configVersion = await latestConfigVersion();
  if (!force && !isReconcileCacheStale(cached, configVersion, Date.now(), TTL_MS)) {
    return { result: cached!.result, computedAt: new Date(cached!.at), fromCache: true };
  }
  if (!inflight) {
    inflight = reconcileShipments({ topN: 10_000 }).finally(() => { inflight = null; });
  }
  const result = await inflight;
  cached = { result, at: Date.now(), configVersion };
  return { result, computedAt: new Date(cached.at), fromCache: false };
}
