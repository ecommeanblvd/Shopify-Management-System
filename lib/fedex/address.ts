/**
 * FedEx Address Validation API — phân loại địa chỉ residential/business.
 *   POST /address/v1/addresses/resolve
 * Dùng để biết phí "Residential Delivery" (FedEx US/CA) có ĐÚNG được thu không:
 * classification = RESIDENTIAL ⇒ hợp lệ; BUSINESS ⇒ FedEx thu sai ⇒ đòi NCC.
 *
 * Pure builder + parser tách khỏi I/O để unit-test; resolveAddress() gọi thật.
 */
import { fedexFetch } from './client';

export type AddressClassification = 'RESIDENTIAL' | 'BUSINESS' | 'MIXED' | 'UNKNOWN';

export interface AddressInput {
  streetLines: string[];
  city?: string | null;
  stateOrProvinceCode?: string | null;
  postalCode?: string | null;
  countryCode: string;
}

/** Body request resolve cho 1 địa chỉ. */
/**
 * Chuẩn hoá mã bang/tỉnh cho FedEx Address Validation. FedEx chỉ chấp nhận mã
 * NGẮN (US/CA, kiểu USPS 2 ký tự). Shopify lưu ISO 3166-2 có tiền tố nước
 * ("US-CA", "KW-KU") → gửi nguyên sẽ bị 400 STATEORPROVINCECODE.TOO.LONG.
 *   - US/CA: bỏ tiền tố nước ("US-CA" → "CA"); giữ nếu ≤ 3 ký tự.
 *   - Nước khác: BỎ HẲN (FedEx không cần tỉnh cho phần lớn nước; tránh 400).
 */
export function normalizeStateCode(code: string | null | undefined, country: string): string | undefined {
  if (!code) return undefined;
  if (country !== 'US' && country !== 'CA') return undefined;
  const sub = code.includes('-') ? (code.split('-').pop() ?? '') : code;
  return sub.length > 0 && sub.length <= 3 ? sub : undefined;
}

/** Giới hạn độ dài 1 trường địa chỉ FedEx (street line / city). */
const FEDEX_FIELD_MAX = 35;

/**
 * Cắt streetLines cho vừa FedEx (tránh 400 STREETLINES.TOO.LONG). Khách hay nhồi
 * cả địa chỉ dài vào 1 dòng ("House Number:... Street Name:... District:...").
 * Mỗi dòng > 35 ký tự được CHIA thành các đoạn ≤ 35 (giữ tối đa thông tin),
 * tổng tối đa 3 dòng theo giới hạn FedEx.
 */
export function capStreetLines(lines: string[]): string[] {
  const chunks: string[] = [];
  for (const raw of lines) {
    let s = (raw ?? '').trim();
    if (!s) continue;
    while (s.length > FEDEX_FIELD_MAX) {
      chunks.push(s.slice(0, FEDEX_FIELD_MAX).trim());
      s = s.slice(FEDEX_FIELD_MAX).trim();
    }
    if (s) chunks.push(s);
  }
  return chunks.slice(0, 3);
}

/** Cắt city ≤ 35 ký tự (tránh 400 CITY.TOO.LONG). */
function capCity(city: string | null | undefined): string | undefined {
  const s = city?.trim();
  return s ? s.slice(0, FEDEX_FIELD_MAX) : undefined;
}

export function buildResolveRequest(addr: AddressInput): Record<string, unknown> {
  return {
    addressesToValidate: [
      {
        address: {
          streetLines: capStreetLines(addr.streetLines),
          city: capCity(addr.city),
          stateOrProvinceCode: normalizeStateCode(addr.stateOrProvinceCode, addr.countryCode),
          postalCode: addr.postalCode ?? undefined,
          countryCode: addr.countryCode,
        },
      },
    ],
  };
}

interface ResolveResponse {
  output?: {
    resolvedAddresses?: Array<{
      classification?: string;
      attributes?: Record<string, string | boolean>;
      streetLinesToken?: string[];
      streetLines?: string[];
      city?: string;
      stateOrProvinceCode?: string;
      postalCode?: string;
      countryCode?: string;
      customerMessages?: Array<{ code?: string; message?: string }>;
    }>;
  };
}

const attrTrue = (v: unknown) => v === true || String(v ?? '').toLowerCase() === 'true';

/** Lấy classification từ response (chuẩn hoá về union; mặc định UNKNOWN). */
export function parseClassification(raw: unknown): AddressClassification {
  const res = raw as ResolveResponse;
  const a = res?.output?.resolvedAddresses?.[0];
  const cls = String(a?.classification ?? '').toUpperCase();
  if (cls === 'RESIDENTIAL' || cls === 'BUSINESS' || cls === 'MIXED') return cls;
  // Một số phản hồi để classification trống nhưng có attributes.Residential.
  const attr = a?.attributes?.Residential;
  if (attr === true || attr === 'true') return 'RESIDENTIAL';
  if (attr === false || attr === 'false') return 'BUSINESS';
  return 'UNKNOWN';
}

export interface ResolveResult {
  classification: AddressClassification;
  raw: unknown;
}

/** Gọi FedEx Address Validation thật → classification. */
export async function resolveAddress(addr: AddressInput): Promise<ResolveResult> {
  const raw = await fedexFetch<unknown>('/address/v1/addresses/resolve', {
    method: 'POST',
    json: buildResolveRequest(addr),
  });
  return { classification: parseClassification(raw), raw };
}

export interface AddressVerification {
  classification: AddressClassification;
  /** FedEx chuẩn hoá/khớp được địa chỉ (giao được). DPV (US) hoặc Resolved. */
  deliverable: boolean;
  /** Vấn đề nếu có (vd SuiteRequiredButMissing / ADDRESS.NOTFOUND). */
  issue: string | null;
  /** Địa chỉ chuẩn hoá FedEx gợi ý (1 dòng). */
  standardized: string | null;
  raw: unknown;
}

/** Bóc kết quả verify đầy đủ từ response Address Validation. Pure. */
export function parseAddressVerification(raw: unknown): AddressVerification {
  const a = (raw as ResolveResponse)?.output?.resolvedAddresses?.[0];
  const attr = a?.attributes ?? {};
  const deliverable = attrTrue(attr.DPV) || attrTrue(attr.Resolved) || attrTrue(attr.Matched);
  let issue: string | null = a?.customerMessages?.[0]?.code ?? a?.customerMessages?.[0]?.message ?? null;
  if (!issue) {
    if (attrTrue(attr.SuiteRequiredButMissing)) issue = 'SuiteRequiredButMissing';
    else if (attrTrue(attr.InvalidSuiteNumber)) issue = 'InvalidSuiteNumber';
  }
  const std = a
    ? [...(a.streetLines ?? []), a.city, a.stateOrProvinceCode, a.postalCode].filter(Boolean).join(', ')
    : '';
  return { classification: parseClassification(raw), deliverable, issue, standardized: std || null, raw };
}

/** Gọi FedEx Address Validation → kết quả verify đầy đủ. */
export async function verifyAddress(addr: AddressInput): Promise<AddressVerification> {
  const raw = await fedexFetch<unknown>('/address/v1/addresses/resolve', {
    method: 'POST',
    json: buildResolveRequest(addr),
  });
  return parseAddressVerification(raw);
}
