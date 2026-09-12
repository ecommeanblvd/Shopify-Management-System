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

/**
 * DIỄN BIẾN để TICK thay vì gõ (CEO 12/09/2026: "chọn các option và có note trong trường hợp
 * muốn ghi nhiều thêm"). Mục tiêu là khai báo trong 7 ngày mà không phải viết gì — ô mô tả chỉ
 * dùng khi có chuyện ngoài danh mục.
 *
 * `goiYCho` = tick sẵn cho loại sự cố đó, người nhập bỏ tick được.
 */
export interface DienBien { ma: string; ten: string; goiYCho?: string[] }

export const DIEN_BIEN: DienBien[] = [
  { ma: 'dang_hoan_ve', ten: 'Đang hoàn hàng về', goiYCho: ['sai_dia_chi_giao', 'thieu_chung_tu', 'brand_sai_thong_tin', 'khach_tu_choi'] },
  { ma: 'da_hoan_ve', ten: 'Hàng đã về tới kho' },
  { ma: 'brand_lam_lai_hang', ten: 'Brand phải làm lại hàng', goiYCho: ['sai_dia_chi_giao', 'dong_goi_hong'] },
  { ma: 'da_mua_lai_hang', ten: 'Mình đã mua lại hàng cho khách' },
  { ma: 'da_ship_lai', ten: 'Đã gửi lại kiện mới cho khách' },
  { ma: 'dang_doi_boi_thuong', ten: 'Đang đòi hãng bồi thường', goiYCho: ['hang_lam_mat', 'hang_lam_hong', 'hang_giao_cham'] },
  { ma: 'da_bao_brand', ten: 'Đã thông báo cho brand' },
  { ma: 'da_bao_khach', ten: 'Đã thông báo cho khách nhận' },
  { ma: 'cho_tien_bill', ten: 'Chờ hoá đơn carrier để chốt tiền' },
];

const DIEN_BIEN_THEO_MA = new Map(DIEN_BIEN.map((d) => [d.ma, d]));
export const nhanDienBien = (ma: string): string => DIEN_BIEN_THEO_MA.get(ma)?.ten ?? ma;

/** Diễn biến tick sẵn cho một loại sự cố — để mở form là đã gần đủ, chỉ sửa cái khác. */
export const dienBienGoiY = (maLoai: string): string[] =>
  DIEN_BIEN.filter((d) => d.goiYCho?.includes(maLoai)).map((d) => d.ma);

const THEO_MA = new Map(LOAI_SU_CO.map((l) => [l.ma, l]));
export const layLoaiSuCo = (ma: string | null | undefined): LoaiSuCo | null => (ma ? THEO_MA.get(ma) ?? null : null);

/**
 * HỆ SỐ NGHIÊM TRỌNG khi quy sự cố ra điểm KPI (CEO 12/09/2026).
 *
 * Tiền thiệt hại chưa nói hết mức độ: ship sai địa chỉ do mình nhập sai vừa mất tiền vừa
 * hỏng dịch vụ với khách VÀ với brand đối tác, nặng hơn hẳn một kiện chậm vì lý do khác.
 * Phần nặng thêm đó đánh vào ĐIỂM qua hệ số này, KHÔNG đụng vào số tiền thật — tiền thật
 * còn dùng cho kế toán và cho việc đòi lại, nhân lên sẽ sai sổ.
 *
 * Loại không có tên ở đây mặc định 1,0. Muốn thêm loại nặng thì thêm vào bảng này.
 */
export const HE_SO_NGHIEM_TRONG: Record<string, number> = {
  sai_dia_chi_giao: 2,
};

export const heSoNghiemTrong = (ma: string | null | undefined): number =>
  (ma ? HE_SO_NGHIEM_TRONG[ma] ?? 1 : 1);

/** Hạn phải GHI sự cố vào hệ thống, tính từ ngày sự cố. Quá hạn → trượt Gate Pillar 3. */
export const HAN_GHI_SU_CO_NGAY = 7;

/**
 * Ngày quy định hạn ghi bắt đầu có hiệu lực. Sự cố xảy ra TRƯỚC mốc này được tính hạn từ mốc,
 * không tính từ ngày sự cố — nếu không thì mọi ca cũ đều thành "ghi trễ" và trượt Gate vì một
 * quy định chưa tồn tại lúc đó. Ca KLS2053 (sự cố 25/08, quy định có 12/09) là ví dụ.
 */
export const NGAY_AP_DUNG_HAN_GHI = '2026-09-12';

