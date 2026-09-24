/**
 * THUẦN: chuẩn hoá mã đơn để so được giữa hai bảng.
 *
 * `lark_mon_don.order_number` lưu "MBLVD26763" còn `shopify_orders.shopify_order_number`
 * lưu "#MBLVD2009". Đo 24/09: ghép thẳng ra 597/7.150, chuẩn hoá bỏ `#` ra 6.168 (86%).
 * Quên chuẩn hoá thì truy vấn trả GẦN NHƯ RỖNG mà không có lỗi nào báo.
 */
export function chuanHoaMaDon(s: string): string {
  return s.trim().replace(/^#/, '');
}
