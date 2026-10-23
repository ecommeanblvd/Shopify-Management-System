/**
 * Phân loại báo lỗi: module, mức độ, trạng thái. Thuần logic, không đụng DB — để cả nút
 * báo lỗi (client) lẫn API lẫn trang admin dùng chung một bảng giá trị.
 */

/** Module suy từ đầu đường dẫn. Khớp theo tiền tố DÀI NHẤT trước; không khớp → "Khác". */
const MODULES: ReadonlyArray<{ tienTo: string; ma: string; nhan: string }> = [
  { tienTo: '/f/orders', ma: 'orders', nhan: 'Orders' },
  { tienTo: '/f/fulfillment', ma: 'fulfillment', nhan: 'Quản lí đơn' },
  { tienTo: '/f/lifecycle', ma: 'fulfillment', nhan: 'Quản lí đơn' },
  { tienTo: '/f/dong-hang', ma: 'dong-hang', nhan: 'Đóng hàng' },
  { tienTo: '/f/warehouse', ma: 'warehouse', nhan: 'Kho hàng' },
  { tienTo: '/f/carrier-rates', ma: 'carrier-rates', nhan: 'Carrier rates' },
  { tienTo: '/f/ship-ho', ma: 'ship-ho', nhan: 'Ship hộ' },
  { tienTo: '/f/kol', ma: 'kol', nhan: 'Đơn KOL' },
  { tienTo: '/f/cx', ma: 'cx', nhan: 'CX' },
  { tienTo: '/f/shipping-reconcile', ma: 'shipping-reconcile', nhan: 'Đối soát phí ship' },
  { tienTo: '/f/ship-report', ma: 'ship-report', nhan: 'Báo cáo ship / KPI' },
  { tienTo: '/f/mmp', ma: 'mmp', nhan: 'Products' },
  { tienTo: '/f/functions', ma: 'functions', nhan: 'Functions' },
  { tienTo: '/f/customer-account', ma: 'functions', nhan: 'Functions' },
  { tienTo: '/f/settings-sync', ma: 'settings-sync', nhan: 'Settings Sync' },
  { tienTo: '/f/settings-viewer', ma: 'settings-sync', nhan: 'Settings Sync' },
  { tienTo: '/f/markets', ma: 'markets', nhan: 'Markets' },
  { tienTo: '/f/jobs', ma: 'jobs', nhan: 'Tác vụ nền' },
  { tienTo: '/f/nhat-ky', ma: 'nhat-ky', nhan: 'Nhật ký' },
  { tienTo: '/f/can-san-pham', ma: 'can-san-pham', nhan: 'Sửa cân sản phẩm' },
  { tienTo: '/admin', ma: 'admin', nhan: 'Admin' },
  { tienTo: '/stores', ma: 'stores', nhan: 'Stores' },
  { tienTo: '/settings', ma: 'settings', nhan: 'Settings' },
];

export const MODULE_KHAC = { ma: 'khac', nhan: 'Khác' } as const;

/** Danh sách module cho ô chọn: mỗi `ma` một lần (vài tiền tố gom chung), "Khác" ở cuối. */
export const DANH_SACH_MODULE: ReadonlyArray<{ ma: string; nhan: string }> = [
  ...MODULES.filter((m, i) => MODULES.findIndex((x) => x.ma === m.ma) === i)
    .map(({ ma, nhan }) => ({ ma, nhan })),
  { ...MODULE_KHAC },
];

export const moduleHopLe = (v: string) => DANH_SACH_MODULE.some((m) => m.ma === v);
export const nhanModule = (ma: string) => DANH_SACH_MODULE.find((m) => m.ma === ma)?.nhan ?? ma;

export function moduleTuDuongDan(pathname: string): { ma: string; nhan: string } {
  const p = pathname.split('?')[0].split('#')[0];
  let tot: (typeof MODULES)[number] | null = null;
  for (const m of MODULES) {
    if ((p === m.tienTo || p.startsWith(`${m.tienTo}/`))
      && (!tot || m.tienTo.length > tot.tienTo.length)) tot = m;
  }
  return tot ? { ma: tot.ma, nhan: tot.nhan } : { ...MODULE_KHAC };
}

export const MUC_DO = [
  { ma: 'thap', nhan: 'Thấp — làm phiền nhỏ' },
  { ma: 'trung_binh', nhan: 'Trung bình — có cách lách' },
  { ma: 'cao', nhan: 'Cao — sai kết quả / không dùng được tính năng' },
  { ma: 'chan_cong_viec', nhan: 'Chặn công việc — không làm tiếp được' },
] as const;
export type MucDo = (typeof MUC_DO)[number]['ma'];
export const mucDoHopLe = (v: string): v is MucDo => MUC_DO.some((m) => m.ma === v);

/**
 * Vòng đời. `can_nguoi` là trạng thái QUAN TRỌNG: bot gặp việc cần quyết định nghiệp vụ,
 * cần áp migration tay, hoặc không tái hiện được thì dừng ở đây thay vì đoán — admin lọc
 * trạng thái này mỗi sáng để biết cái gì cần mình.
 */
export const TRANG_THAI = [
  { ma: 'moi', nhan: 'Mới' },
  { ma: 'dang_xu_ly', nhan: 'Đang xử lý' },
  { ma: 'cho_duyet', nhan: 'Chờ duyệt PR' },
  { ma: 'da_xong', nhan: 'Đã xong' },
  { ma: 'can_nguoi', nhan: 'Cần người quyết' },
  { ma: 'tu_choi', nhan: 'Không phải lỗi' },
] as const;
export type TrangThai = (typeof TRANG_THAI)[number]['ma'];
export const trangThaiHopLe = (v: string): v is TrangThai => TRANG_THAI.some((t) => t.ma === v);
export const nhanTrangThai = (v: string) => TRANG_THAI.find((t) => t.ma === v)?.nhan ?? v;
export const nhanMucDo = (v: string) => MUC_DO.find((m) => m.ma === v)?.nhan.split(' — ')[0] ?? v;

/** Còn việc cho bot: chưa ai chạm tới. `dang_xu_ly` không tính để hai lượt chạy không dẫm nhau. */
export const CON_VIEC_CHO_BOT: readonly TrangThai[] = ['moi'];

export const GIOI_HAN = { tieuDe: 120, moTa: 4000, ghiChu: 4000, duongDan: 500, prUrl: 500 } as const;

export function maBaoLoi(so: number): string {
  return `BL-${so}`;
}
