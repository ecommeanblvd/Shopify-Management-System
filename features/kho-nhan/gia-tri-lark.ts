/**
 * Bộ cột gửi sang bảng Lark "WH - Inventory" và danh sách giá trị hợp lệ.
 *
 * Các cột QC Check / WH - Action / Warehouse / Store final / Vendor final là cột CHỌN: ghi một
 * giá trị lạ thì Lark đẻ thêm lựa chọn mới, làm hỏng bộ lọc và báo cáo của cả đội. Nên tên ở
 * đây lấy NGUYÊN của Lark (khảo sát 22/09/2026), không đặt tên mới cho đẹp.
 */
export const QC_CHECK = ['QC Pass', 'QC Failed', 'Gửi dư'] as const;
export const WH_ACTION = [
  'Tạm nhập (đi đơn)', 'Lưu kho', 'Gửi trả Vendor (QC fail)', 'Hoàn trả brand (return)', 'Trả lại Vendor (đồ mượn)',
] as const;
export const WAREHOUSE = ['HN | GVM', 'SG | AP', 'TQ | CG', 'PHSG'] as const;

export type QcCheck = typeof QC_CHECK[number];
export type WhAction = typeof WH_ACTION[number];
export type Warehouse = typeof WAREHOUSE[number];

import { ngayLark } from '@/features/lark/ghi-nguoc/ngay-lark';

export interface ViecNhanKcs {
  monDinhDanh: string;
  monRecordId: string | null;
  orderNumber: string;
  sku: string | null;
  lineitemName: string | null;
  store: string | null;
  vendor: string | null;
  soLuong: number;
  canKg: number | null;
  qcCheck: QcCheck;
  whAction: WhAction;
  lyDoFail: string | null;
  warehouse: Warehouse;
}

/** THUẦN: bộ cột TẠO dòng kho mới — đúng những cột kho đang tự điền tay. */
export function cotTaoDong(v: ViecNhanKcs, ngay: Date): Record<string, unknown> {
  const c: Record<string, unknown> = {
    'Order Number final': v.orderNumber,
    Warehouse: v.warehouse,
    'Import - Inventory type': 'Retail',
    // Dùng ĐÚNG hàm chiều-ghi của repo (ghi-nguoc/ngay-lark.ts) để ngày trên Lark trùng nếp
    // với mọi chỗ khác SMS đang ghi, thay vì tự tính một kiểu riêng.
    'Ngày Import - tiếp nhận đồ tại kho': ngayLark(ngay),
    'Quantity tiếp nhận trước QC': v.soLuong,
    'QC Check': v.qcCheck,
    'WH - Action': v.whAction,
  };
  // Cột trống thì BỎ HẲN, không gửi chuỗi rỗng: Lark coi '' là một lựa chọn mới ở cột chọn.
  if (v.sku) c['Lineitem SKU final'] = v.sku;
  if (v.monRecordId) c['Import (select order)'] = [v.monRecordId];
  if (v.lineitemName) c['Lineitem Name'] = v.lineitemName;
  if (v.store) c['Store final'] = v.store;
  if (v.vendor) c['Vendor final'] = v.vendor;
  if (v.canKg != null) c['Weight (kg)'] = v.canKg;
  if (v.lyDoFail) c['Lý do QC failed'] = v.lyDoFail;
  return c;
}

/**
 * THUẦN: bộ cột CẬP NHẬT dòng có sẵn — chỉ kết quả kho vừa nhập, không đụng định danh.
 *
 * `xoaLyDo`: chỉ bật khi món THẬT SỰ rời khỏi "QC Failed" (người gọi biết giá trị cũ trên
 * Lark). Xoá vô điều kiện thì mỗi lần sửa cân cũng thổi bay lý do hỏng người khác đã ghi —
 * 8.858/9.007 dòng Lark đã có kết quả nên đó là trường hợp THƯỜNG, không phải hiếm.
 */
export function cotCapNhat(v: ViecNhanKcs, xoaLyDo: boolean): Record<string, unknown> {
  const c: Record<string, unknown> = {
    'Quantity tiếp nhận trước QC': v.soLuong,
    'QC Check': v.qcCheck,
    'WH - Action': v.whAction,
  };
  if (v.canKg != null) c['Weight (kg)'] = v.canKg;
  // Kiểm lại thành đạt thì XOÁ lý do hỏng cũ, không để nguyên trên Lark cho người sau đọc
  // nhầm là món vẫn lỗi. Ngoài hai trường hợp này thì KHÔNG gửi cột lý do.
  if (v.lyDoFail) c['Lý do QC failed'] = v.lyDoFail;
  else if (xoaLyDo) c['Lý do QC failed'] = '';
  return c;
}
