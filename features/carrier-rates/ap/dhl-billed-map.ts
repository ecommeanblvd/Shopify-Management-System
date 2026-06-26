import type { DhlShipment, DhlChargeLine } from './dhl-invoice-csv';
import { classifyCharge } from './charge-classify';

/**
 * Map hoá đơn DHL → dữ liệu billed cho đối soát (shipment_charges).
 * Phân loại Product: 'duties' (thuế/phí hải quan, chỉ công nợ) vs 'freight'
 * (cước — đẩy vào đối soát). Map từng khoản cước về đúng ô engine dùng.
 * Thuần, không I/O.
 */

export type DhlLineKind = 'freight' | 'duties';

/** DUTIES & TAXES → duties; còn lại (EXPRESS…) → freight. */
export function classifyDhlProduct(productName: string): DhlLineKind {
  return /duties|taxes/i.test(productName ?? '') ? 'duties' : 'freight';
}

export interface DhlBilledMap {
  base: number;
  fuel: number;
  remote: number;
  demand: number;
  directSignature: number;
  elevatedRisk: number;
  addressCorrection: number;
  gogreen: number;
  /** Phụ phí kiện không qua băng chuyền (DHL Non-Conveyable Piece, code YL/YO). */
  nonConveyable: number;
  /** Phụ phí giao địa chỉ nhà dân (DHL Residential Address, code TK). */
  residential: number;
  discount: number;
  vat: number;
  totalAmount: number;
  billingWeightKg: number | null;
  /** Khoản cước không nhận diện được → cảnh báo, không nhét bừa. */
  unknown: DhlChargeLine[];
}

/** Phân loại 1 khoản cước DHL về bucket billed. null = không nhận diện. */
function bucketOf(c: DhlChargeLine): keyof DhlBilledMap | null {
  if (c.code === 'WEIGHT') return 'base';
  if (c.code === 'P') return 'base'; // XML DHL: freight = code 'P' (CSV dùng 'WEIGHT')
  const n = c.name.toLowerCase();
  const code = c.code.toUpperCase();
  // Non-Conveyable trước nhánh cước vì tên "... - WEIGHT" chứa "weight".
  if (/non.?conveyable/.test(n)) return 'nonConveyable';
  if (code === 'YL' || code === 'YO') return 'nonConveyable'; // XML: name rỗng, nhận theo code
  // Restricted Destination thuộc họ country_fixed → dồn vào elevatedRisk để
  // đối soát chung kênh (engine country_fixed). Residential → cột riêng.
  if (/restricted/.test(n)) return 'elevatedRisk';
  if (/residential/.test(n)) return 'residential';
  if (code === 'FF' || /fuel/.test(n)) return 'fuel';
  if (code === 'FD' || /gogreen|carbon/.test(n)) return 'gogreen';
  if (code === 'CA' || /elevated risk/.test(n)) return 'elevatedRisk';
  if (code === 'MA' || /address correction/.test(n)) return 'addressCorrection';
  if (/remote|out of delivery|delivery area|\boda\b/.test(n)) return 'remote';
  if (code === 'SF' || /signature/.test(n)) return 'directSignature';
  if (/emergency|demand|peak/.test(n)) return 'demand';
  return null;
}

/** Gộp khoản cước → billed map (giá trị = charge trước thuế). Dùng được cả từ
 *  parser (DhlShipment) lẫn từ bill line đã lưu (charges + tổng). */
export function mapChargesToBilled(
  charges: DhlChargeLine[],
  opts: { totalTax: number; totalInclVat: number; weightKg: number | null },
): DhlBilledMap {
  const out: DhlBilledMap = {
    base: 0, fuel: 0, remote: 0, demand: 0, directSignature: 0, elevatedRisk: 0,
    addressCorrection: 0, gogreen: 0, nonConveyable: 0, residential: 0,
    discount: 0, vat: opts.totalTax, totalAmount: opts.totalInclVat,
    billingWeightKg: opts.weightKg && opts.weightKg > 0 ? opts.weightKg : null, unknown: [],
  };
  for (const c of charges ?? []) {
    const b = bucketOf(c);
    if (b) (out[b] as number) += c.charge;
    else out.unknown.push(c);
  }
  return out;
}

export function mapDhlFreightToBilled(s: DhlShipment): DhlBilledMap {
  return mapChargesToBilled(s.charges, { totalTax: s.totalTax, totalInclVat: s.totalInclVat, weightKg: s.weightKg });
}

/**
 * Khoản cước đã được hệ thống NHẬN DIỆN chưa? Nhận diện =
 *  - map được vào 1 bucket cước (bucketOf ≠ null: weight/fuel/gogreen/remote/…), HOẶC
 *  - là thuế/duty pass-through (classifyCharge = 'hide': duty/tax/regulatory/penalty).
 * Khoản KHÔNG nhận diện = phí lạ chưa cấu hình surcharge → cần operator xem & set up.
 */
export function isRecognizedCharge(c: DhlChargeLine): boolean {
  return bucketOf(c) !== null || classifyCharge(c.name || c.code) === 'hide';
}

/** Freight nếu có cước cân hoặc fuel (duties chỉ có XB/XX/DD/XI). */
export function isFreightCharges(charges: DhlChargeLine[] | null | undefined): boolean {
  return !!charges?.some((c) => c.code === 'WEIGHT' || c.code.toUpperCase() === 'FF' || /fuel/i.test(c.name));
}
