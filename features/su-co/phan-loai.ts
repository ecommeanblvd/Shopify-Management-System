/**
 * THUẦN: phân loại sự cố, dựng TỪ 156 bản ghi thật của bảng Lark
 * `Incident Management (Cũ)`. Số trong chú thích là số ca đo được.
 */
import { boPhanHopLe, type MaBoPhan } from '@/features/to-chuc/bo-phan';

/**
 * Bỏ tiền tố `(2)`, `(3)` mà Lark để lẫn vào tên lựa chọn.
 *
 * Đây là rác thật, không phải phòng xa: nó tách `delayed_delivery` thành hai
 * lựa chọn 17 ca + 1 ca, và `tax_issue` cũng bị y như vậy.
 */
export function donTienTo(v: string): string {
  return v.trim().replace(/^\(\d+\)\s*/, '');
}

export interface NguyenNhan { ma: string; ten: string }

/** 19 nguyên nhân, xếp theo số ca giảm dần. */
export const NGUYEN_NHAN: NguyenNhan[] = [
  { ma: 'sold_out', ten: 'Hết hàng' },                                          // 67
  { ma: 'delayed_delivery', ten: 'Giao trễ' },                                  // 18
  { ma: 'delayed_production', ten: 'Sản xuất trễ' },                            // 15
  { ma: 'defective_item', ten: 'Hàng lỗi' },                                    // 8
  { ma: 'return_item_not_as_described', ten: 'Trả hàng — khác mô tả' },          // 6
  { ma: 'cancel_delivery_delay', ten: 'Huỷ vì giao trễ' },                      // 6
  { ma: 'return_defective_item', ten: 'Trả hàng — hàng lỗi' },                  // 5
  { ma: 'wrong_item', ten: 'Sai sản phẩm' },                                    // 5
  { ma: 'missing_item', ten: 'Thiếu hàng' },                                    // 5
  { ma: 'tax_issue', ten: 'Vấn đề thuế' },                                      // 5
  { ma: 'delivery_wrong_address', ten: 'Giao sai địa chỉ' },                    // 3
  { ma: 'cancel_due_to_sold_out', ten: 'Huỷ vì hết hàng' },                     // 3
  { ma: 'return_wrong_item', ten: 'Trả hàng — sai sản phẩm' },                  // 3
  { ma: 'package_lost_by_carrier', ten: 'Hãng vận chuyển làm mất kiện' },       // 2
  { ma: 'cancel_not_in_time_for_event', ten: 'Huỷ vì không kịp dịp dùng' },     // 1
  { ma: 'promotion_not_working', ten: 'Khuyến mãi không chạy' },                // 1
  { ma: 'return_shipping_issue', ten: 'Trả hàng — vướng vận chuyển' },          // 1
  { ma: 'returned_item_damaged_by_customer', ten: 'Hàng trả về bị khách làm hỏng' }, // 1
  { ma: 'return_size_issue', ten: 'Trả hàng — sai size' },                      // 1
];

const NN = new Map(NGUYEN_NHAN.map((n) => [n.ma, n]));

export function nguyenNhanHopLe(ma: string): boolean {
  return NN.has(ma);
}

export function nhanNguyenNhan(ma: string | null): string {
  if (!ma) return '—';
  return NN.get(ma)?.ten ?? ma;
}

/** Nguyên nhân từ Lark → mã bên mình. Bỏ tiền tố `(n)` trước khi so. */
export function mapNguyenNhanLark(v: string | null | undefined): string | null {
  const s = donTienTo(v ?? '').toLowerCase();
  if (!s) return null;
  return NN.has(s) ? s : null;
}

export interface LoaiChiPhi { ma: string; ten: string }

/**
 * 8 loại chi phí. `Discount Code` của Lark KHÔNG nằm ở đây: 87 ca khai nó nhưng
 * nó là MỘT MÃ giảm giá, không phải số tiền — nên nó là trường text trên sự cố.
 */
export const LOAI_CHI_PHI: LoaiChiPhi[] = [
  { ma: 'hoan_bank', ten: 'Hoàn qua ngân hàng' },        // 88 ca · 38.781,58
  { ma: 'phi_pickup', ten: 'Phí pick-up' },              // 12 ca · 1.457,44
  { ma: 'phi_gui_lai', ten: 'Phí gửi lại' },             // 13 ca · 834,44
  { ma: 'bu_bang_hang', ten: 'Bù bằng hàng' },           // 2 ca · 772,00
  { ma: 'bu_store_credit', ten: 'Bù store credit' },     // 33 ca · 576,89
  { ma: 'thue', ten: 'Thuế' },                           // 4 ca · 106,57
  { ma: 'doanh_thu_mat', ten: 'Doanh thu mất' },         // 2 ca · 72,84
  { ma: 'khac', ten: 'Khác' },
];

