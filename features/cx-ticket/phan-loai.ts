/**
 * THUẦN: phân loại ticket CX, dựng TỪ 675 ticket thật trên bảng Lark `CX - To Do`.
 *
 * Số trong chú thích là số ca đo được. Bộ này ĐÃ DỌN so với Lark:
 *  - gộp các cặp trùng nghĩa (`Processing Time` + `Production Time`,
 *    `Change Size` + `Size Issue`, `Order Update` + `Order Status`);
 *  - sửa lỗi gõ của Lark (`Managerment`, `Delevery`);
 *  - BỎ các lựa chọn Lark khai mà chưa ai dùng lần nào (Pre/Purchase/
 *    Post-Purchase, Return Issue, Refund Issue, Web & Account Issue…) — giữ
 *    chúng chỉ làm người nhập phải đọc thêm 9 dòng vô nghĩa.
 *
 * KHÔNG dùng enum Postgres cho các mã này: thêm một loại vấn đề mới không được
 * phép cần migration.
 */

export interface LoaiTicket { ma: string; ten: string }
export interface NhomTicket { ma: string; ten: string; loai: LoaiTicket[] }

export const NHOM: NhomTicket[] = [
  {
    ma: 'don_hang', ten: 'Vấn đề quản lý đơn',                 // 503
    loai: [
      { ma: 'thoi_gian_xu_ly', ten: 'Thời gian xử lý' },        // 179
      { ma: 'het_hang', ten: 'Hết hàng' },                      // 92
      { ma: 'so_do', ten: 'Thông tin số đo / may đo' },         // 71
      { ma: 'khach_huy', ten: 'Khách huỷ' },                    // 28
      { ma: 'sua_thiet_ke', ten: 'Sửa thiết kế' },              // 20
      { ma: 'doi_size', ten: 'Đổi size' },                      // 20
      { ma: 'san_xuat_tre', ten: 'Sản xuất trễ' },              // 18
      { ma: 'cap_nhat_don', ten: 'Cập nhật đơn' },              // 18
      { ma: 'nghi_mua_nham', ten: 'Nghi mua nhầm' },            // 14
      { ma: 'khach_giu_don', ten: 'Giữ đơn' },                  // 14
      { ma: 'qc_khong_dat', ten: 'QC không đạt' },              // 10
      { ma: 'khac', ten: 'Khác' },                              // 13
    ],
  },
  {
    ma: 'truoc_khi_gui', ten: 'Vấn đề trước khi gửi',           // 108
    loai: [
      { ma: 'dia_chi_khong_hop_le', ten: 'Địa chỉ không hợp lệ' }, // 107
      { ma: 'doi_dia_chi', ten: 'Đổi địa chỉ' },                   // 5
    ],
  },
  {
    ma: 'su_co_van_chuyen', ten: 'Sự cố vận chuyển',            // 24
    loai: [
      { ma: 'giao_that_bai', ten: 'Giao không thành công' },        // 10
      { ma: 'thieu_thong_tin', ten: 'Hãng vận chuyển cần thêm thông tin' }, // 9
      { ma: 'cho_nhan_buu_cuc', ten: 'Chờ khách nhận tại bưu cục' },       // 3
      { ma: 'thong_quan', ten: 'Vướng thông quan' },                       // 2
    ],
  },
];

const THEO_MA = new Map(NHOM.map((n) => [n.ma, n]));

export function nhomHopLe(nhom: string): boolean {
  return THEO_MA.has(nhom);
}

/** Loại phải thuộc ĐÚNG nhóm đó — `dia_chi_khong_hop_le` trong nhóm `don_hang`
 *  là dữ liệu vô nghĩa, và đúng kiểu rác Lark đang có ở cột `Text 13`. */
export function loaiHopLe(nhom: string, loai: string): boolean {
  return THEO_MA.get(nhom)?.loai.some((l) => l.ma === loai) ?? false;
}

/** Nhãn đọc được: `"Vấn đề quản lý đơn · Hết hàng"`. */
export function nhanLoai(nhom: string, loai: string): string {
  const n = THEO_MA.get(nhom);
  if (!n) return `${nhom} · ${loai}`;
  const l = n.loai.find((x) => x.ma === loai);
  return l ? `${n.ten} · ${l.ten}` : n.ten;
}

/* Danh sách bộ phận CHUYỂN sang `features/to-chuc/bo-phan.ts` (28/09) vì module
 * sự cố cũng dùng. Export lại ở đây để mọi nơi đang import từ file này không phải
 * sửa. */
export {
  BO_PHAN, boPhanHopLe, nhanBoPhan, type MaBoPhan,
} from '@/features/to-chuc/bo-phan';

/** Mã ticket đọc được: `CXT-0001`. Đệm 4 chữ số, quá 9999 thì dài ra tự nhiên. */
export function maTicket(so: number): string {
  return `CXT-${String(so).padStart(4, '0')}`;
}
