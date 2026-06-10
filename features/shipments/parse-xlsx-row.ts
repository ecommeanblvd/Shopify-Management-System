/**
 * Parse one row of the operator's LOG-Export Excel into a structured
 * record the importer can route into `shipments` + `shipment_charges`.
 *
 * Pure helper — no DB, no I/O. Input is an array of cell values in
 * column order (xlsx `header: 1` shape) — the importer drives the
 * file read and feeds row arrays in.
 *
 * Column index reference (Excel A=0, B=1, …):
 *   4  E   Tracking Number
 *   5  F   Base (origin hub SG/HN)
 *   6  G   Couriers (carrier actually shipped — source of truth)
 *   8  I   Order Number (#MBLVD28907 / TA2134)
 *   9  J   SKU(s)
 *  10  K   Total pieces per pack
 *  12  M   Country (look up)
 *  15  P   Label Created Date
 *  26  AA  Select VTĐG1 (inventory code → packaging type)
 *  27  AB  Weights (kg)
 *  28  AC  Dimension (e.g. "42x30x10")
 *  34  AI  INS | Chi phí Tổng — actualCost
 *  35  AJ  Mức giá cơ sở — published base
 *  36  AK  Fuel
 *  37  AL  Remote
 *  38  AM  Demand / EES
 *  39  AN  Direct Signature
 *  40  AO  VAT
 *  41  AP  GoGreen
 *  42  AQ  Giá chiết khấu — discount (negative)
 *  46  AU  Log Unique Code (PK-19379)
 *  64  BM  Line Ship Gốc
 *  74  BW  Phí rủi ro gia tăng — elevated risk
 *
 * NOTE (2026-06-10): the operator's re-exported file shifted four
 * columns vs the 2026-06-03 layout this parser was first built
 * against (discount AX→AQ, log code AS→AU, line ship BL→BM,
 * elevated risk BV→BW). Verified against live headers + row math
 * (base+fuel+demand+vat+discount = total).
 *
 * Skip semantics — the parser returns a tagged result instead of
 * throwing so the importer can tally skips by reason:
 *   `ok`            → valid row, route through to DB write
 *   `skip_no_tracking`   → no tracking number = pre-ship row
 *   `skip_no_cost`       → no total cost = label generated but not yet invoiced
 *   `skip_carrier_unknown` → not FedEx/DHL (ViettelPost, GHTK, …)
 *   `skip_store_partner` → DISCN partner-ship row
 *   `skip_store_disconnected` → store not connected (TA/HC/MCN/MTB/MXHS)
 *   `skip_no_country`    → country unparseable
 *   `error`              → malformed row (unexpected types)
 */

import { lookupStorePrefix } from './store-prefix';
import { countryNameToIso } from './country-name-to-iso';
import { parsePackagingType, type PackagingType } from './parse-packaging';

/** Raw cell value — xlsx returns Date for date cells, number for
 *  numbers, string otherwise. NULL for empty cells. */
export type Cell = string | number | Date | boolean | null;
export type RawRow = readonly Cell[];

const COL = {
  trackingNumber: 4,
  originHub: 5,
  carrier: 6,
  orderNumber: 8,
  sku: 9,
  quantity: 10,
  country: 12,
  labelCreatedAt: 15,
  packagingCode: 26,
  weightKg: 27,
  dimension: 28,
  totalCost: 34,
  base: 35,
  fuel: 36,
  remote: 37,
  demand: 38,
  directSignature: 39,
  vat: 40,
  gogreen: 41,
  discount: 42,
  logUniqueCode: 46,
  shippingLine: 64,
  elevatedRisk: 74,
} as const;

export type CarrierKey = 'fedex' | 'dhl';

