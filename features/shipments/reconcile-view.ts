/**
 * View layer over reconcileShipments(): joins operator-set reconcile
 * status and derives display-only fields (net base, change flag).
 * Kept separate from the pure-compute reconcile.ts so the engine math
 * stays status-agnostic and unit-testable.
 */
import { db, schema } from '@/db/client';
import { eq, inArray, isNotNull, and } from 'drizzle-orm';
import {
  type ReconcileRow,
  type ReconcileSummary,
} from './reconcile';
import { getReconcileCached } from './reconcile-cache';
import {
  compareBilledVsFedexQuote,
  type FedexQuoteSnap,
  type QuoteCompare,
} from './fedex-quote-compare';

export type ReconcileStatus = 'pending' | 'reconciled' | 'ignored' | 'carrier_error' | 'disputing' | 'internal_error';

/** Dưới ngưỡng này coi như billed ≈ engine (đã khớp). Tổng cước một đơn
 *  thường 600k–900k ₫ nên 1.000 ₫ (~0.1%) là sai số làm tròn, không phải lệch thật. */
export const STALE_DISPUTE_TOLERANCE_VND = 1000;

export interface StatusRecord {
  status: 'reconciled' | 'ignored' | 'carrier_error' | 'disputing' | 'internal_error';
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
  /** Khiếu nại đã hết hiệu lực: đang `disputing` nhưng Δ hiện tại đã về ~0
   *  (thường do bổ sung/sửa engine sau lúc duyệt) → NCC thực ra tính đúng,
   *  nên rút khiếu nại thay vì đi đòi. */
  staleDispute: boolean;
  /** Carrier có tính demand (billedDemand>0) nhưng engine áp 0 dù ĐÃ tính
   *  được (engineTotal≠null) → thường do nước đích chưa nằm trong country_codes
   *  của dòng demand nào. Cờ này để gap không âm thầm lọt như vụ DHL/EU. */
  demandUncovered: boolean;
  /** billedBase + billedDiscount (discount stored negative). Avoids the
   *  list-base/discount display artifact — see spec §3.6. */
  billedBaseNet: number | null;
  engineBaseNet: number | null;
  /** Giá hợp đồng FedEx (Rate API, đã cache) + so per-dòng với billed.
   *  null khi chưa quote (đơn DHL, hoặc FedEx chưa backfill). */
  fedexQuote: FedexQuoteSnap | null;
  fedexCompare: QuoteCompare | null;
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

export type { CarrierWeightCell } from './reconcile-cells';
export { carrierWeightCell } from './reconcile-cells';

/** Merge a status map (keyed by shipmentId) onto reconcile rows. */
export function mergeStatus(
  rows: ReconcileRow[],
  statusByShipment: Map<string, StatusRecord>,
): ReconcileViewRow[] {
  return rows.map((r) => {
    const rec = statusByShipment.get(r.shipmentId);
    const billedChangedSinceReview =
      rec?.billedTotalAtReview != null && rec.billedTotalAtReview !== r.billedTotal;
    // Stale = lúc duyệt từng lệch thật (≥ ngưỡng) nhưng Δ hiện tại đã về ~0.
    // Loại trừ khiếu nại cố ý một khoản nhỏ (Δ lúc duyệt vốn đã < ngưỡng).
    const staleDispute =
      rec?.status === 'disputing' &&
      r.deltaVnd !== null &&
      Math.abs(r.deltaVnd) < STALE_DISPUTE_TOLERANCE_VND &&
      rec.deltaVndAtReview !== null &&
      rec.deltaVndAtReview !== undefined &&
      Math.abs(rec.deltaVndAtReview) >= STALE_DISPUTE_TOLERANCE_VND;
    const demandUncovered =
      r.engineTotal !== null &&
      r.billedDemand !== null &&
      r.billedDemand > 0 &&
      (r.engineDemand === null || r.engineDemand === 0);
    return {
      ...r,
      status: (rec?.status ?? 'pending') as ReconcileStatus,
      note: rec?.note ?? null,
      carrierErrorKind: rec?.carrierErrorKind ?? null,
      deltaVndAtReview: rec?.deltaVndAtReview ?? null,
      billedChangedSinceReview,
      staleDispute,
      demandUncovered,
      billedBaseNet: netBase(r.billedBase, r.billedDiscount),
      engineBaseNet: r.engineBase,
      fedexQuote: null, // gắn ở loader (reconcileShipmentsWithStatus)
      fedexCompare: null,
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

  // Gắn FedEx-quote (giá hợp đồng, đã cache) + so per-dòng với billed.
  const num = (v: string | null) => (v !== null ? Number(v) : null);
  const quoteRows = await db
    .select({
      shipmentId: schema.fedexRateQuotes.shipmentId, service: schema.fedexRateQuotes.service,
      totalNetCharge: schema.fedexRateQuotes.totalNetCharge, fuel: schema.fedexRateQuotes.fuel,
      fuelPercent: schema.fedexRateQuotes.fuelPercent, remote: schema.fedexRateQuotes.remote,
      demand: schema.fedexRateQuotes.demand, residential: schema.fedexRateQuotes.residential,
      signature: schema.fedexRateQuotes.signature, countryFixed: schema.fedexRateQuotes.countryFixed,
      vat: schema.fedexRateQuotes.vat, discount: schema.fedexRateQuotes.discount,
      rateZone: schema.fedexRateQuotes.rateZone,
    })
    .from(schema.fedexRateQuotes);
  const quoteMap = new Map<string, FedexQuoteSnap>();
  for (const q of quoteRows) {
    quoteMap.set(q.shipmentId, {
      service: q.service, totalNetCharge: num(q.totalNetCharge), fuel: num(q.fuel),
      fuelPercent: num(q.fuelPercent), remote: num(q.remote), demand: num(q.demand),
      residential: num(q.residential), signature: num(q.signature), countryFixed: num(q.countryFixed),
      vat: num(q.vat), discount: num(q.discount), rateZone: q.rateZone,
    });
  }
  for (const r of rows) {
    const fq = quoteMap.get(r.shipmentId);
    if (!fq) continue;
    r.fedexQuote = fq;
    r.fedexCompare = compareBilledVsFedexQuote(
      { total: r.billedTotal, fuel: r.billedFuel, remote: r.billedRemote, demand: r.billedDemand, signature: r.billedSignature, vat: r.billedVat },
      fq,
    );
  }

  return { summary, rows, computedAt };
}

/** shipmentId -> bill có PDF (để hiện link PDF theo tracking ở đối soát). Trả {accountId,billId}. */
export async function pdfBillByShipment(shipmentIds: string[]): Promise<Record<string, { accountId: string; billId: string }>> {
  if (shipmentIds.length === 0) return {};
  const rows = await db
    .select({ shipmentId: schema.carrierBillLines.shipmentId, billId: schema.carrierBills.id, accountId: schema.carrierBills.carrierAccountId })
    .from(schema.carrierBillLines)
    .innerJoin(schema.carrierBills, eq(schema.carrierBillLines.billId, schema.carrierBills.id))
    .where(and(
      inArray(schema.carrierBillLines.shipmentId, shipmentIds),
      isNotNull(schema.carrierBillLines.shipmentId),
      isNotNull(schema.carrierBills.pdfFileKey),
    ));
  const out: Record<string, { accountId: string; billId: string }> = {};
  for (const r of rows) if (r.shipmentId) out[r.shipmentId] = { accountId: r.accountId, billId: r.billId };
  return out;
}
