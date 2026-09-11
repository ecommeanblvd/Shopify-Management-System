/**
 * THUẦN: danh mục SỰ CỐ đơn ship hộ và cách cộng tiền thiệt hại (CEO 11/09/2026).
 *
 * Vì sao cần: Pillar 2 trước đây chỉ đếm sản lượng đơn, nên một đơn chạy trơn tru và
 * một đơn giao sai địa chỉ phải hoàn hàng, mua lại món hàng brand sản xuất lại rồi
 * ship lần hai đều được tính như nhau. Có danh mục sự cố thì lỗi mới nhìn thấy được
 * và quy được về tiền.
 *
 * Một sự cố kéo theo NHIỀU khoản chi, nên chi phí là danh sách khoản chứ không phải
 * một con số — để sau này còn biết tiền đi đâu.
 */
export type ThuocVe = 'noi_bo' | 'brand' | 'khach' | 'hang_van_chuyen' | 'khac';

export const NHAN_THUOC_VE: Record<ThuocVe, string> = {
  noi_bo: 'Lỗi nội bộ (vị trí logistics)',
  brand: 'Lỗi brand đối tác',
  khach: 'Lỗi khách nhận',
  hang_van_chuyen: 'Lỗi hãng vận chuyển',
  khac: 'Khác / chưa quy được',
};

export interface LoaiSuCo {
  ma: string;
  ten: string;
  /** Mặc định quy về ai — người nhập vẫn sửa được cho từng ca. */
  macDinhThuocVe: ThuocVe;
  /** Gợi ý các khoản tiền thường phát sinh, để người nhập không bỏ sót. */
  khoanGoiY: string[];
}

export const LOAI_SU_CO: LoaiSuCo[] = [
  {
    ma: 'sai_dia_chi_giao', ten: 'Giao sai địa chỉ người nhận', macDinhThuocVe: 'noi_bo',
    khoanGoiY: ['Cước hoàn hàng về', 'Mua lại hàng cho khách', 'Cước ship lại lần hai'],
  },
  { ma: 'sai_thong_tin_van_don', ten: 'Sai thông tin trên vận đơn', macDinhThuocVe: 'noi_bo', khoanGoiY: ['Phí sửa vận đơn', 'Cước ship lại'] },
  { ma: 'thieu_chung_tu', ten: 'Thiếu hoặc sai chứng từ xuất khẩu', macDinhThuocVe: 'noi_bo', khoanGoiY: ['Phí lưu kho', 'Cước hoàn hàng về'] },
  { ma: 'gui_tre', ten: 'Gửi hàng trễ so với cam kết với brand', macDinhThuocVe: 'noi_bo', khoanGoiY: ['Bồi thường brand'] },
  { ma: 'dong_goi_hong', ten: 'Đóng gói không đạt làm hỏng hàng', macDinhThuocVe: 'noi_bo', khoanGoiY: ['Mua lại hàng cho khách', 'Cước ship lại lần hai'] },
  { ma: 'hang_lam_mat', ten: 'Hãng làm mất kiện', macDinhThuocVe: 'hang_van_chuyen', khoanGoiY: ['Giá trị hàng mất', 'Cước đã trả', 'Tiền đòi bồi thường'] },
  { ma: 'hang_lam_hong', ten: 'Hãng làm hỏng hàng', macDinhThuocVe: 'hang_van_chuyen', khoanGoiY: ['Giá trị hàng hỏng', 'Tiền đòi bồi thường'] },
  { ma: 'hang_giao_cham', ten: 'Hãng giao chậm quá cam kết', macDinhThuocVe: 'hang_van_chuyen', khoanGoiY: ['Bồi thường brand'] },
  { ma: 'brand_sai_thong_tin', ten: 'Brand cung cấp sai thông tin người nhận', macDinhThuocVe: 'brand', khoanGoiY: ['Cước hoàn hàng về', 'Cước ship lại lần hai'] },
  { ma: 'khach_tu_choi', ten: 'Khách từ chối nhận / không đóng thuế', macDinhThuocVe: 'khach', khoanGoiY: ['Cước hoàn hàng về', 'Thuế phí đã ứng'] },
  { ma: 'khac', ten: 'Khác (ghi rõ trong mô tả)', macDinhThuocVe: 'khac', khoanGoiY: [] },
];

const THEO_MA = new Map(LOAI_SU_CO.map((l) => [l.ma, l]));
export const layLoaiSuCo = (ma: string | null | undefined): LoaiSuCo | null => (ma ? THEO_MA.get(ma) ?? null : null);

export interface KhoanChiPhi { khoan: string; tienVnd: number }

/** Tổng tiền của một sự cố. Khoản âm hoặc không phải số bị bỏ qua, không làm lệch tổng. */
export function tongChiPhi(khoan: readonly KhoanChiPhi[]): number {
  return Math.round(khoan.reduce((s, k) => s + (Number.isFinite(k.tienVnd) && k.tienVnd > 0 ? k.tienVnd : 0), 0));
}

/** Thiệt hại RÒNG sau khi đòi lại được (bảo hiểm, hãng bồi thường, brand trả). */
export function thietHaiRong(tong: number, daThuHoi: number): number {
  return Math.max(0, Math.round(tong - Math.max(0, daThuHoi)));
}

export interface SuCoTomTat {
  n: number;
  nNoiBo: number;
  tongChiPhiVnd: number;
  thietHaiRongVnd: number;
  /** Chỉ phần quy về lỗi nội bộ — đây mới là số chấm KPI của vị trí. */
  thietHaiNoiBoVnd: number;
}

/** Gộp danh sách sự cố thành các số hiện trên thẻ KPI. */
export function tomTatSuCo(
  dong: ReadonlyArray<{ thuocVe: string; tongChiPhiVnd: number; daThuHoiVnd: number }>,
): SuCoTomTat {
  let tong = 0, rong = 0, noiBo = 0, nNoiBo = 0;
  for (const d of dong) {
    const r = thietHaiRong(d.tongChiPhiVnd, d.daThuHoiVnd);
    tong += Math.max(0, Math.round(d.tongChiPhiVnd));
    rong += r;
    if (d.thuocVe === 'noi_bo') { noiBo += r; nNoiBo += 1; }
  }
  return { n: dong.length, nNoiBo, tongChiPhiVnd: tong, thietHaiRongVnd: rong, thietHaiNoiBoVnd: noiBo };
}
