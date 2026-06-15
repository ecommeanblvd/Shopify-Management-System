/**
 * Quote FedEx Rate API cho 1 shipment rồi cache (bảng fedex_rate_quotes).
 * "Giá đúng" (giá hợp đồng) để đối soát billed(thực) vs FedEx theo từng dòng.
 *
 * Dịch vụ mặc định: cố định 1 loại (shop đi 1 dịch vụ) — đổi qua env
 * FEDEX_DEFAULT_SERVICE. Quote theo ĐÚNG ngày ship → giá lịch sử.
 */
import { db, schema } from '@/db/client';
import { quoteRate, type RateQuoteResult } from '@/lib/fedex/rate';
import { effectivePostcode } from '@/lib/fedex/postal';

/** Dịch vụ FedEx mặc định để đối soát. Đổi 1 chỗ nếu shop dùng loại khác. */
export const FEDEX_DEFAULT_SERVICE = process.env.FEDEX_DEFAULT_SERVICE || 'FEDEX_INTERNATIONAL_PRIORITY';

const HUB_POSTAL: Record<string, string> = { HN: '100000', SG: '700000' };

export interface QuoteShipmentInput {
  shipmentId: string;
  originHub: string | null;
  country: string;
  postcode: string | null;
  /** Thành phố — dùng cho nước không-postcode (Vùng Vịnh) + phân giải vùng xa. */
  city?: string | null;
  weightKg: number;
  /** Kích thước (cm) — THIẾU thì quote theo cân thực (nhiều đơn không nhập dim). */
  dims?: { length: number; width: number; height: number };
  shipDate: Date;
  /** Đơn có dùng ký nhận → quote kèm SIGNATURE_OPTION để cột API có giá ký nhận. */
  signatureOptIn?: boolean;
  /** Địa chỉ nhà dân (US/CA) → quote kèm RESIDENTIAL_DELIVERY để cột API có phí
   *  residential. Suy từ billed có residential (hoặc classify = RESIDENTIAL). */
  recipientResidential?: boolean;
}

export interface QuoteWeightInput {
  /** Cân TÍNH PHÍ từ hoá đơn FBO (chính xác nhất — đúng số FedEx đã tính). */
  billingWeightKg?: number | null;
  /** Cân thực của shipment. */
  actualWeightKg?: number | null;
  /** Cân đơn Shopify (fallback cuối khi thiếu cả dim lẫn cân thực). */
  shopifyWeightKg?: number | null;
  dims?: { length: number; width: number; height: number };
}

/** Chọn cân + dims để quote theo ưu tiên (yêu cầu nghiệp vụ):
 *  1. Billing weight hoá đơn → dùng thẳng (đã là cân tính phí cuối, KHÔNG dims).
 *  2. Có dims → cân thực (hoặc Shopify) + dims → FedEx tự lấy max(thực, dim).
 *  3. Không dims → cân thực; thiếu thì cân Shopify. Pure. */
export function resolveQuoteWeight(input: QuoteWeightInput): {
  weightKg: number; dims?: { length: number; width: number; height: number };
} {
  if (input.billingWeightKg && input.billingWeightKg > 0) {
    return { weightKg: input.billingWeightKg };
  }
  const base = (input.actualWeightKg && input.actualWeightKg > 0)
    ? input.actualWeightKg
    : (input.shopifyWeightKg && input.shopifyWeightKg > 0 ? input.shopifyWeightKg : 0.5);
  return { weightKg: base, dims: input.dims };
}

/** Chọn quote ACCOUNT của dịch vụ mặc định; thiếu thì lấy ACCOUNT đầu tiên. Pure. */
export function pickQuote(quotes: RateQuoteResult[], service: string): RateQuoteResult | null {
  const acc = quotes.filter((q) => q.rateType === 'ACCOUNT');
  return acc.find((q) => q.serviceType === service) ?? acc[0] ?? null;
}

const num = (n: number | null): string | null => (n === null ? null : n.toString());

export async function quoteShipmentToCache(
  input: QuoteShipmentInput,
): Promise<{ ok: boolean; service?: string; total?: number }> {
  const postcode = effectivePostcode(input.country, input.postcode);
  if (!postcode) return { ok: false }; // không có postcode thật lẫn fallback → bỏ
  const { raw, quotes } = await quoteRate({
    shipperCountryCode: 'VN',
    shipperPostalCode: HUB_POSTAL[input.originHub ?? ''] ?? '700000',
    recipientCountryCode: input.country,
    recipientPostalCode: postcode,
    recipientCity: input.city ?? undefined,
    weightKg: input.weightKg,
    dimsCm: input.dims,
    shipDate: input.shipDate.toISOString().slice(0, 10),
    signatureOptIn: input.signatureOptIn,
    recipientResidential: input.recipientResidential,
  });
  const q = pickQuote(quotes, FEDEX_DEFAULT_SERVICE);
  if (!q) return { ok: false };

  const row = {
    service: q.serviceType, rateType: q.rateType ?? 'ACCOUNT', currency: q.currency,
    shipDate: input.shipDate,
    totalNetCharge: num(q.totalNetCharge), baseCharge: num(q.baseCharge),
    fuel: q.components.fuel.toString(), fuelPercent: num(q.fuelPercent),
    residential: q.components.residential.toString(), remote: q.components.remote.toString(),
    demand: q.components.demand.toString(),
    signature: q.components.signature.toString(), countryFixed: q.components.countryFixed.toString(),
    vat: q.vat.toString(), discount: q.discount.toString(),
    billingWeightKg: num(q.billingWeightKg), rateZone: q.rateZone, raw: raw as object,
  };
  await db.insert(schema.fedexRateQuotes)
    .values({ shipmentId: input.shipmentId, ...row })
    .onConflictDoUpdate({ target: schema.fedexRateQuotes.shipmentId, set: { ...row, quotedAt: new Date() } });
  return { ok: true, service: q.serviceType, total: q.totalNetCharge };
}
