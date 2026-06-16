import { quote, type CarrierAccountSnapshot } from './engine/quote';

export interface CheckoutRateCarrier {
  serviceCode: string;
  serviceName: string;
  snapshot: CarrierAccountSnapshot;
}

/** Định dạng rate Shopify CarrierService mong đợi. total_price = đơn vị nhỏ nhất
 *  của tiền tệ (cents với USD), dạng chuỗi. */
export interface ShopifyCheckoutRate {
  service_name: string;
  service_code: string;
  total_price: string;
  currency: string;
  description?: string;
}

/**
 * Tính rate ship cho checkout từ engine (B1): mỗi carrier quote theo cân + địa
 * chỉ THẬT → cộng được ODA (postcode/city), residential (US/CA), fuel hiện tại.
 * Trả các carrier phục vụ được đích (quote ok). Thuần, không I/O.
 */
export function computeCheckoutRates(args: {
  country: string;
  postalCode?: string | null;
  city?: string | null;
  weightKg: number;
  carriers: CheckoutRateCarrier[];
  now?: Date;
}): ShopifyCheckoutRate[] {
  const isResidential = args.country === 'US' || args.country === 'CA';
  const weightKg = args.weightKg > 0 ? args.weightKg : 0.5; // giỏ không cân → tối thiểu 0,5kg
  const rates: ShopifyCheckoutRate[] = [];
  for (const c of args.carriers) {
    const q = quote(c.snapshot, {
      weightKg,
      destinationCountry: args.country,
      destinationPostcode: args.postalCode ?? undefined,
      destinationCity: args.city ?? undefined,
      isResidential,
      packagingType: 'box',
      effectiveDate: args.now,
    });
    if (!q.ok) continue;
    rates.push({
      service_name: c.serviceName,
      service_code: c.serviceCode,
      total_price: String(Math.round(q.breakdown.finalDisplay * 100)),
      currency: c.snapshot.displayCurrency,
    });
  }
  return rates;
}
