/**
 * THUẦN: luồng NỘP — KHOÁ — DUYỆT cho tiêu chí 1.2 (CEO 30/09/2026).
 *
 * Trước nay Đức chọn lý do xong là số vào thẳng KPI, không ai xác nhận và cũng không có mốc nào
 * nói "đã xong". Nay: Đức bấm gửi cho cả kỳ → mọi ô chọn của kỳ khoá lại → quản lý duyệt cả kỳ,
 * hoặc TRẢ LẠI riêng những dòng thấy sai kèm ghi chú; chỉ dòng bị trả mới mở khoá để sửa.
 *
 * HAI TẦNG TÁCH BẠCH, đừng gộp (CEO 30/09/2026):
 *   - Duyệt của quản lý trả lời "LÝ DO đã đúng chưa" và chốt nó không đổi nữa.
 *   - Bằng chứng quét của hãng trả lời "lý do đó có rút được kiện khỏi KPI không".
 * Cho duyệt thay bằng chứng hãng là mở lại đúng lỗ hổng 16/09, nơi một lượt gán 58 kiện đẩy SLA
 * tháng 8 từ 83,3% lên 95,1%. Vì vậy duyệt ở đây KHÔNG đụng tới `lyDoCoHieuLuc`.
 */

export type TrangThaiNop = 'dang_lam' | 'cho_duyet' | 'da_duyet';

export const NHAN_TRANG_THAI: Record<TrangThaiNop, string> = {
  dang_lam: 'Đang làm',
  cho_duyet: 'Chờ quản lý duyệt',
  da_duyet: 'Đã duyệt — lý do đã chốt',
};

/**
 * Một dòng có đang bị KHOÁ không.
 *
 * Khoá khi kỳ đã nộp, TRỪ dòng bị quản lý trả lại — trả lại chính là mở khoá đúng chỗ cần sửa
 * mà không mở toang cả kỳ. Kỳ đã duyệt thì khoá tất, kể cả dòng từng bị trả: duyệt là chốt.
 */
export function dongBiKhoa(trangThai: TrangThaiNop, biTraLai: boolean): boolean {
  if (trangThai === 'da_duyet') return true;
  if (trangThai === 'cho_duyet') return !biTraLai;
  return false;
}

/** Đức có gửi được kỳ này đi duyệt không. */
export function nopDuoc(trangThai: TrangThaiNop): boolean {
  return trangThai === 'dang_lam' || trangThai === 'cho_duyet';
}

/**
 * Quản lý có duyệt được cả kỳ không: phải đang chờ duyệt VÀ không còn dòng nào bị trả lại chưa
 * sửa. Duyệt trong lúc còn dòng đang trả về là chốt luôn cái mình vừa nói là sai.
 */
export function duyetDuocKy(trangThai: TrangThaiNop, soDongDangTraLai: number): boolean {
  return trangThai === 'cho_duyet' && soDongDangTraLai === 0;
}

/** Quản lý có trả lại dòng được không — chỉ khi kỳ đang chờ duyệt. */
export function traLaiDuoc(trangThai: TrangThaiNop): boolean {
  return trangThai === 'cho_duyet';
}

/**
 * Câu mô tả trạng thái kỳ cho người đọc. Nói luôn còn bao nhiêu dòng bị trả, vì đó là thứ quyết
 * định ai phải làm gì tiếp theo.
 */
export function moTaTrangThai(trangThai: TrangThaiNop, soDongDangTraLai: number): string {
  if (trangThai === 'dang_lam') return 'Đang làm — chọn xong lý do thì gửi quản lý duyệt';
  if (trangThai === 'da_duyet') return 'Đã duyệt — lý do đã chốt, muốn sửa phải mở lại kỳ';
  return soDongDangTraLai > 0
    ? `Chờ duyệt — quản lý đã trả lại ${soDongDangTraLai} dòng, sửa xong thì gửi lại`
    : 'Chờ quản lý duyệt — các ô chọn đang khoá';
}