export interface ParsedDimension {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

export interface ParsedShipment {
  // Identity
  trackingNumber: string;
  orderNumber: string;
  storeHandle: string;
  carrier: CarrierKey;
  // Pack
  shipCountry: string;
  actualWeightKg: number | null;
  dimensions: ParsedDimension | null;
  packagingType: PackagingType | null;
  labelCreatedAt: Date | null;
  logUniqueCode: string | null;
  originHub: string | null;
  // Charge
  totalAmount: number;
  base: number | null;
  fuel: number | null;
  remote: number | null;
  demand: number | null;
  directSignature: number | null;
  vat: number | null;
  gogreen: number | null;
  discount: number | null; // typically negative (Excel: -3,820,388)
  elevatedRisk: number | null;
}

export type ParseResult =
  | { kind: 'ok'; row: ParsedShipment }
  | { kind: 'skip_no_tracking' }
  | { kind: 'skip_no_cost' }
  | { kind: 'skip_carrier_unknown'; carrier: string | null }
  | { kind: 'skip_store_partner' }
  | { kind: 'skip_store_disconnected'; storeHandle: string }
  | { kind: 'skip_no_store_match'; orderNumber: string }
  | { kind: 'skip_no_country'; rawCountry: string | null }
  | { kind: 'error'; reason: string };

/** Format-tolerant number coercion. Excel cells can be `number`,
 *  string like "₫2,239,110" or "−3,820,388". Returns NULL for blank
 *  or unparseable, NEVER throws. */
function asNumber(v: Cell): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date || typeof v === 'boolean') return null;
  // Strip Vietnamese đồng symbol, thousands separators, replace
  // U+2212 "minus" with ASCII '-'.
  const cleaned = String(v).replace(/[₫\s,]/g, '').replace(/[−–]/g, '-');
  if (!cleaned || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function asString(v: Cell): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof v === 'number') return String(v);
  return null;
}

function asDate(v: Cell): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return null;
}

/** "42x30x10" / "40 x 31 x 2" → {L, W, H}. NULL when missing a side. */
function parseDimension(raw: string | null): ParsedDimension | null {
  if (!raw) return null;
  const parts = raw.split(/\s*[xX×]\s*/).map((p) => Number(p));
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n) || n <= 0)) {
    return null;
  }
  return { lengthCm: parts[0], widthCm: parts[1], heightCm: parts[2] };
}

/** Normalise the Excel `Couriers` column to our internal carrier key.
 *  Returns NULL for everything other than FedEx / DHL. */
function parseCarrier(raw: string | null): CarrierKey | null {
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper === 'FEDEX' || upper === 'FED EX') return 'fedex';
  if (upper === 'DHL') return 'dhl';
  return null;
}

export function parseXlsxRow(row: RawRow): ParseResult {
  try {
    const trackingNumber = asString(row[COL.trackingNumber]);
    if (!trackingNumber) return { kind: 'skip_no_tracking' };

    const totalAmount = asNumber(row[COL.totalCost]);
    if (totalAmount === null || totalAmount <= 0) return { kind: 'skip_no_cost' };

    const carrierRaw = asString(row[COL.carrier]);
    const carrier = parseCarrier(carrierRaw);
    if (!carrier) return { kind: 'skip_carrier_unknown', carrier: carrierRaw };

    const orderNumberRaw = asString(row[COL.orderNumber]);
    const storeLookup = lookupStorePrefix(orderNumberRaw);
    if (storeLookup.kind === 'partner_ship') return { kind: 'skip_store_partner' };
    if (storeLookup.kind === 'no_prefix') {
      return { kind: 'skip_no_store_match', orderNumber: orderNumberRaw ?? '' };
    }
    if (!storeLookup.info.connected) {
      return { kind: 'skip_store_disconnected', storeHandle: storeLookup.info.handle };
    }

    const countryRaw = asString(row[COL.country]);
    const shipCountry = countryNameToIso(countryRaw);
    if (!shipCountry) return { kind: 'skip_no_country', rawCountry: countryRaw };

    const parsed: ParsedShipment = {
      trackingNumber,
      orderNumber: storeLookup.orderNumber,
      storeHandle: storeLookup.info.handle,
      carrier,
      shipCountry,
      actualWeightKg: asNumber(row[COL.weightKg]),
      dimensions: parseDimension(asString(row[COL.dimension])),
      packagingType: parsePackagingType(asString(row[COL.packagingCode])),
      labelCreatedAt: asDate(row[COL.labelCreatedAt]),
      logUniqueCode: asString(row[COL.logUniqueCode]),
      originHub: asString(row[COL.originHub]),
      totalAmount,
      base: asNumber(row[COL.base]),
      fuel: asNumber(row[COL.fuel]),
      remote: asNumber(row[COL.remote]),
      demand: asNumber(row[COL.demand]),
      directSignature: asNumber(row[COL.directSignature]),
      vat: asNumber(row[COL.vat]),
      gogreen: asNumber(row[COL.gogreen]),
      discount: asNumber(row[COL.discount]),
      elevatedRisk: asNumber(row[COL.elevatedRisk]),
    };
    return { kind: 'ok', row: parsed };
  } catch (err) {
    return { kind: 'error', reason: err instanceof Error ? err.message : String(err) };
  }
}
