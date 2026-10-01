/**
 * THUẦN: lý do lỗi QC và luật của một dòng lỗi. Không I/O.
 *
 * Danh sách rút từ chính chữ đội kho đã gõ tay trong `goods_receipt_items`
 * (bẩn, thiếu đá đính, có mùi, lỗi vải, xước vải, hỏng khoá kéo…). Chọn từ
 * danh sách chứ không gõ tay vì bản cũ không gom nhóm được: 83 món `pass` lại
 * có lý do fail ghi trong đó, kiểu "(đã khắc phục) hỏng khóa kéo, nhờ brand sửa".
 */
export const LY_DO_HOP_LE = [
  'ban', 'rach', 'loi_vai', 'xuoc_vai', 'hong_khoa', 'thieu_phu_kien',
  'co_mui', 'sai_mau', 'sai_size', 'loi_duong_may', 'o_loang_mau', 'khac',
] as const;

export type LyDoLoi = (typeof LY_DO_HOP_LE)[number];

export const NHAN_LY_DO: Record<LyDoLoi, string> = {
  ban: 'Bẩn', rach: 'Rách', loi_vai: 'Lỗi vải', xuoc_vai: 'Xước vải',
  hong_khoa: 'Hỏng khoá kéo', thieu_phu_kien: 'Thiếu phụ kiện / đá đính',
  co_mui: 'Có mùi', sai_mau: 'Sai màu', sai_size: 'Sai size',
  loi_duong_may: 'Lỗi đường may', o_loang_mau: 'Ố / loang màu', khac: 'Khác',
};

export interface DongLoiTho {
  lyDo: LyDoLoi;
  anhKey: string | null;
  ghiChu: string;
}

export function kiemDongLoi(d: DongLoiTho): { ok: true } | { ok: false; loi: string } {
  if (!(LY_DO_HOP_LE as readonly string[]).includes(d.lyDo)) {
    return { ok: false, loi: 'Lý do lỗi không hợp lệ.' };
  }
  if (d.lyDo === 'khac' && d.ghiChu.trim() === '') {
    return { ok: false, loi: 'Lý do "Khác" phải ghi rõ trong ô ghi chú.' };
  }
  /* Ảnh KHÔNG bắt buộc (CEO 01/10/2026): "nếu lỗi thì điền QC lỗi, nhưng 2 trường này là không
   * bắt buộc tại thời điểm này mà có thể bổ sung sau tại bảng Nhận hôm nay". Kiểm xong mà chưa
   * kịp chụp thì phải lưu được — chặn ở đây là kho kẹt giữa ca.
   *
   * Thả luật này CHỈ an toàn vì cùng vòng đã mở đường bổ sung sau: `danhSachDangKiem` giữ chiếc
   * ĐÃ FAIL TRONG NGÀY ở bảng, và `themDongLoiQc` thêm được dòng lỗi cho chiếc đã kiểm. Thả mà
   * không có hai thứ đó là tạo bẫy: lưu không ảnh rồi chiếc rời bảng, mất luôn bằng chứng để
   * cãi với brand — đúng thứ bảng `wh_loi_qc` sinh ra để giữ.
   *
   * LÝ DO thì VẪN bắt buộc (ở trên): nó gõ ngay trong form này, bảng không có chỗ bổ sung sau. */
  return { ok: true };
}
