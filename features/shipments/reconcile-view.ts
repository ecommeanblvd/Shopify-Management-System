/**
 * View layer over reconcileShipments(): joins operator-set reconcile
 * status and derives display-only fields (net base, change flag).
 * Kept separate from the pure-compute reconcile.ts so the engine math
 * stays status-agnostic and unit-testable.
 */
import { db, schema } from '@/db/client';
import {
  reconcileShipments,
  type ReconcileRow,
  type ReconcileSummary,
} from './reconcile';

export type ReconcileStatus = 'pending' | 'reconciled' | 'ignored';

export interface StatusRecord {
  status: 'reconciled' | 'ignored';
  note: string | null;
  billedTotalAtReview: number | null;
}

export interface ReconcileViewRow extends ReconcileRow {
  status: ReconcileStatus;
  note: string | null;
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
  opts: ReconcileViewOptions = {},
): Promise<ReconcileView> {
  const summary = await reconcileShipments({ ...opts, topN: 1_000_000 });

  const statusRows = await db
    .select({
      shipmentId: schema.shipmentReconcileStatus.shipmentId,
      status: schema.shipmentReconcileStatus.status,
      note: schema.shipmentReconcileStatus.note,
      billedTotalAtReview: schema.shipmentReconcileStatus.billedTotalAtReview,
    })
    .from(schema.shipmentReconcileStatus);

  const map = new Map<string, StatusRecord>();
  for (const s of statusRows) {
    map.set(s.shipmentId, {
      status: s.status,
      note: s.note,
      billedTotalAtReview: s.billedTotalAtReview !== null ? Number(s.billedTotalAtReview) : null,
    });
  }

  return { summary, rows: mergeStatus(summary.rows, map) };
}
