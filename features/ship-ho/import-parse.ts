/**
 * THUẦN: parse 1 dòng file import ship hộ (template cột cố định — xem
 * SHIP_HO_IMPORT_COLUMNS). Không I/O. Orchestrator `import-actions.ts` lo DB.
 */
export const SHIP_HO_IMPORT_COLUMNS = {
  code: 0, recipientName: 1, recipientCompany: 2, recipientPhone: 3,
  country: 4, city: 5, province: 6, postcode: 7, address1: 8, address2: 9,
  weightKg: 10, dimLengthCm: 11, dimWidthCm: 12, dimHeightCm: 13,
  packagingType: 14, carrierKey: 15, trackingNumber: 16,
} as const;

export interface ParsedShipHoImport {
  code: string;
  recipientName: string | null;
  recipientCompany: string | null;
  recipientPhone: string | null;
  country: string;
  city: string | null;
  province: string | null;
  postcode: string | null;
  address1: string | null;
  address2: string | null;
  weightKg: number;
  dimLengthCm: number | null;
  dimWidthCm: number | null;
  dimHeightCm: number | null;
  packagingType: 'bag' | 'box' | null;
  carrierKey: 'fedex' | 'dhl' | null;
  trackingNumber: string | null;
}

export type ParseShipHoResult =
  | { kind: 'ok'; row: ParsedShipHoImport }
  | { kind: 'skip_empty' }
  | { kind: 'error'; reason: 'missing_code' | 'bad_country' | 'bad_weight' };

function str(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}
function strOrNull(v: unknown): string | null {
  const s = str(v);
  return s === '' ? null : s;
}
function numOrNull(v: unknown): number | null {
  const s = str(v).replace(/[,\s]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseShipHoImportRow(row: readonly unknown[]): ParseShipHoResult {
  const C = SHIP_HO_IMPORT_COLUMNS;
  const allEmpty = row.every((c) => str(c) === '');
  if (allEmpty) return { kind: 'skip_empty' };

  const code = str(row[C.code]);
  if (code === '') return { kind: 'error', reason: 'missing_code' };

  const country = str(row[C.country]).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return { kind: 'error', reason: 'bad_country' };

  const weightKg = numOrNull(row[C.weightKg]);
  if (weightKg == null || weightKg <= 0) return { kind: 'error', reason: 'bad_weight' };

  const pkgRaw = str(row[C.packagingType]).toLowerCase();
  const packagingType = pkgRaw === 'bag' || pkgRaw === 'box' ? pkgRaw : null;
  const carRaw = str(row[C.carrierKey]).toLowerCase();
  const carrierKey = carRaw === 'fedex' || carRaw === 'dhl' ? carRaw : null;

  return {
    kind: 'ok',
    row: {
      code,
      recipientName: strOrNull(row[C.recipientName]),
      recipientCompany: strOrNull(row[C.recipientCompany]),
      recipientPhone: strOrNull(row[C.recipientPhone]),
      country,
      city: strOrNull(row[C.city]),
      province: strOrNull(row[C.province]),
      postcode: strOrNull(row[C.postcode]),
      address1: strOrNull(row[C.address1]),
      address2: strOrNull(row[C.address2]),
      weightKg,
      dimLengthCm: numOrNull(row[C.dimLengthCm]),
      dimWidthCm: numOrNull(row[C.dimWidthCm]),
      dimHeightCm: numOrNull(row[C.dimHeightCm]),
      packagingType,
      carrierKey,
      trackingNumber: strOrNull(row[C.trackingNumber]),
    },
  };
}

/** Đơn import: có tracking coi như đã gửi ('shipped'); chưa có → 'draft'. */
export function statusForImportedOrder(trackingNumber: string | null): 'shipped' | 'draft' {
  return trackingNumber && trackingNumber.trim() !== '' ? 'shipped' : 'draft';
}
