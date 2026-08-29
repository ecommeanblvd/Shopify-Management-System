import { quote, type CarrierAccountSnapshot } from './engine/quote';

/**
 * Hãng được phép chào giá ở CHECKOUT. Cố ý là danh sách trắng, không phải "mọi
 * account đang bật": Aramex/UPS/SF là line nội bộ để logistic chọn sau khi có
 * đơn, không phải lựa chọn cho khách. Trước đây route nạp mọi account nên khách
 * Mỹ nhìn thấy Aramex 21.649.138 VND và UPS 3.153.572 VND cho một kiện 0,8 kg
 * (rò rỉ từ 26/06, phát hiện 29/08).
 */
export const CHECKOUT_CARRIER_KEYS: readonly string[] = ['fedex', 'dhl'];

/** THUẦN: lọc account được chào ở checkout — đúng hãng VÀ đang bật. */
export function locCarrierCheckout<T extends { key: string | null; enabled: boolean }>(accounts: T[]): T[] {
  return accounts.filter((a) => a.enabled && a.key !== null && CHECKOUT_CARRIER_KEYS.includes(a.key));
}

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
      // KHÔNG bật: phí ký nhận của FedEx/DHL đã khai apply_mode='always' nên
      // engine tự cộng theo nước (trừ danh sách miễn). Cờ này giờ CHỈ còn mở
      // các phụ phí THEO-CA (UPS "sai địa chỉ" 1.973.060đ, cụm pallet Aramex
      // $766) — không bao giờ được cộng vào giá khách thấy.
      signatureOptIn: false,
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
