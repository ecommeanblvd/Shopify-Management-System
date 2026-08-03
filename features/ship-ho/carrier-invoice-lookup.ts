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
  /** Phí sửa địa chỉ (Address Correction) — phụ phí VẬN CHUYỂN, FedEx áp fuel. */
  addressCorrection: number;
  /** Phí xử lý hàng NK — pass-through, KHÔNG fuel, CÓ VAT. */
  importHandling: number;
  /** Thuế/hải quan FedEx ứng hộ — pass-through thuần, KHÔNG fuel KHÔNG VAT. */
  duty: number;
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
  addressCorrection: string | null;
  importHandling: string | null;
  duty: string | null;
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
      addressCorrection: s(raw.addressCorrection),
      importHandling: s(raw.importHandling), duty: s(raw.duty),
    },
    billNumber,
    shipDate: raw.shipDate,
  };
}

/**
 * Fuel % FedEx THỰC ÁP cho lô hàng, suy từ chính dòng bill:
 * fuel ÷ (net freight + phụ phí vận chuyển chịu fuel), lượng tử bậc 0,25%
 * (FedEx công bố theo bước 0,25). Bảng fuel nội bộ (scrape fedex.com) có thể
 * lệch tuần so với mức bill thực áp (kiểm chứng 21/07: bill ship 20-21/07 áp
 * 38,25% trong khi bảng tuần 20-26/07 ghi 39,75%) → giá thu THỰC phải lấy %
 * từ bill. Trả null khi bill không có fuel / số bất thường → caller fallback
 * fuel engine theo ship_date.
 */
export function billImpliedFuelPercent(s: BilledSurcharges): number | null {
  const fuelableBase = s.base + s.discount + s.remote + s.demand + s.signature
    + s.residential + s.addressCorrection;
  if (!(s.fuel > 0) || !(fuelableBase > 0)) return null;
  const pct = Math.round((s.fuel / fuelableBase) * 100 * 4) / 4;
  if (pct <= 0 || pct > 100) return null;
  return pct;
}

/**
 * GỘP nhiều dòng bill của CÙNG 1 tracking thành 1 bức tranh đầy đủ. FedEx tách
 * hoá đơn: bill CƯỚC (734xxx — freight/fuel/phụ phí) và bill THUẾ (736xxx —
 * duty ứng hộ) là 2 dòng riêng; trước đây lookup LIMIT 1 → đơn nào dòng duty
 * đứng trước là mất sạch cước (margin ảo, 03/08 — 7 đơn dính). Tiền cộng dồn;
 * cân lấy max; ship date lấy sớm nhất có; billNumber nối ' + '.
 */
export function aggregateBilledLines(rows: BilledLookup[]): BilledLookup {
  if (rows.length === 1) return rows[0];
  const keys = Object.keys(rows[0].surcharges) as Array<keyof BilledSurcharges>;
  const surcharges = Object.fromEntries(keys.map((k) => [k, rows.reduce((s, r) => s + r.surcharges[k], 0)])) as unknown as BilledSurcharges;
  const weights = rows.map((r) => r.weightKg).filter((w): w is number => w != null);
  const shipDates = rows.map((r) => r.shipDate).filter((d): d is string => !!d).sort();
  const billNumbers = [...new Set(rows.map((r) => r.billNumber).filter((b): b is string => !!b))];
  return {
    weightKg: weights.length ? Math.max(...weights) : null,
    totalVnd: rows.reduce((s, r) => s + r.totalVnd, 0),
    surcharges,
    billNumber: billNumbers.length ? billNumbers.join(' + ') : null,
    shipDate: shipDates[0] ?? null,
  };
}

/** Bill ĐÃ có phần CƯỚC chưa? Chỉ có duty (bill cước chưa về) → chưa đủ để
 *  re-bill giá thu thực — coi như chưa có bill, tránh margin ảo. */
export function billedHasFreight(b: BilledLookup): boolean {
  return b.surcharges.base + b.surcharges.discount > 0;
}

/** COST currency → VND. costCurrency VND → 1; displayCurrency VND → 1/fx; khác → null. */
export function costToVndFactor(costCurrency: string, displayCurrency: string, fxCostPerDisplay: number): number | null {
  if (costCurrency === 'VND') return 1;
  if (displayCurrency === 'VND') return 1 / fxCostPerDisplay;
  return null;
}

/**
 * Tìm TẤT CẢ dòng hoá đơn carrier khớp tracking (cước + duty có thể nằm 2 bill
 * khác nhau) và GỘP lại. Trả null nếu chưa có bill nào cho tracking này.
 */
export async function getBilledByTracking(trackingNumber: string): Promise<BilledLookup | null> {
  if (!trackingNumber) return null;
  const rows = await db
    .select({
      weightKg: schema.carrierBillLines.weightKg,
      base: schema.carrierBillLines.base, discount: schema.carrierBillLines.discount,
      fuel: schema.carrierBillLines.fuel, remote: schema.carrierBillLines.remote,
      demand: schema.carrierBillLines.demand, signature: schema.carrierBillLines.signature,
      vat: schema.carrierBillLines.vat, other: schema.carrierBillLines.other,
      addressCorrection: schema.carrierBillLines.addressCorrection,
      importHandling: schema.carrierBillLines.importHandling, duty: schema.carrierBillLines.duty,
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
    .orderBy(schema.carrierBills.periodEnd);
  if (rows.length === 0) return null;

  const factor = costToVndFactor(rows[0].costCurrency, rows[0].displayCurrency, Number(rows[0].fx));
  if (factor == null) return null; // cấu hình tiền tệ không quy được VND
  // residentialRaw là số CẤP LÔ HÀNG (từ shipment_charges) nhưng subquery gắn nó
  // vào MỌI dòng — chỉ áp cho 1 dòng (ưu tiên dòng cước có signature gộp) để
  // aggregate không nhân đôi residential.
  const resIdx = Math.max(0, rows.findIndex((r) => Number(r.signature ?? 0) > 0));
  const normalized = rows.map((r, i) =>
    normalizeBilledLine({ ...r, residentialRaw: i === resIdx ? r.residentialRaw : null }, factor, r.billNumber));
  return aggregateBilledLines(normalized);
}
