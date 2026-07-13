import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export interface UnmatchedBilledRow {
  tracking: string; billNumber: string | null; carrierKey: string | null;
  accountId: string; accountName: string; amountVnd: number | null; billPeriodStart: string | null;
  /** Tracking thuộc đơn SHIP HỘ (mã đơn) — không phải "lạ", đối soát ở module Ship hộ. */
  shipHoCode: string | null;
}
export interface UnmatchedSummary { total: number; byCarrier: Array<{ carrierKey: string | null; count: number; sumVnd: number }> }

/** Gom theo carrier (thứ tự xuất hiện đầu): count + Σ amount. THUẦN. */
export function summariseUnmatched(rows: UnmatchedBilledRow[]): UnmatchedSummary {
  const map = new Map<string | null, { carrierKey: string | null; count: number; sumVnd: number }>();
  for (const r of rows) {
    const cur = map.get(r.carrierKey) ?? { carrierKey: r.carrierKey, count: 0, sumVnd: 0 };
    cur.count += 1;
    cur.sumVnd += r.amountVnd ?? 0;
    map.set(r.carrierKey, cur);
  }
  return { total: rows.length, byCarrier: [...map.values()] };
}

/** Tracking trên hoá đơn carrier KHÔNG khớp shipment nào (distinct theo tracking). */
export async function listUnmatchedBilledTracking(): Promise<UnmatchedBilledRow[]> {
  const raw = await db
    .select({
      tracking: schema.carrierBillLines.trackingNumber,
      total: schema.carrierBillLines.total,
      billNumber: schema.carrierBills.billNumber,
      billPeriodStart: schema.carrierBills.periodStart,
      accountId: schema.carrierAccounts.id,
      accountName: schema.carrierAccounts.name,
      carrierKey: schema.carriers.key,
      shipHoCode: schema.shipHoOrders.code,
    })
    .from(schema.carrierBillLines)
    .leftJoin(schema.shipments, eq(schema.shipments.trackingNumber, schema.carrierBillLines.trackingNumber))
    .leftJoin(schema.shipHoOrders, eq(schema.shipHoOrders.trackingNumber, schema.carrierBillLines.trackingNumber))
    .innerJoin(schema.carrierBills, eq(schema.carrierBills.id, schema.carrierBillLines.billId))
    .innerJoin(schema.carrierAccounts, eq(schema.carrierAccounts.id, schema.carrierBills.carrierAccountId))
    .innerJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(and(isNotNull(schema.carrierBillLines.trackingNumber), isNull(schema.shipments.id)))
    // id là tie-breaker ổn định: 1 tracking có nhiều dòng bill → luôn chọn cùng 1 dòng đại diện.
    .orderBy(asc(schema.carrierAccounts.name), asc(schema.carrierBillLines.trackingNumber), asc(schema.carrierBillLines.id));

  // Distinct theo tracking (1 dòng/tracking — dòng đầu đại diện).
  const seen = new Set<string>();
  const out: UnmatchedBilledRow[] = [];
  for (const r of raw) {
    const t = r.tracking as string; // isNotNull đã lọc
    if (seen.has(t)) continue;
    seen.add(t);
    out.push({
      tracking: t,
      billNumber: r.billNumber ?? null,
      carrierKey: r.carrierKey ?? null,
      accountId: r.accountId,
      accountName: r.accountName,
      amountVnd: r.total !== null ? Number(r.total) : null,
      billPeriodStart: r.billPeriodStart ?? null,
      shipHoCode: r.shipHoCode ?? null,
    });
  }
  return out;
}
