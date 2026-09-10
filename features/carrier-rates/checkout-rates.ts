import { quote, type CarrierAccountSnapshot } from './engine/quote';
import { taoHaiMucRate, type ShopifyCheckoutRate } from './hai-muc-giao';

export type { ShopifyCheckoutRate } from './hai-muc-giao';

/**
 * Hãng được phép LÀM GIÁ GỐC ở CHECKOUT, theo THỨ TỰ ƯU TIÊN. Cố ý là danh sách
 * trắng, không phải "mọi account đang bật": Aramex/UPS/SF là line nội bộ để
 * logistic chọn sau khi có đơn, không phải lựa chọn cho khách. Trước đây route
 * nạp mọi account nên khách Mỹ nhìn thấy Aramex 21.649.138 VND và UPS 3.153.572
 * VND cho một kiện 0,8 kg (rò rỉ từ 26/06, phát hiện 29/08).
 *
 * Từ D-071 (10/09/2026) khách KHÔNG còn thấy tên hãng: chỉ một hãng làm giá gốc
 * (FedEx IP — tuyến đang chạy; DHL chỉ khi FedEx không có zone tới nước đó), rồi
 * dựng hai mức Standard / Express từ giá đó (xem hai-muc-giao.ts).
 */
export const CHECKOUT_CARRIER_KEYS: readonly string[] = ['fedex', 'dhl'];

/** THUẦN: lọc account được chào ở checkout — đúng hãng VÀ đang bật. */
export function locCarrierCheckout<T extends { key: string | null; enabled: boolean }>(accounts: T[]): T[] {
  return accounts.filter((a) => a.enabled && a.key !== null && CHECKOUT_CARRIER_KEYS.includes(a.key));
}

export interface CheckoutRateCarrier {
  /** Khoá hãng (fedex/dhl) — chỉ dùng để xếp ưu tiên, KHÔNG lộ ra rate. */
  carrierKey: string;
  snapshot: CarrierAccountSnapshot;
}

/**
 * Tính rate ship cho checkout từ engine (B1): quote theo cân + địa chỉ THẬT →
 * cộng được ODA (postcode/city), residential (US/CA), fuel hiện tại. Lấy hãng
 * ưu tiên đầu tiên phục vụ được đích làm giá Standard, Express suy ra từ đó.
 * Không hãng nào phục vụ → []. Thuần, không I/O.
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
  const uuTien = (k: string) => { const i = CHECKOUT_CARRIER_KEYS.indexOf(k); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  const theoUuTien = [...args.carriers].sort((a, b) => uuTien(a.carrierKey) - uuTien(b.carrierKey));
  for (const c of theoUuTien) {
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
    return taoHaiMucRate({ giaStandard: q.breakdown.finalDisplay, currency: c.snapshot.displayCurrency, nuoc: args.country });
  }
  return [];
}
