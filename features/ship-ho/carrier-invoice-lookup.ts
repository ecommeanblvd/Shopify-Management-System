/**
 * Lookup số THỰC từ hoá đơn carrier đã upload (carrier_bill_lines) theo tracking,
 * để re-bill đơn ship hộ: cân thực, cước thực (VND), phụ phí thực.
 *
 * `normalizeBilledLine` THUẦN (test được); `getBilledByTracking` là I/O thin wrapper.
 */
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export interface BilledSurcharges {
  base: number; discount: number; fuel: number; remote: number;
  /** Ký nhận (direct signature) — ĐÃ tách residential ra. */
  demand: number; signature: number; vat: number; other: number;
  /** Giao nhà dân (residential address) — tách riêng khỏi signature để đối soát
   *  rõ khoản nào thu thiếu. Nguồn: shipment_charges.residential (import ghi riêng). */
  residential: number;
}

export interface BilledLookup {
  weightKg: number | null;
  totalVnd: number;
  surcharges: BilledSurcharges;
  billNumber: string | null;
  shipDate: string | null; // 'YYYY-MM-DD'
}

/** Dòng bill thô (numeric lưu dạng string|null trong Postgres). */
export interface RawBillLine {
  weightKg: string | null;
  base: string | null; discount: string | null; fuel: string | null; remote: string | null;
  demand: string | null; signature: string | null; vat: string | null; other: string | null;
  total: string | null;
  shipDate: string | null;
  /** Residential (Giao nhà dân) từ shipment_charges — carrier_bill_lines.signature
   *  GỘP cả residential, nên tách ra đây rồi trừ khỏi signature. null = không có. */
  residentialRaw?: string | null;
}

const num = (s: string | null | undefined): number => (s == null || s === '' ? 0 : Number(s) || 0);

/**
 * Quy 1 dòng bill (theo COST currency của account) về VND theo `factor`
 * (costCurrency==='VND' → 1). Trả cân, tổng cước VND, và phụ phí VND.
 *
 * `signature` trên carrier_bill_lines GỘP cả residential (Giao nhà dân) + direct
 * signature (ký nhận). Ta tách residential ra (nguồn shipment_charges) → cột
 * `residential` riêng và `signature` chỉ còn ký nhận. Tổng phụ phí KHÔNG đổi.
 */
export function normalizeBilledLine(raw: RawBillLine, vndFactor: number, billNumber: string | null): BilledLookup {
  const s = (v: string | null | undefined) => Math.round(num(v) * vndFactor);
  const residential = s(raw.residentialRaw);
  // signature phẳng đã gộp residential → trừ ra (kẹp ≥0 phòng lệch làm tròn).
  const signature = Math.max(0, s(raw.signature) - residential);
  return {
    weightKg: raw.weightKg == null || raw.weightKg === '' ? null : Number(raw.weightKg),
    totalVnd: s(raw.total),
    surcharges: {
      base: s(raw.base), discount: s(raw.discount), fuel: s(raw.fuel), remote: s(raw.remote),
      demand: s(raw.demand), signature, residential, vat: s(raw.vat), other: s(raw.other),
    },
    billNumber,
    shipDate: raw.shipDate,
  };
}

/** COST currency → VND. costCurrency VND → 1; displayCurrency VND → 1/fx; khác → null. */
export function costToVndFactor(costCurrency: string, displayCurrency: string, fxCostPerDisplay: number): number | null {
  if (costCurrency === 'VND') return 1;
  if (displayCurrency === 'VND') return 1 / fxCostPerDisplay;
  return null;
}

/**
 * Tìm dòng hoá đơn carrier khớp tracking. Ưu tiên dòng có total (đã parse đủ),
 * mới nhất (theo bill period). Trả null nếu chưa có bill nào cho tracking này.
 */
export async function getBilledByTracking(trackingNumber: string): Promise<BilledLookup | null> {
  if (!trackingNumber) return null;
  const [row] = await db
    .select({
      weightKg: schema.carrierBillLines.weightKg,
      base: schema.carrierBillLines.base, discount: schema.carrierBillLines.discount,
      fuel: schema.carrierBillLines.fuel, remote: schema.carrierBillLines.remote,
      demand: schema.carrierBillLines.demand, signature: schema.carrierBillLines.signature,
      vat: schema.carrierBillLines.vat, other: schema.carrierBillLines.other,
      total: schema.carrierBillLines.total, shipDate: schema.carrierBillLines.shipDate,
      billNumber: schema.carrierBills.billNumber,
      costCurrency: schema.carrierAccounts.costCurrency,
      displayCurrency: schema.carrierAccounts.displayCurrency,
      fx: schema.carrierAccounts.fxCostPerDisplay,
      // Residential (Giao nhà dân) lưu RIÊNG ở shipment_charges (cùng cost currency,
      // cùng lượt import FBO); carrier_bill_lines.signature gộp nó vào. Lấy ra để tách.
      residentialRaw: sql<string | null>`(
        SELECT sc.residential FROM ${schema.shipmentCharges} sc
        JOIN ${schema.shipments} shp ON shp.id = sc.shipment_id
        WHERE shp.tracking_number = ${schema.carrierBillLines.trackingNumber}
        ORDER BY sc.imported_at DESC LIMIT 1
      )`,
    })
    .from(schema.carrierBillLines)
    .innerJoin(schema.carrierBills, eq(schema.carrierBills.id, schema.carrierBillLines.billId))
    .innerJoin(schema.carrierAccounts, eq(schema.carrierAccounts.id, schema.carrierBills.carrierAccountId))
    .where(and(
      eq(schema.carrierBillLines.trackingNumber, trackingNumber),
      isNotNull(schema.carrierBillLines.total),
    ))
    .orderBy(schema.carrierBills.periodEnd)
    .limit(1);
  if (!row) return null;

  const factor = costToVndFactor(row.costCurrency, row.displayCurrency, Number(row.fx));
  if (factor == null) return null; // cấu hình tiền tệ không quy được VND
  return normalizeBilledLine(row, factor, row.billNumber);
}
