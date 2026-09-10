import { slaCuaNuoc } from '@/features/shipments/sop-giao-hang';

/**
 * Hai mức giao ở CHECKOUT — "Standard Shipping" và "Express Shipping" (CEO chốt
 * 10/09/2026, D-071). Khách chỉ thấy MỨC DỊCH VỤ, không thấy tên hãng: hãng nào
 * chạy phía sau là việc của logistics (FedEx / DHL / Aramex chọn sau khi có đơn).
 *
 * Cả hai mức dựng từ MỘT báo giá engine cho địa chỉ thật (ODA, nhà dân, fuel):
 *   Standard = giá engine;  Express = Standard + phụ phí ưu tiên.
 * Vì Express suy ra từ Standard nên Standard LUÔN rẻ hơn — không phụ thuộc hãng nào
 * rẻ hơn ở tuyến nào (dữ liệu 2026: Mỹ DHL rẻ hơn FedEx, Vùng Vịnh FedEx rẻ hơn
 * DHL gấp đôi — không hãng nào rẻ hơn ở mọi tuyến).
 */
export const TEN_MUC = { standard: 'Standard Shipping', express: 'Express Shipping' } as const;
export type MaMuc = keyof typeof TEN_MUC;

/** Phụ phí Express so với Standard (%). Một chỗ duy nhất để CEO điều chỉnh. */
export const PHU_PHI_EXPRESS_PHAN_TRAM = 20;
/** Giá Express làm tròn LÊN theo bước này (đơn vị hiển thị, ví dụ 0,5 USD). */
export const BUOC_LAM_TRON = 0.5;

/** Định dạng rate Shopify CarrierService mong đợi. total_price = đơn vị nhỏ nhất
 *  của tiền tệ (cents với USD), dạng chuỗi. */
export interface ShopifyCheckoutRate {
  service_name: string;
  service_code: string;
  total_price: string;
  currency: string;
  description?: string;
}

/** Giá Express từ giá Standard: +phụ phí, làm tròn lên theo bước; luôn > Standard. */
export function giaExpress(giaStandard: number, phanTram = PHU_PHI_EXPRESS_PHAN_TRAM): number {
  const tho = giaStandard * (1 + phanTram / 100);
  const lamTron = Math.ceil(tho / BUOC_LAM_TRON - 1e-9) * BUOC_LAM_TRON;
  const gia = Math.round(lamTron * 100) / 100;
  return gia > giaStandard ? gia : Math.round((giaStandard + BUOC_LAM_TRON) * 100) / 100;
}

/**
 * Mô tả hiện dưới tên rate ở checkout. Số ngày lấy từ bảng cam kết SOP theo nước
 * (`sop-giao-hang.ts`) — cùng con số đội logistics bị chấm KPI, không hứa riêng.
 * Khác biệt giữa hai mức là ƯU TIÊN XỬ LÝ (Express đóng và gửi trước), không hứa
 * thời gian bay khác nhau vì cùng một tuyến.
 */
export function moTaMuc(ma: MaMuc, nuoc: string): string {
  const ngay = slaCuaNuoc(nuoc);
  const bay = `about ${ngay} days in transit`;
  return ma === 'express' ? `Priority handling, dispatched first · ${bay}` : `Standard handling · ${bay}`;
}

/** Dựng ĐÚNG hai rate từ một giá Standard (giá engine ở đơn vị hiển thị). */
export function taoHaiMucRate(args: { giaStandard: number; currency: string; nuoc: string }): ShopifyCheckoutRate[] {
  const cents = (v: number) => String(Math.round(v * 100));
  return [
    { service_name: TEN_MUC.standard, service_code: 'standard', total_price: cents(args.giaStandard), currency: args.currency, description: moTaMuc('standard', args.nuoc) },
    { service_name: TEN_MUC.express, service_code: 'express', total_price: cents(giaExpress(args.giaStandard)), currency: args.currency, description: moTaMuc('express', args.nuoc) },
  ];
}

/** Từ khoá tên hãng KHÔNG được lộ ra checkout (test canh + guard runtime). */
const TU_KHOA_HANG = /fedex|dhl|aramex|\bups\b|sf[- ]?express/i;
export function loTenHang(chuoi: string): boolean {
  return TU_KHOA_HANG.test(chuoi);
}
