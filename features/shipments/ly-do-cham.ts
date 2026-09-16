/**
 * THUẦN: danh mục LÝ DO GIAO CHẬM cho kiện vượt ngưỡng (CEO duyệt 10/09/2026).
 *
 * Danh mục này là thứ nhân sự logistics chọn ngay trên bảng chi tiết KPI 1.2, nên nó phải nói đúng
 * ngôn ngữ của việc thật: tách chứng từ thông quan hai đầu, tách chuyện khách không đóng thuế.
 *
 * Trước đây hệ thống chỉ tách được "chậm bất thường" theo ngưỡng ngày, không biết vì sao. Có lý do rồi thì:
 *   - báo cáo tách được "không liên hệ được khách" với "kẹt thông quan";
 *   - KPI nhân sự loại trừ đúng những lý do Quy chế mục VII đã ghi là ngoài tầm kiểm soát của vị trí.
 * Lưu ý: SOP (đo trải nghiệm khách) vẫn tính MỌI kiện, không loại trừ — chỉ KPI nhân sự mới loại.
 */
export interface LyDoCham {
  ma: string;
  ten: string;
  /** Quy chế mục VII coi là ngoài tầm kiểm soát → không tính vào KPI nhân sự. */
  loaiTruKpi: boolean;
  /** Ai phải xử lý — để báo cáo quy được việc. */
  thuocVe: 'khach' | 'hai_quan' | 'hang_van_chuyen' | 'noi_bo' | 'khac';
}

export const LY_DO_CHAM: LyDoCham[] = [
  { ma: 'khach_khong_lien_he', ten: 'Không liên hệ được khách để giao', loaiTruKpi: true, thuocVe: 'khach' },
  { ma: 'khach_hen_lai', ten: 'Khách hẹn giao lại / vắng nhà', loaiTruKpi: true, thuocVe: 'khach' },
  { ma: 'sai_dia_chi_khach', ten: 'Địa chỉ khách cung cấp sai', loaiTruKpi: true, thuocVe: 'khach' },
  { ma: 'khach_khong_dong_thue', ten: 'Khách không đóng thuế / phí nhập khẩu', loaiTruKpi: true, thuocVe: 'khach' },
  { ma: 'khach_tu_choi_nhan', ten: 'Khách từ chối nhận hàng', loaiTruKpi: true, thuocVe: 'khach' },
  // Chứng từ thông quan vẫn tách HAI ĐẦU để biết thiếu ở đâu, nhưng CẢ HAI đều là lỗi nội bộ
  // (CEO 16/09/2026: "giấy tờ thông quan phía đầu xuất hay nhập không đủ là lỗi nội bộ chứ không
  // phải lỗi bên khách quan") — thay quy ước 11/09 coi đầu nhập là việc của người nhận. Chuẩn bị
  // và nhắc người nhận nộp đủ giấy tờ là việc của vị trí logistics.
  { ma: 'thong_quan_thieu_ct_nhap', ten: 'Thiếu giấy tờ thông quan đầu nhập', loaiTruKpi: false, thuocVe: 'noi_bo' },
  // Chỉ loại khi hải quan giữ hàng mà KHÔNG phải vì thiếu giấy tờ — xem luật đối chiếu.
  { ma: 'thong_quan_ngoai', ten: 'Hải quan giữ hàng — không do thiếu giấy tờ', loaiTruKpi: true, thuocVe: 'hai_quan' },
  { ma: 'thien_tai_ha_tang', ten: 'Thiên tai / sự cố hạ tầng carrier', loaiTruKpi: true, thuocVe: 'hang_van_chuyen' },
  { ma: 'thong_quan_thieu_ct_xuat', ten: 'Thiếu hoặc sai giấy tờ thông quan đầu xuất (của mình)', loaiTruKpi: false, thuocVe: 'noi_bo' },
  { ma: 'sai_thong_tin_van_don', ten: 'Sai thông tin khi tạo vận đơn', loaiTruKpi: false, thuocVe: 'noi_bo' },
  { ma: 'gui_tre_so_voi_don', ten: 'Gửi hàng trễ so với ngày chốt đơn', loaiTruKpi: false, thuocVe: 'noi_bo' },
  { ma: 'hang_cham_khong_ro', ten: 'Hãng giao chậm, chưa rõ nguyên nhân', loaiTruKpi: false, thuocVe: 'hang_van_chuyen' },
  { ma: 'khac', ten: 'Khác (ghi rõ trong ghi chú)', loaiTruKpi: false, thuocVe: 'khac' },
];

const THEO_MA = new Map(LY_DO_CHAM.map((l) => [l.ma, l]));
export const layLyDo = (ma: string | null | undefined): LyDoCham | null => (ma ? THEO_MA.get(ma) ?? null : null);
/** Kiện có được loại khỏi KPI nhân sự không (chưa gán lý do → KHÔNG loại, tránh lách bằng cách bỏ trống). */
export const loaiTruKhoiKpi = (ma: string | null | undefined): boolean => layLyDo(ma)?.loaiTruKpi ?? false;

/**
 * Lý do có ĐƯỢC loại kiện khỏi KPI không: phải là lý do ngoài tầm kiểm soát VÀ đã được hãng xác
 * nhận bằng lịch sử quét (CEO 16/09/2026 — xem `doi-chieu-fedex.ts`). Chưa đối chiếu, không thấy
 * bằng chứng, hay không kiểm được đều KHÔNG loại.
 */
export const lyDoCoHieuLuc = (ma: string | null | undefined, doiChieu: string | null | undefined): boolean =>
  loaiTruKhoiKpi(ma) && doiChieu === 'xac_nhan';

export interface DemLyDo { ma: string; ten: string; thuocVe: LyDoCham['thuocVe']; loaiTruKpi: boolean; n: number }

/** Đếm kiện theo lý do, sắp giảm dần; kiện chưa gán lý do gom vào dòng "chưa gán". */
export function demTheoLyDo(mas: ReadonlyArray<string | null>): DemLyDo[] {
  const dem = new Map<string, number>();
  for (const m of mas) dem.set(m ?? '(chưa gán)', (dem.get(m ?? '(chưa gán)') ?? 0) + 1);
  return [...dem.entries()]
    .map(([ma, n]) => {
      const l = layLyDo(ma);
      return { ma, ten: l?.ten ?? 'Chưa gán lý do', thuocVe: l?.thuocVe ?? 'khac', loaiTruKpi: l?.loaiTruKpi ?? false, n };
    })
    .sort((a, b) => b.n - a.n);
}
