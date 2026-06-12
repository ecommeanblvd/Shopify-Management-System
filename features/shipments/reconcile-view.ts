/**
 * View layer over reconcileShipments(): joins operator-set reconcile
 * status and derives display-only fields (net base, change flag).
 * Kept separate from the pure-compute reconcile.ts so the engine math
 * stays status-agnostic and unit-testable.
 */
import { db, schema } from '@/db/client';
import {
  type ReconcileRow,
  type ReconcileSummary,
} from './reconcile';
import { getReconcileCached } from './reconcile-cache';

export type ReconcileStatus = 'pending' | 'reconciled' | 'ignored' | 'carrier_error' | 'disputing';

export interface StatusRecord {
  status: 'reconciled' | 'ignored' | 'carrier_error' | 'disputing';
  note: string | null;
  billedTotalAtReview: number | null;
  carrierErrorKind?: string | null;
  deltaVndAtReview?: number | null;
}

export interface ReconcileViewRow extends ReconcileRow {
  status: ReconcileStatus;
  note: string | null;
  carrierErrorKind: string | null;
  deltaVndAtReview: number | null;
  billedChangedSinceReview: boolean;
  /** billedBase + billedDiscount (discount stored negative). Avoids the
   *  list-base/discount display artifact — see spec §3.6. */
  billedBaseNet: number | null;
  engineBaseNet: number | null;
}

export interface ReconcileView {
  summary: ReconcileSummary;
  rows: ReconcileViewRow[];
}

/** Net the (negative) discount into the list base. */
export function netBase(base: number | null, discount: number | null): number | null {
  if (base === null) return null;
  return base + (discount ?? 0);
}

/** Merge a status map (keyed by shipmentId) onto reconcile rows. */
export function mergeStatus(
  rows: ReconcileRow[],
  statusByShipment: Map<string, StatusRecord>,
): ReconcileViewRow[] {
  return rows.map((r) => {
    const rec = statusByShipment.get(r.shipmentId);
    const billedChangedSinceReview =
      rec?.billedTotalAtReview != null && rec.billedTotalAtReview !== r.billedTotal;
    return {
      ...r,
      status: (rec?.status ?? 'pending') as ReconcileStatus,
      note: rec?.note ?? null,
      carrierErrorKind: rec?.carrierErrorKind ?? null,
      deltaVndAtReview: rec?.deltaVndAtReview ?? null,
      billedChangedSinceReview,
      billedBaseNet: netBase(r.billedBase, r.billedDiscount),
      engineBaseNet: r.engineBase,
    };
  });
}

interface ReconcileViewOptions {
  carrierKey?: 'fedex' | 'dhl';
  fromDate?: Date;
  toDate?: Date;
}

/** Load all reconcile rows (no topN cap) joined with status. */
export async function reconcileShipmentsWithStatus(
  opts: ReconcileViewOptions & { forceRecompute?: boolean } = {},
): Promise<ReconcileView & { computedAt: Date }> {
  // Engine pass is cached (15-min TTL, busted on import) — the status
  // join below always runs fresh so marking rows reflects instantly.
  const { result: summary, computedAt } = await getReconcileCached(opts.forceRecompute ?? false);

  const statusRows = await db
    .select({
      shipmentId: schema.shipmentReconcileStatus.shipmentId,
      status: schema.shipmentReconcileStatus.status,
      note: schema.shipmentReconcileStatus.note,
      billedTotalAtReview: schema.shipmentReconcileStatus.billedTotalAtReview,
      carrierErrorKind: schema.shipmentReconcileStatus.carrierErrorKind,
      deltaVndAtReview: schema.shipmentReconcileStatus.deltaVndAtReview,
    })
    .from(schema.shipmentReconcileStatus);

  const map = new Map<string, StatusRecord>();
  for (const s of statusRows) {
    map.set(s.shipmentId, {
      status: s.status,
      note: s.note,
      billedTotalAtReview: s.billedTotalAtReview !== null ? Number(s.billedTotalAtReview) : null,
      carrierErrorKind: s.carrierErrorKind ?? null,
      deltaVndAtReview: s.deltaVndAtReview !== null ? Number(s.deltaVndAtReview) : null,
    });
  }

  // The cache always holds the FULL fleet; per-request filters (CSV
  // export's carrier/date params) apply post-hoc on the cached rows.
  let rows = mergeStatus(summary.rows, map);
  if (opts.carrierKey) rows = rows.filter((r) => r.carrierKey === opts.carrierKey);
  if (opts.fromDate) rows = rows.filter((r) => !r.labelDate || r.labelDate >= opts.fromDate!);
  if (opts.toDate) rows = rows.filter((r) => !r.labelDate || r.labelDate <= opts.toDate!);
  return { summary, rows, computedAt };
}
