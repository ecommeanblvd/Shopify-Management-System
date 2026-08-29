import { isDefaultResidential } from './residential-default';

/**
 * Địa chỉ đơn có phải nhà dân không, ƯU TIÊN kết quả FedEx Address Validation đã
 * lưu trên đơn (`shopify_orders.addr_class`) thay vì đoán theo nước.
 *
 * Vì sao cần: cách đoán cũ coi MỌI đơn US/CA là nhà dân, trong khi thực tế đã
 * verify được 121 đơn US là BUSINESS — những đơn đó bị tính dư phí giao nhà dân.
 * Ngược lại đơn chưa verify vẫn phải có số để báo giá, nên rơi về mặc định theo
 * nước (US/CA) — trùng đúng cách checkout và bảng giá hệ thống đang làm.
 *
 * MIXED = FedEx không tách được (toà nhà vừa ở vừa kinh doanh) → xử như chưa
 * biết, dùng mặc định theo nước; đoán "business" ở đây là tự bỏ phí sẽ bị thu.
 */
export function laNhaDan(addrClass: string | null | undefined, country: string | null | undefined): boolean {
  const c = (addrClass ?? '').trim().toUpperCase();
  if (c === 'RESIDENTIAL') return true;
  if (c === 'BUSINESS') return false;
  return isDefaultResidential(country ?? '');
}