/** Số ngày từ lúc sự cố xảy ra tới lúc ghi vào hệ thống. Âm (ghi trước ngày sự cố) coi là 0. */
export function soNgayGhiTre(ngaySuCo: string, ngayGhi: string, ngayApDung = NGAY_AP_DUNG_HAN_GHI): number {
  const moc = ngaySuCo.slice(0, 10) < ngayApDung ? ngayApDung : ngaySuCo.slice(0, 10);
  const ms = new Date(ngayGhi).getTime() - new Date(`${moc}T00:00:00Z`).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/**
 * HỆ SỐ HÀNG HOÁ (CEO 12/09/2026).
 *
 * Vấn đề: khi phải sản xuất lại và gửi lại đồ thì giá trị hàng hoá nằm NGOÀI hệ thống, và CEO
 * không muốn nhập tay con số đó — nhập tay thì mỗi lần một kiểu, không ai kiểm được. Thay vào
 * đó lấy phần chi phí hệ thống ĐO ĐƯỢC (cước ship) rồi nhân một tỉ lệ để đại diện cho tiền hàng.
 *
 * Mức 2,0 nghĩa là tiền hàng coi như xấp xỉ bằng tiền cước. Căn cứ: đúng ca KLS2053 — CEO ước
 * tiền đồ khoảng 5tr và tiền nhập lại, gửi lại khoảng 5tr. Chỉ có MỘT ca để hiệu chỉnh nên khi
 * có ca thứ hai, ba thì phải xem lại mức này.
 *
 * TẮT hệ số khi đã có số tiền hàng THẬT: brand báo thu lại và mình lấy được qua đối soát thì ghi
 * thẳng khoản đó, không cần ước nữa.
 */
export const HE_SO_HANG_HOA = 2;

/** Diễn biến cho biết có hàng hoá phải làm lại / mua lại — tức phát sinh tiền ngoài hệ thống. */
export const DIEN_BIEN_HANG_HOA = ['brand_lam_lai_hang', 'da_mua_lai_hang'] as const;

export function heSoHangHoa(dienBien: readonly string[] | null | undefined, coTienHangThat = false): number {
  if (coTienHangThat) return 1;
  const co = (dienBien ?? []).some((m) => (DIEN_BIEN_HANG_HOA as readonly string[]).includes(m));
  return co ? HE_SO_HANG_HOA : 1;
}

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
  /** Chỉ phần quy về lỗi nội bộ — TIỀN THẬT, dùng cho kế toán. */
  thietHaiNoiBoVnd: number;
  /** Tiền thật + phần hàng hoá ước bằng hệ số. Đây là ƯỚC TỔNG THIỆT HẠI, không phải tiền sổ sách. */
  thietHaiQuyDoiVnd: number;
  /** Ước tổng trên, nhân thêm hệ số nghiêm trọng — CHỈ để chấm điểm. */
  thietHaiChamDiemVnd: number;
  /** Số sự cố ghi vào hệ thống muộn quá hạn — điều kiện Gate Pillar 3. */
  nGhiTre: number;
  /** Số sự cố còn để 'khac' tức chưa quy được trách nhiệm — cũng là điều kiện Gate. */
  nChuaQuyTrachNhiem: number;
  /** Số sự cố đã khai báo nhưng chưa chốt tiền — còn phải quay lại điền. */
  nChuaChotTien: number;
}

export interface DongSuCoTomTat {
  loai?: string | null;
  thuocVe: string;
  tongChiPhiVnd: number;
  daThuHoiVnd: number;
  /** false = mới khai báo, chưa chốt tiền. Thiệt hại chưa vào hệ số cho tới khi chốt. */
  daChotTien?: boolean;
  /** Diễn biến đã tick — quyết định có áp hệ số hàng hoá hay không. */
  dienBien?: readonly string[] | null;
  /** true = đã có số tiền hàng THẬT từ đối soát, không cần ước bằng hệ số. */
  coTienHangThat?: boolean;
  /** Ngày sự cố xảy ra và ngày ghi vào hệ thống (ISO). Thiếu thì không tính là ghi trễ. */
  ngay?: string | null;
  ngayGhi?: string | null;
}

/** Gộp danh sách sự cố thành các số hiện trên thẻ KPI. */
export function tomTatSuCo(dong: ReadonlyArray<DongSuCoTomTat>): SuCoTomTat {
  let tong = 0, rong = 0, noiBo = 0, quyDoi = 0, chamDiem = 0, nNoiBo = 0, nGhiTre = 0, nChua = 0, nChuaTien = 0;
  for (const d of dong) {
    const r = thietHaiRong(d.tongChiPhiVnd, d.daThuHoiVnd);
    tong += Math.max(0, Math.round(d.tongChiPhiVnd));
    rong += r;
    if (d.thuocVe === 'noi_bo') {
      // Ba tầng, cố ý tách rời: tiền thật → ước tổng (cộng hàng hoá) → số chấm điểm.
      const uoc = Math.round(r * heSoHangHoa(d.dienBien, d.coTienHangThat));
      noiBo += r;
      quyDoi += uoc;
      chamDiem += Math.round(uoc * heSoNghiemTrong(d.loai));
      nNoiBo += 1;
    }
    if (d.thuocVe === 'khac') nChua += 1;
    if (d.daChotTien === false) nChuaTien += 1;
    if (d.ngay && d.ngayGhi && soNgayGhiTre(d.ngay, d.ngayGhi) > HAN_GHI_SU_CO_NGAY) nGhiTre += 1;
  }
  return {
    n: dong.length, nNoiBo, tongChiPhiVnd: tong, thietHaiRongVnd: rong,
    thietHaiNoiBoVnd: noiBo, thietHaiQuyDoiVnd: quyDoi, thietHaiChamDiemVnd: chamDiem,
    nGhiTre, nChuaQuyTrachNhiem: nChua, nChuaChotTien: nChuaTien,
  };
}