const LCP = new Map(LOAI_CHI_PHI.map((l) => [l.ma, l]));

export function loaiChiPhiHopLe(ma: string): boolean {
  return LCP.has(ma);
}

export function nhanLoaiChiPhi(ma: string | null): string {
  if (!ma) return '—';
  return LCP.get(ma)?.ten ?? ma;
}

/**
 * Cột tiền của Lark → loại chi phí bên mình. Khoá là TÊN CỘT, vì bảng Lark dùng
 * 8 cột tiền riêng (chính cái mô hình mà module này thay).
 */
export const COT_TIEN_LARK: Record<string, string> = {
  'Refund - Bank account': 'hoan_bank',
  'Compensation Fee - Store Credit': 'bu_store_credit',
  'In-kind Compensation': 'bu_bang_hang',
  'Reshipping Cost': 'phi_gui_lai',
  'Pick-up Fee': 'phi_pickup',
  'Tax Coverage Cost': 'thue',
  'Potential Revenue Lost': 'doanh_thu_mat',
};

/** Giá trị `Incident Type` của Lark → loại chi phí, để bắt "khai mà không có số". */
export const LOAI_KHAI_LARK: Record<string, string> = {
  'Refund - Bank account': 'hoan_bank',
  'Compensation Fee - SC': 'bu_store_credit',
  'In-kind Compensation': 'bu_bang_hang',
  'Reshipping Cost': 'phi_gui_lai',
  'Pick-up Fee': 'phi_pickup',
  'Tax Coverage Cost': 'thue',
  'Potential Revenue Lost': 'doanh_thu_mat',
};

/**
 * Tên bộ phận của bảng SỰ CỐ → mã dùng chung.
 *
 * Bảng sự cố gọi `Warehouse`/`Logistic`, bảng ticket gọi `DISCO-WH`/`DISCO-LOG` —
 * cùng bộ phận, hai cách viết. Không dịch là mất 38 ca quy trách nhiệm.
 */
const BO_PHAN_LARK: Record<string, MaBoPhan> = {
  procurement: 'PROCUREMENT',
  merchandise: 'MERCHANDISE',
  warehouse: 'DISCO-WH',
  logistic: 'DISCO-LOG',
  logistics: 'DISCO-LOG',
  'cx - cs': 'CX-CS',
  'cx-cs': 'CX-CS',
  'product portfolio': 'PRODUCT-PORTFOLIO',
  china: 'CHINA',
};

export function mapBoPhanLark(v: string | null | undefined): string | null {
  const s = (v ?? '').trim().toLowerCase();
  if (!s) return null;
  const m = BO_PHAN_LARK[s];
  if (m) return m;
  // Đã là mã chuẩn rồi thì nhận luôn — tránh phải khai hai chiều.
  const hoa = (v ?? '').trim().toUpperCase();
  return boPhanHopLe(hoa) ? hoa : null;
}

export const GIAI_DOAN = [
  { ma: 'truoc_mua', ten: 'Trước khi mua' },   // 1 ca
  { ma: 'mua', ten: 'Khi mua' },               // 93 ca
  { ma: 'sau_mua', ten: 'Sau khi mua' },       // 62 ca
] as const;

export function mapGiaiDoanLark(v: string | null | undefined): string | null {
  const s = (v ?? '').trim().toLowerCase().replace(/\s*-\s*/g, '-');
  if (s.startsWith('pre')) return 'truoc_mua';
  if (s.startsWith('post')) return 'sau_mua';
  if (s.startsWith('purchase')) return 'mua';
  return null;
}

export const TRANG_THAI = ['mo', 'dang_xu_ly', 'xong'] as const;
export type TrangThai = (typeof TRANG_THAI)[number];

export const NHAN_TRANG_THAI: Record<TrangThai, string> = {
  mo: 'Mới', dang_xu_ly: 'Đang xử lý', xong: 'Đã xong',
};

/**
 * `Status` của Lark → trạng thái bên mình. Trống (58/156 = 37%) coi là `mo`:
 * thà hiện ra để CX rà còn hơn âm thầm đóng một hồ sơ chưa ai xử lý.
 */
export function mapTrangThaiLark(v: string | null | undefined): TrangThai {
  const s = (v ?? '').trim().toLowerCase();
  if (s === 'resolved') return 'xong';
  if (s === 'in progress') return 'dang_xu_ly';
  return 'mo';
}

/** Mã sự cố đọc được: `SC-0001`. */
export function maSuCo(so: number): string {
  return `SC-${String(so).padStart(4, '0')}`;
}
