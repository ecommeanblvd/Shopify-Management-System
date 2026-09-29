/**
 * THUẦN: gom mọi việc ĐANG CHỜ QUẢN LÝ trên bảng KPI thành một danh sách.
 *
 * Vì sao cần (CEO 29/09/2026): bốn điểm duyệt nằm bốn nơi — duyệt tay lý do giao chậm (bảng chi
 * tiết 1.2), chấm hai mục 3B (ô nhập tay cuối trang), duyệt đẩy cân lên Shopify (trang Sửa cân
 * sản phẩm), và chốt kỳ (đầu trang). KHÔNG nơi nào báo là đang có việc chờ, nên quản lý phải tự
 * nhớ mở từng màn.
 *
 * Đo bằng chính ngày hôm nay: hai mục 3B chưa ai chấm kể từ khi khai, ba món cân nằm chờ, và
 * chỉ khi CEO hỏi mới lộ ra. Thứ không ai nhắc thì không ai làm — cùng họ với bài học "thứ không
 * chạy thì không kêu", chỉ khác là ở đây người mới là thứ không được gọi.
 */

export type MaViecDuyet = 'phan-dinh-1-1' | 'duyet-ly-do' | 'cham-3b' | 'duyet-can' | 'chot-ky';

export interface ViecChoDuyet {
  ma: MaViecDuyet;
  /** Câu nói thẳng còn bao nhiêu việc. */
  nhan: string;
  /** Làm ở đâu — người đọc phải biết đi đâu mà không cần hỏi ai. */
  huong: string;
  /** Đường dẫn khi việc nằm ở trang khác; null = ngay trên trang này. */
  href: string | null;
}

export interface DauVaoChoDuyet {
  /** Kỳ đang xem, dạng YYYY-MM. */
  ky: string;
  /** Kiện có lý do ngoài tầm kiểm soát mà máy không kiểm được, chưa ai duyệt. */
  kienChoDuyet: number;
  /** Món cân đang chờ quản lý duyệt đẩy lên Shopify. */
  monCanChoDuyet: number;
  /** Kỳ này đã có dòng nhập tay chưa (tức đã ai chấm 3B chưa). */
  daChamP3B: boolean;
  /** Kỳ này đã chốt chưa. */
  daChot: boolean;
  /** Số tiêu chí Pillar 1 còn chưa chấm được (mức đạt null). */
  p1ChuaCham: number;
  /** Đơn âm cước còn chưa phân định. */
  donChuaPhanDinh: number;
}

/**
 * Kỳ đã đủ điều kiện chốt chưa: mọi tiêu chí P1 chấm được và không còn đơn âm cước treo.
 *
 * Cố ý KHÔNG đòi hai mục 3B đã chấm: 3B để trống vẫn chốt được (nó chỉ không đóng góp điểm), còn
 * P1 chưa chấm mà chốt là KHOÁ VĨNH VIỄN một con số thấp hơn sự thật — đo hôm nay: chốt khi còn 6
 * đơn treo thì P1 đứng ở 70%, phân định xong thì 85%.
 */
export function duDieuKienChot(v: Pick<DauVaoChoDuyet, 'p1ChuaCham' | 'donChuaPhanDinh' | 'daChot'>): boolean {
  return !v.daChot && v.p1ChuaCham === 0 && v.donChuaPhanDinh === 0;
}

/** Danh sách việc chờ quản lý, thứ tự = việc chặn nhiều thứ nhất đứng trước. */
export function viecChoDuyet(v: DauVaoChoDuyet): ViecChoDuyet[] {
  const ra: ViecChoDuyet[] = [];

  // Đơn âm cước treo đứng ĐẦU vì nó chặn cả tiêu chí 1.1 lẫn việc chốt kỳ.
  if (!v.daChot && v.donChuaPhanDinh > 0) {
    ra.push({
      ma: 'phan-dinh-1-1',
      nhan: `${v.donChuaPhanDinh} đơn âm cước chưa phân định — tiêu chí 1.1 chưa chấm được`,
      huong: 'Mở tiêu chí 1.1 ở bảng chi tiết bên dưới và chọn lý do cho từng đơn',
      href: null,
    });
  }

  if (v.kienChoDuyet > 0) {
    ra.push({
      ma: 'duyet-ly-do',
      nhan: `${v.kienChoDuyet} kiện chờ quản lý duyệt tay`,
      huong: 'Hãng không có nguồn để đối chiếu (Aramex, hoặc quá hạn tra cứu). Mở tiêu chí 1.2 ở bảng chi tiết, cột Lý do chậm',
      href: null,
    });
  }

  if (!v.daChamP3B && !v.daChot) {
    ra.push({
      ma: 'cham-3b',
      nhan: `Kỳ ${v.ky} chưa có kết luận cho hai mục 3B`,
      huong: 'Điền ở ô nhập tay cuối trang — để trống thì hai mục này không đóng góp điểm',
      href: null,
    });
  }

  if (v.monCanChoDuyet > 0) {
    ra.push({
      ma: 'duyet-can',
      nhan: `${v.monCanChoDuyet} món chờ duyệt đẩy cân mới lên Shopify`,
      huong: 'Đến từ giải trình đơn âm cước. Chưa duyệt thì lỗi cân quy đổi web còn tái diễn',
      href: '/f/can-san-pham',
    });
  }

  // Lời mời chốt đứng CUỐI: chỉ hiện khi không còn việc dở nào ở trên nó.
  if (duDieuKienChot(v)) {
    ra.push({
      ma: 'chot-ky',
      nhan: `Kỳ ${v.ky} đủ điều kiện chốt`,
      huong: 'Mọi tiêu chí Pillar 1 đã chấm được và không còn đơn âm cước treo. Bấm Chốt kỳ ở đầu trang',
      href: null,
    });
  }

  return ra;
}
