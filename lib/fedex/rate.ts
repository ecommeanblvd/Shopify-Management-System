/**
 * FedEx Rate & Transit Times API — báo giá chuẩn của FedEx cho 1 lô hàng,
 * kèm bóc tách phụ phí. Dùng để đối soát 3 chiều billed / engine / FedEx.
 *
 * Endpoint: POST /rate/v1/rates/quotes
 * Doc shape verified against FedEx Rate API v1 (2024).
 */
import { fedexFetch, getFedexAccountNumber } from './client';

export interface RateQuoteInput {
  shipperPostalCode?: string;
  shipperCountryCode: string; // ISO-2, ví dụ 'VN'
  recipientPostalCode?: string;
  recipientCountryCode: string;
  recipientResidential?: boolean;
  weightKg: number;
  dimsCm?: { length: number; width: number; height: number };
  /** Dịch vụ cụ thể (vd 'INTERNATIONAL_PRIORITY'); bỏ trống → FedEx trả mọi dịch vụ khả dụng. */
  serviceType?: string;
  shipDate?: string; // YYYY-MM-DD
  /** Trị giá khai hải quan (bắt buộc với hàng quốc tế). Mặc định 100 USD nếu thiếu. */
  customsValue?: { amount: number; currency: string };
  /** Mô tả hàng để khai hải quan. */
  commodityDescription?: string;
}

/** Dựng request body Rate API. Tách riêng để unit-test không cần mạng. */
export function buildRateRequest(input: RateQuoteInput, accountNumber: string): Record<string, unknown> {
  const pkg: Record<string, unknown> = {
    weight: { units: 'KG', value: input.weightKg },
  };
  if (input.dimsCm) {
    pkg.dimensions = {
      length: input.dimsCm.length,
      width: input.dimsCm.width,
      height: input.dimsCm.height,
      units: 'CM',
    };
  }
  const isInternational = input.shipperCountryCode !== input.recipientCountryCode;
  const customs = input.customsValue ?? { amount: 100, currency: 'USD' };
  const customsClearanceDetail = isInternational
    ? {
        commodities: [
          {
            description: input.commodityDescription ?? 'Apparel',
            countryOfManufacture: input.shipperCountryCode,
            quantity: 1,
            quantityUnits: 'PCS',
            weight: { units: 'KG', value: input.weightKg },
            customsValue: { amount: customs.amount, currency: customs.currency },
          },
        ],
      }
    : undefined;

  return {
    accountNumber: { value: accountNumber },
    rateRequestControlParameters: { returnTransitTimes: true },
    requestedShipment: {
      shipper: { address: { postalCode: input.shipperPostalCode, countryCode: input.shipperCountryCode } },
      recipient: {
        address: {
          postalCode: input.recipientPostalCode,
          countryCode: input.recipientCountryCode,
          residential: input.recipientResidential ?? false,
        },
      },
      ...(input.shipDate ? { shipDateStamp: input.shipDate } : {}),
      ...(input.serviceType ? { serviceType: input.serviceType } : {}),
      ...(customsClearanceDetail ? { customsClearanceDetail } : {}),
      pickupType: 'USE_SCHEDULED_PICKUP',
      // ACCOUNT = giá hợp đồng; LIST = giá niêm yết → so được cả hai.
      rateRequestType: ['ACCOUNT', 'LIST'],
      requestedPackageLineItems: [pkg],
    },
  };
}

export interface RateSurcharge {
  type: string;
  description?: string;
  amount: number;
}

export interface RateQuoteResult {
  serviceType: string;
  serviceName?: string;
  rateType?: string; // 'ACCOUNT' | 'LIST'
  currency: string;
  totalNetCharge: number;
  baseCharge: number | null;
  totalSurcharges: number | null;
  surcharges: RateSurcharge[];
  transitDays?: string;
}

/** Bóc các báo giá từ response Rate API (mỗi dịch vụ 1 dòng). Phòng thủ với shape thiếu. */
export function parseRateReply(reply: unknown): RateQuoteResult[] {
  const details = (reply as { output?: { rateReplyDetails?: unknown[] } })?.output?.rateReplyDetails;
  if (!Array.isArray(details)) return [];
  const out: RateQuoteResult[] = [];
  for (const d of details as Array<Record<string, unknown>>) {
    const rated = (d.ratedShipmentDetails as Array<Record<string, unknown>> | undefined) ?? [];
    for (const r of rated) {
      const srd = (r.shipmentRateDetail as Record<string, unknown> | undefined) ?? {};
      const surList = (srd.surCharges as Array<Record<string, unknown>> | undefined) ?? [];
      out.push({
        serviceType: String(d.serviceType ?? ''),
        serviceName: d.serviceName as string | undefined,
        rateType: r.rateType as string | undefined,
        currency: String(r.currency ?? srd.currency ?? ''),
        totalNetCharge: Number(r.totalNetCharge ?? srd.totalNetCharge ?? 0),
        baseCharge: srd.totalBaseCharge != null ? Number(srd.totalBaseCharge) : null,
        totalSurcharges: srd.totalSurcharges != null ? Number(srd.totalSurcharges) : null,
        surcharges: surList.map((s) => ({
          type: String(s.type ?? ''),
          description: s.description as string | undefined,
          amount: Number(s.amount ?? 0),
        })),
        transitDays: (d.commit as { transitDays?: { description?: string } } | undefined)?.transitDays?.description,
      });
    }
  }
  return out;
}

/** Gọi Rate API thật. Trả về raw response + danh sách báo giá đã bóc tách. */
export async function quoteRate(input: RateQuoteInput): Promise<{ raw: unknown; quotes: RateQuoteResult[] }> {
  const body = buildRateRequest(input, getFedexAccountNumber());
  const raw = await fedexFetch<unknown>('/rate/v1/rates/quotes', { method: 'POST', json: body });
  return { raw, quotes: parseRateReply(raw) };
}
