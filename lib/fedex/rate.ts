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

/** Phụ phí FedEx gom về đúng các "thùng" engine mình đang đối soát. */
export interface RateComponents {
  fuel: number;
  residential: number;
  remote: number;
  demand: number;
  ancillary: number; // ký nhận / dịch vụ bổ sung (ANCILLARY_FEE)
  other: number;
}

/** Map type phụ phí FedEx → thùng. */
export function categorizeSurcharges(surcharges: RateSurcharge[]): RateComponents {
  const c: RateComponents = { fuel: 0, residential: 0, remote: 0, demand: 0, ancillary: 0, other: 0 };
  for (const s of surcharges) {
    const t = s.type.toUpperCase();
    if (t === 'FUEL') c.fuel += s.amount;
    else if (t.includes('RESIDENTIAL')) c.residential += s.amount;
    else if (t.includes('DELIVERY_AREA') || t.includes('OUT_OF_DELIVERY') || t.includes('EXTENDED')) c.remote += s.amount;
    else if (t.includes('PEAK') || t.includes('DEMAND')) c.demand += s.amount;
    else if (t.includes('ANCILLARY') || t.includes('SIGNATURE')) c.ancillary += s.amount;
    else c.other += s.amount;
  }
  return c;
}

export interface RateQuoteResult {
  serviceType: string;
  serviceName?: string;
  rateType?: string; // 'ACCOUNT' | 'LIST'
  currency: string;
  totalNetCharge: number; // gồm cả VAT
  baseCharge: number | null;
  totalSurcharges: number | null;
  surcharges: RateSurcharge[];
  components: RateComponents;
  fuelPercent: number | null;
  vat: number; // taxes VAT (Vietnam value-added)
  discount: number; // totalFreightDiscount (số dương = đã giảm)
  billingWeightKg: number | null;
  rateZone: string | null;
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
      const surcharges = surList.map((s) => ({
        type: String(s.type ?? ''),
        description: s.description as string | undefined,
        amount: Number(s.amount ?? 0),
      }));
      const taxes = (srd.taxes as Array<Record<string, unknown>> | undefined) ?? [];
      const vat = taxes
        .filter((t) => String(t.type ?? '').toUpperCase().includes('VAT'))
        .reduce((sum, t) => sum + Number(t.amount ?? 0), 0);
      const bw = srd.totalBillingWeight as { value?: unknown } | undefined;
      out.push({
        serviceType: String(d.serviceType ?? ''),
        serviceName: d.serviceName as string | undefined,
        rateType: r.rateType as string | undefined,
        currency: String(r.currency ?? srd.currency ?? ''),
        totalNetCharge: Number(r.totalNetCharge ?? srd.totalNetCharge ?? 0),
        baseCharge: srd.totalBaseCharge != null ? Number(srd.totalBaseCharge) : null,
        totalSurcharges: srd.totalSurcharges != null ? Number(srd.totalSurcharges) : null,
        surcharges,
        components: categorizeSurcharges(surcharges),
        fuelPercent: srd.fuelSurchargePercent != null ? Number(srd.fuelSurchargePercent) : null,
        vat,
        discount: srd.totalFreightDiscount != null ? Number(srd.totalFreightDiscount) : 0,
        billingWeightKg: bw?.value != null ? Number(bw.value) : null,
        rateZone: srd.rateZone != null ? String(srd.rateZone) : null,
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
